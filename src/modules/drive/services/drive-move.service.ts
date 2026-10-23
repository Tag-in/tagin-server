import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { isUniqueViolation } from '../../../core/database/utils/pg-error.util.js';
import { MoveConflictPolicy, MoveDriveDto } from '../dto/move-drive.dto.js';
import {
  MoveDriveResponseDto,
  MoveEntryType,
  MoveStatus,
} from '../dto/move-drive-response.dto.js';
import {
  addItemsToFolders,
  removeItemsFromFolders,
} from '../utils/centroid.util.js';
import { assertAllFound, sortByRequest } from '../utils/selection.util.js';
import { planMoves, type PlannedMove } from '../utils/move-plan.util.js';

interface ItemRow {
  id: string;
  name: string;
  folder_id: string;
}

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
}

@Injectable()
export class DriveMoveService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * 파일·링크와 폴더를 대상 폴더로 이동한다. 전체가 한 트랜잭션이라 중간에 실패하면 아무것도 바뀌지 않는다.
   *
   * - 폴더는 parent_id만 바꾼다. 하위 폴더와 항목은 트리에 매달려 있어 함께 이동하고, 폴더 centroid는
   *   직속 항목의 벡터 합이라 폴더 이동으로는 달라지지 않는다.
   * - 항목은 folder_id를 바꾸면서 원래 폴더의 centroid에서 항목 벡터를 빼고 대상 폴더에 더한다.
   *   직속 항목이 없어진 폴더의 centroid는 null이 되어 자동 분류(최근접 폴더) 후보에서 빠진다.
   * - 같은 대상으로의 동시 이동이 서로의 이름 충돌 검사를 놓치지 않도록 대상 단위로 직렬화한다.
   */
  move(userId: string, dto: MoveDriveDto): Promise<MoveDriveResponseDto> {
    const itemIds = dto.itemIds ?? [];
    const folderIds = dto.folderIds ?? [];
    if (itemIds.length === 0 && folderIds.length === 0) {
      throw new BadRequestException('이동할 파일 또는 폴더를 지정해야 합니다.');
    }
    if (itemIds.length > 0 && dto.targetFolderId === null) {
      throw new BadRequestException(
        '파일·링크는 최상위로 이동할 수 없습니다. 대상 폴더를 지정하세요.',
      );
    }
    const policy = dto.onConflict ?? MoveConflictPolicy.FAIL;
    const dryRun = dto.dryRun ?? false;
    const targetId = dto.targetFolderId;

    return this.dataSource.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `drive-move:${userId}:${targetId ?? 'root'}`,
      ]);

      if (targetId) {
        const target = await em.query(
          'SELECT 1 FROM drive_folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL',
          [targetId, userId],
        );
        if (target.length === 0) {
          throw new NotFoundException('대상 폴더를 찾을 수 없습니다.');
        }
      }

      const items = sortByRequest(
        itemIds.length === 0
          ? []
          : await em.query<ItemRow[]>(
              `SELECT id, name, folder_id FROM drive_items
                WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
              [itemIds, userId],
            ),
        itemIds,
      );
      const folders = sortByRequest(
        folderIds.length === 0
          ? []
          : await em.query<FolderRow[]>(
              `SELECT id, name, parent_id FROM drive_folders
                WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
              [folderIds, userId],
            ),
        folderIds,
      );
      assertAllFound('파일', itemIds, items);
      assertAllFound('폴더', folderIds, folders);

      if (targetId && folders.length > 0) {
        await assertNotIntoOwnSubtree(em, targetId, folders);
      }

      const itemPlan = planMoves(
        MoveEntryType.ITEM,
        items.map((i) => ({ ...i, inTarget: i.folder_id === targetId })),
        await this.namesIn(em, 'drive_items', 'folder_id', userId, targetId),
        policy,
      );
      const folderPlan = planMoves(
        MoveEntryType.FOLDER,
        folders.map((f) => ({ ...f, inTarget: f.parent_id === targetId })),
        await this.namesIn(em, 'drive_folders', 'parent_id', userId, targetId),
        policy,
      );
      const response = {
        dryRun,
        targetFolderId: targetId,
        results: [...itemPlan.results, ...folderPlan.results],
      };
      if (dryRun) return response;

      const conflicts = response.results.filter(
        (r) => r.status === MoveStatus.CONFLICT,
      );
      if (conflicts.length > 0) {
        throw new ConflictException({
          statusCode: 409,
          message: '대상 폴더에 같은 이름의 항목이 있습니다.',
          error: 'Conflict',
          conflicts,
        });
      }

      try {
        if (targetId) await moveItems(em, userId, targetId, itemPlan.moves);
        await moveFolders(em, userId, targetId, folderPlan.moves);
      } catch (error) {
        // 락을 거치지 않는 업로드의 자동 폴더 생성과 겹친 경우
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            '대상 폴더에 같은 이름의 폴더가 있습니다.',
          );
        }
        throw error;
      }
      return response;
    });
  }

  /** 대상 위치(폴더 또는 최상위)에 이미 있는 이름들 */
  private async namesIn(
    em: EntityManager,
    table: 'drive_items' | 'drive_folders',
    parentColumn: 'folder_id' | 'parent_id',
    userId: string,
    targetId: string | null,
  ): Promise<Set<string>> {
    // 항목은 최상위에 둘 수 없으므로 대상이 없으면 조회할 필요가 없다.
    if (table === 'drive_items' && targetId === null) return new Set();
    const rows = await em.query<{ name: string }[]>(
      `SELECT name FROM ${table}
        WHERE owner_id = $1 AND deleted_at IS NULL
          AND ${parentColumn} IS NOT DISTINCT FROM $2::uuid`,
      [userId, targetId],
    );
    return new Set(rows.map((r) => r.name));
  }
}

