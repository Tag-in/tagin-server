import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { isUniqueViolation } from '../../../core/database/utils/pg-error.util.js';
import { DriveSelectionDto } from '../dto/drive-selection.dto.js';
import { MoveConflictPolicy } from '../dto/move-drive.dto.js';
import { MoveEntryType } from '../dto/move-drive-response.dto.js';
import { DriveItemKind } from '../dto/drive-search-response.dto.js';
import {
  DeleteDriveResponseDto,
  RestoreDriveResponseDto,
  RestoreResultDto,
  TrashEntryDto,
  TrashListResponseDto,
} from '../dto/trash-response.dto.js';
import {
  addItemsToFolders,
  removeItemsFromFolders,
} from '../utils/centroid.util.js';
import { planMoves, type PlannedMove } from '../utils/move-plan.util.js';
import {
  assertAllFound,
  assertSelectionNotEmpty,
  sortByRequest,
} from '../utils/selection.util.js';
import { lockTrash } from '../utils/trash-lock.util.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface TrashedItem {
  id: string;
  name: string;
  folder_id: string;
  deleted_at: Date;
}

interface TrashedFolder {
  id: string;
  name: string;
  parent_id: string | null;
  deleted_at: Date;
}

@Injectable()
export class DriveTrashService {
  private readonly retentionDays: number;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.retentionDays = config.getOrThrow<number>('TRASH_RETENTION_DAYS');
  }

  /**
   * 파일·링크·폴더를 휴지통으로 보낸다 (soft delete). 전체가 한 트랜잭션이다.
   *
   * - 폴더를 지우면 하위 폴더와 그 안의 항목에도 같은 deleted_at을 찍는다. 같은 값은 "폴더와 함께 지워졌다"는 표시다.
   * - 이미 따로 지워 둔 항목은 건드리지 않으므로 deleted_at이 달라 폴더를 복원해도 돌아오지 않는다.
   * - 살아 있는 폴더에서 직접 지운 항목만 그 폴더의 centroid에서 뺀다. 폴더와 함께 지워지는 항목은 폴더가 휴지통에
   *   있는 동안에도 폴더 centroid에 남겨 두어, 폴더를 복원할 때 벡터를 다시 계산하지 않아도 된다.
   * - 스토리지 객체와 사용 용량은 그대로다. 영구 삭제 때 정리한다.
   */
  delete(
    userId: string,
    { itemIds = [], folderIds = [] }: DriveSelectionDto,
  ): Promise<DeleteDriveResponseDto> {
    assertSelectionNotEmpty(itemIds, folderIds, '삭제할');

    return this.dataSource.transaction(async (em) => {
      await lockTrash(em, userId);

      const items = sortByRequest(
        itemIds.length === 0
          ? []
          : await em.query<{ id: string; folder_id: string }[]>(
              `SELECT id, folder_id FROM drive_items
                WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
              [itemIds, userId],
            ),
        itemIds,
      );
      const folders = sortByRequest(
        folderIds.length === 0
          ? []
          : await em.query<{ id: string }[]>(
              `SELECT id FROM drive_folders
                WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
              [folderIds, userId],
            ),
        folderIds,
      );
      assertAllFound('파일', itemIds, items);
      assertAllFound('폴더', folderIds, folders);

      // 지우는 폴더들과 그 아래의 살아 있는 폴더 전체
      const subtree =
        folderIds.length === 0
          ? []
          : (
              await em.query<{ id: string }[]>(
                `WITH RECURSIVE subtree AS (
                   SELECT id FROM drive_folders
                    WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
                   UNION ALL
                   SELECT f.id FROM drive_folders f JOIN subtree s ON f.parent_id = s.id
                    WHERE f.deleted_at IS NULL
                 ) SELECT id FROM subtree`,
                [folderIds],
              )
            ).map((r) => r.id);

      const subtreeIds = new Set(subtree);
      await removeItemsFromFolders(
        em,
        items.filter((i) => !subtreeIds.has(i.folder_id)).map((i) => i.id),
      );

      // 모든 행에 같은 값을 찍어야 하므로 한 번만 읽는다.
      const [{ now }] = await em.query<{ now: Date }[]>(
        'SELECT clock_timestamp() AS now',
      );
      const [{ count: deletedItemCount }] = await em.query<{ count: number }[]>(
        `WITH d AS (
           UPDATE drive_items SET deleted_at = $1
            WHERE owner_id = $2 AND deleted_at IS NULL
              AND (id = ANY($3::uuid[]) OR folder_id = ANY($4::uuid[]))
            RETURNING 1
         ) SELECT count(*)::int AS count FROM d`,
        [now, userId, itemIds, subtree],
      );
      const [{ count: deletedFolderCount }] = await em.query<
        { count: number }[]
      >(
        `WITH d AS (
           UPDATE drive_folders SET deleted_at = $1, updated_at = now()
            WHERE owner_id = $2 AND deleted_at IS NULL AND id = ANY($3::uuid[])
            RETURNING 1
         ) SELECT count(*)::int AS count FROM d`,
        [now, userId, subtree],
      );

      return {
        deletedItemCount,
        deletedFolderCount,
        purgeAt: this.purgeAt(now),
      };
    });
  }

  /**
   * 휴지통에서 복원한다. 전체가 한 트랜잭션이다.
   *
   * - 폴더는 함께 지워진 하위 폴더·항목(deleted_at이 같은 것)까지 복원한다.
   * - 원래 위치에 같은 이름이 생겼다면 "이름 (1)"로 바꿔 복원한다 (복원이 이름 충돌로 막히지 않게 한다).
   * - 상위 폴더가 휴지통에 있으면 되돌릴 자리가 없으므로 409다. 상위 폴더를 먼저, 또는 함께 복원해야 한다.
   * - 직접 지웠던 항목은 centroid에 다시 더한다.
   */
  restore(
    userId: string,
    { itemIds = [], folderIds = [] }: DriveSelectionDto,
  ): Promise<RestoreDriveResponseDto> {
    assertSelectionNotEmpty(itemIds, folderIds, '복원할');

    return this.dataSource.transaction(async (em) => {
      await lockTrash(em, userId);

      const items = sortByRequest(
        itemIds.length === 0
          ? []
          : await em.query<TrashedItem[]>(
              `SELECT id, name, folder_id, deleted_at FROM drive_items
                WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NOT NULL FOR UPDATE`,
              [itemIds, userId],
            ),
        itemIds,
      );
      const folders = sortByRequest(
        folderIds.length === 0
          ? []
          : await em.query<TrashedFolder[]>(
              `SELECT id, name, parent_id, deleted_at FROM drive_folders
                WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NOT NULL FOR UPDATE`,
              [folderIds, userId],
            ),
        folderIds,
      );
      assertAllFound('휴지통의 파일', itemIds, items);
      assertAllFound('휴지통의 폴더', folderIds, folders);

      // 요청한 폴더와 함께 지워진 항목은 폴더 복원에 포함되므로 따로 되살리지 않는다 (centroid도 이미 반영돼 있다).
      const folderDeletedAt = new Map(
        folders.map((f) => [f.id, f.deleted_at.getTime()]),
      );
      const withFolder = (i: TrashedItem) =>
        folderDeletedAt.get(i.folder_id) === i.deleted_at.getTime();
      const direct = items.filter((i) => !withFolder(i));

      await assertParentsRestorable(em, folders, direct, new Set(folderIds));

      const itemPlan = await this.planRestoreNames(
        em,
        userId,
        MoveEntryType.ITEM,
        direct.map((i) => ({ ...i, parent: i.folder_id })),
      );
      const folderPlan = await this.planRestoreNames(
        em,
        userId,
        MoveEntryType.FOLDER,
        folders.map((f) => ({ ...f, parent: f.parent_id })),
      );

      try {
        if (folders.length > 0) {
          // 폴더가 아직 휴지통일 때(deleted_at이 같을 때) 함께 지워진 하위 항목을 먼저 되살린다.
          await em.query(
            `WITH RECURSIVE sub AS (
               SELECT id, deleted_at FROM drive_folders WHERE id = ANY($1::uuid[])
               UNION ALL
               SELECT f.id, s.deleted_at FROM drive_folders f JOIN sub s ON f.parent_id = s.id
                WHERE f.deleted_at = s.deleted_at
             )
             UPDATE drive_items i SET deleted_at = NULL
               FROM sub WHERE i.folder_id = sub.id AND i.deleted_at = sub.deleted_at`,
            [folderIds],
          );
          await em.query(
            `WITH RECURSIVE sub AS (
               SELECT id, deleted_at FROM drive_folders WHERE id = ANY($1::uuid[])
               UNION ALL
               SELECT f.id, s.deleted_at FROM drive_folders f JOIN sub s ON f.parent_id = s.id
                WHERE f.deleted_at = s.deleted_at
             )
             UPDATE drive_folders f
                SET deleted_at = NULL, updated_at = now(),
                    name = COALESCE(v.name, f.name)
               FROM sub
               LEFT JOIN unnest($2::uuid[], $3::text[]) AS v(id, name) ON v.id = sub.id
              WHERE f.id = sub.id`,
            [
              folderIds,
              folderPlan.moves.map((m) => m.id),
              folderPlan.moves.map((m) => m.name),
            ],
          );
        }

        if (direct.length > 0) {
          await addItemsToFolders(
            em,
            direct.map((i) => i.id),
          );
          await em.query(
            `UPDATE drive_items i SET deleted_at = NULL, name = v.name
               FROM unnest($1::uuid[], $2::text[]) AS v(id, name)
              WHERE i.id = v.id AND i.owner_id = $3`,
            [
              itemPlan.moves.map((m) => m.id),
              itemPlan.moves.map((m) => m.name),
              userId,
            ],
          );
        }
      } catch (error) {
        // 잠금을 거치지 않는 폴더 생성(자동 분류 업로드)과 겹친 경우
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            '같은 이름의 폴더가 생겨 복원하지 못했습니다. 다시 시도하세요.',
          );
        }
        throw error;
      }

      // 폴더와 함께 복원된 항목은 폴더 복원의 일부이므로 결과에 이름 변경 없이 포함한다.
      const results = [
        ...items.map((i) =>
          withFolder(i)
            ? restoreResult(MoveEntryType.ITEM, i, null)
            : itemPlan.renamed.get(i.id)!,
        ),
        ...folders.map((f) => folderPlan.renamed.get(f.id)!),
      ];
      return { results };
    });
  }

  /** 직접 삭제한 항목만 보여준다. 폴더와 함께 지워진 하위 항목은 해당 폴더를 복원하면 같이 돌아온다. */
  async list(userId: string): Promise<TrashListResponseDto> {
    const [folders, items] = await Promise.all([
      this.dataSource.query<{ id: string; name: string; deleted_at: Date }[]>(
        `SELECT f.id, f.name, f.deleted_at FROM drive_folders f
          WHERE f.owner_id = $1 AND f.deleted_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM drive_folders p
                             WHERE p.id = f.parent_id AND p.deleted_at = f.deleted_at)`,
        [userId],
      ),
      this.dataSource.query<
        {
          id: string;
          name: string;
          kind: DriveItemKind;
          size_bytes: string | null;
          deleted_at: Date;
        }[]
      >(
        `SELECT i.id, i.name, i.kind, i.size_bytes, i.deleted_at FROM drive_items i
          WHERE i.owner_id = $1 AND i.deleted_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM drive_folders p
                             WHERE p.id = i.folder_id AND p.deleted_at = i.deleted_at)`,
        [userId],
      ),
    ]);

    const entries: TrashEntryDto[] = [
      ...folders.map((f) => ({
        type: MoveEntryType.FOLDER,
        id: f.id,
        name: f.name,
        kind: null,
        sizeBytes: null,
        deletedAt: f.deleted_at,
        purgeAt: this.purgeAt(f.deleted_at),
      })),
      ...items.map((i) => ({
        type: MoveEntryType.ITEM,
        id: i.id,
        name: i.name,
        kind: i.kind,
        // pg는 bigint를 문자열로 돌려준다.
        sizeBytes: i.size_bytes === null ? null : Number(i.size_bytes),
        deletedAt: i.deleted_at,
        purgeAt: this.purgeAt(i.deleted_at),
      })),
    ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

    return { retentionDays: this.retentionDays, entries };
  }

  private purgeAt(deletedAt: Date): Date {
    return new Date(deletedAt.getTime() + this.retentionDays * DAY_MS);
  }

  /** 복원 위치(상위 폴더)별로 살아 있는 이름과 겹치면 번호를 붙인다. */
  private async planRestoreNames(
    em: EntityManager,
    userId: string,
    type: MoveEntryType,
    entries: { id: string; name: string; parent: string | null }[],
  ): Promise<{
    moves: PlannedMove[];
    renamed: Map<string, RestoreResultDto>;
  }> {
    const byParent = new Map<string | null, typeof entries>();
    for (const entry of entries) {
      byParent.set(entry.parent, [
        ...(byParent.get(entry.parent) ?? []),
        entry,
      ]);
    }

    const moves: PlannedMove[] = [];
    const renamed = new Map<string, RestoreResultDto>();
    for (const [parent, group] of byParent) {
      const table =
        type === MoveEntryType.ITEM ? 'drive_items' : 'drive_folders';
      const column = type === MoveEntryType.ITEM ? 'folder_id' : 'parent_id';
      const taken = await em.query<{ name: string }[]>(
        `SELECT name FROM ${table}
          WHERE owner_id = $1 AND deleted_at IS NULL AND ${column} IS NOT DISTINCT FROM $2::uuid`,
        [userId, parent],
      );
      const plan = planMoves(
        type,
        group.map((e) => ({ id: e.id, name: e.name, inTarget: false })),
        new Set(taken.map((r) => r.name)),
        MoveConflictPolicy.RENAME,
      );
      moves.push(...plan.moves);
      for (const r of plan.results) {
        renamed.set(r.id, {
          type,
          id: r.id,
          name: r.name,
          renamedTo: r.renamedTo,
        });
      }
    }
    return { moves, renamed };
  }
}

const restoreResult = (
  type: MoveEntryType,
  entry: { id: string; name: string },
  renamedTo: string | null,
): RestoreResultDto => ({ type, id: entry.id, name: entry.name, renamedTo });

/** 되돌릴 상위 폴더가 살아 있거나 이번 요청에서 함께 복원되는 경우만 허용한다. */
const assertParentsRestorable = async (
  em: EntityManager,
  folders: TrashedFolder[],
  items: TrashedItem[],
  requestedFolderIds: Set<string>,
): Promise<void> => {
  const parentIds = [
    ...folders.map((f) => f.parent_id),
    ...items.map((i) => i.folder_id),
  ].filter((id): id is string => id !== null);
  if (parentIds.length === 0) return;

  const live = new Set(
    (
      await em.query<{ id: string }[]>(
        'SELECT id FROM drive_folders WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
        [parentIds],
      )
    ).map((r) => r.id),
  );
  const blocked = parentIds.filter(
    (id) => !live.has(id) && !requestedFolderIds.has(id),
  );
  if (blocked.length > 0) {
    throw new ConflictException({
      statusCode: 409,
      message:
        '상위 폴더가 휴지통에 있어 복원할 수 없습니다. 상위 폴더를 먼저(또는 함께) 복원하세요.',
      error: 'Conflict',
      parentFolderIds: [...new Set(blocked)],
    });
  }
};