/** 대상 폴더가 이동하려는 폴더 자신이거나 그 하위면 순환이 되므로 거부한다. */
const assertNotIntoOwnSubtree = async (
  em: EntityManager,
  targetId: string,
  moving: FolderRow[],
): Promise<void> => {
  // 대상에서 최상위 방향으로 올라가며 조상 체인을 구한다 (대상 자신 포함)
  const chain = await em.query<{ id: string }[]>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id FROM drive_folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id FROM drive_folders f JOIN ancestors a ON f.id = a.parent_id
     )
     SELECT id FROM ancestors`,
    [targetId],
  );
  const movingIds = new Set(moving.map((f) => f.id));
  if (chain.some(({ id }) => movingIds.has(id))) {
    throw new BadRequestException(
      '폴더를 자기 자신 또는 하위 폴더로 이동할 수 없습니다.',
    );
  }
};

/** 항목을 옮기며 원래 폴더 centroid에서 항목 벡터를 빼고 대상 폴더에 더한다. */
const moveItems = async (
  em: EntityManager,
  userId: string,
  targetId: string,
  moves: PlannedMove[],
): Promise<void> => {
  if (moves.length === 0) return;
  const ids = moves.map((m) => m.id);

  // centroid 갱신은 항목 이동보다 먼저 한다 (항목의 현재 folder_id를 읽는다).
  await removeItemsFromFolders(em, ids);
  await addItemsToFolders(em, ids, targetId);
  await em.query(
    `UPDATE drive_items i SET folder_id = $1, name = v.name
       FROM unnest($2::uuid[], $3::text[]) AS v(id, name)
      WHERE i.id = v.id AND i.owner_id = $4`,
    [targetId, ids, moves.map((m) => m.name), userId],
  );
};

const moveFolders = async (
  em: EntityManager,
  userId: string,
  targetId: string | null,
  moves: PlannedMove[],
): Promise<void> => {
  if (moves.length === 0) return;
  await em.query(
    `UPDATE drive_folders f SET parent_id = $1::uuid, name = v.name, updated_at = now()
       FROM unnest($2::uuid[], $3::text[]) AS v(id, name)
      WHERE f.id = v.id AND f.owner_id = $4`,
    [targetId, moves.map((m) => m.id), moves.map((m) => m.name), userId],
  );
};
