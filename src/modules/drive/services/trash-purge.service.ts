import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ObjectStorageService } from '../../../core/storage/object-storage.service.js';
import { errorMessage } from '../../../common/utils/error-message.util.js';
import { DriveSelectionDto } from '../dto/drive-selection.dto.js';
import { PurgeDriveResponseDto } from '../dto/trash-response.dto.js';
import {
  assertAllFound,
  assertSelectionNotEmpty,
} from '../utils/selection.util.js';
import { lockTrash } from '../utils/trash-lock.util.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
/** 폴더 중첩 깊이의 상한 (바닥 폴더부터 한 겹씩 지우므로 깊이만큼 반복한다) */
const MAX_FOLDER_DEPTH = 100;
const PURGE_LOCK_KEY = 'drive-trash-purge';

export interface PurgeResult {
  items: number;
  folders: number;
}

/** 휴지통 보관 기간이 지난 항목을 스토리지 객체와 DB 행까지 영구 삭제한다. */
@Injectable()
export class TrashPurgeService {
  private readonly logger = new Logger(TrashPurgeService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: ObjectStorageService,
    config: ConfigService,
  ) {
    this.retentionDays = config.getOrThrow<number>('TRASH_RETENTION_DAYS');
  }

  @Cron('0 3 * * *')
  async runScheduled(): Promise<void> {
    try {
      const result = await this.purgeExpired();
      if (result) {
        this.logger.log(
          `휴지통 영구 삭제: 항목 ${result.items}개, 폴더 ${result.folders}개`,
        );
      }
    } catch (e) {
      this.logger.error(`휴지통 영구 삭제 실패: ${errorMessage(e)}`);
    }
  }

  /**
   * 서버가 여러 대여도 한 곳에서만 돌도록 advisory lock을 잡는다. 이미 다른 곳에서 돌고 있으면 null.
   * 스토리지 객체를 먼저 지우고 성공한 항목의 행만 지운다. 실패한 항목은 행이 남아 다음 실행에서 다시 시도한다.
   * 객체 삭제는 없는 키도 성공이라 도중에 끊겨도 다시 돌려도 안전하다.
   */
  async purgeExpired(now = new Date()): Promise<PurgeResult | null> {
    const cutoff = new Date(now.getTime() - this.retentionDays * DAY_MS);

    // 세션 단위 락이라 락을 잡은 연결을 끝까지 들고 있어야 한다.
    const lockRunner = this.dataSource.createQueryRunner();
    await lockRunner.connect();
    try {
      const [{ locked }] = await lockRunner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [PURGE_LOCK_KEY],
      );
      if (!locked) return null;
      try {
        const items = await this.purgeItems(cutoff);
        const folders = await this.purgeFolders(cutoff);
        return { items, folders };
      } finally {
        await lockRunner.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [PURGE_LOCK_KEY],
        );
      }
    } finally {
      await lockRunner.release();
    }
  }

  /**
   * 휴지통의 항목을 사용자가 직접 영구 삭제한다 (보관 기간과 무관). 폴더는 하위 폴더·항목까지 지운다.
   *
   * - 삭제·복원과 같은 사용자 락을 잡아, 지우는 동안 복원되어 객체만 사라진 행이 남는 일을 막는다.
   * - 스토리지 객체를 먼저 지우고 성공한 항목의 행만 지운다. 실패한 항목과 그 상위 폴더는 휴지통에 남겨
   *   보관 기간 후 자동 삭제가 다시 시도한다 (폴더 FK가 CASCADE라 폴더를 먼저 지우면 객체가 고아가 된다).
   */
  purgeSelection(
    userId: string,
    { itemIds = [], folderIds = [] }: DriveSelectionDto,
  ): Promise<PurgeDriveResponseDto> {
    assertSelectionNotEmpty(itemIds, folderIds, '영구 삭제할');

    return this.dataSource.transaction(async (em) => {
      await lockTrash(em, userId);

      const requestedItems =
        itemIds.length === 0
          ? []
          : await em.query<{ id: string }[]>(
              `SELECT id FROM drive_items
                WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NOT NULL FOR UPDATE`,
              [itemIds, userId],
            );
      const requestedFolders =
        folderIds.length === 0
          ? []
          : await em.query<{ id: string }[]>(
              `SELECT id FROM drive_folders
                WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NOT NULL FOR UPDATE`,
              [folderIds, userId],
            );
      assertAllFound('휴지통의 파일', itemIds, requestedItems);
      assertAllFound('휴지통의 폴더', folderIds, requestedFolders);

      // 휴지통 폴더 아래의 폴더는 모두 휴지통에 있다 (폴더를 지울 때 하위 전체에 deleted_at을 찍는다).
      const subtree = (
        await em.query<{ id: string }[]>(
          `WITH RECURSIVE subtree AS (
             SELECT id FROM drive_folders WHERE id = ANY($1::uuid[])
             UNION ALL
             SELECT f.id FROM drive_folders f JOIN subtree s ON f.parent_id = s.id
           ) SELECT id FROM subtree`,
          [folderIds],
        )
      ).map((r) => r.id);

      const items = await em.query<
        { id: string; storage_key: string | null }[]
      >(
        `SELECT id, storage_key FROM drive_items
          WHERE owner_id = $1 AND deleted_at IS NOT NULL
            AND (id = ANY($2::uuid[]) OR folder_id = ANY($3::uuid[]))`,
        [userId, itemIds, subtree],
      );

      const failed = new Set(
        await this.storage.deleteMany(
          items
            .map((i) => i.storage_key)
            .filter((k): k is string => k !== null),
        ),
      );
      const deletable = items
        .filter((i) => i.storage_key === null || !failed.has(i.storage_key))
        .map((i) => i.id);
      if (deletable.length > 0) {
        await em.query('DELETE FROM drive_items WHERE id = ANY($1::uuid[])', [
          deletable,
        ]);
      }

      // 비어 있는 폴더만 바닥부터 한 겹씩 지운다. 객체 삭제에 실패한 항목이 남은 폴더는 그대로 둔다.
      let purgedFolderCount = 0;
      for (
        let depth = 0;
        depth < MAX_FOLDER_DEPTH && subtree.length > 0;
        depth++
      ) {
        const [{ count }] = await em.query<{ count: number }[]>(
          `WITH d AS (
             DELETE FROM drive_folders f
              WHERE f.id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM drive_items i WHERE i.folder_id = f.id)
                AND NOT EXISTS (SELECT 1 FROM drive_folders c WHERE c.parent_id = f.id)
              RETURNING 1
           ) SELECT count(*)::int AS count FROM d`,
          [subtree],
        );
        if (count === 0) break;
        purgedFolderCount += count;
      }

      const failedItemCount = items.length - deletable.length;
      if (failedItemCount > 0) {
        this.logger.warn(
          `사용자 영구 삭제: 객체 삭제에 실패한 항목 ${failedItemCount}개는 휴지통에 남겨 둡니다.`,
        );
      }
      return {
        purgedItemCount: deletable.length,
        purgedFolderCount,
        failedItemCount,
      };
    });
  }

  private async purgeItems(cutoff: Date): Promise<number> {
    let purged = 0;
    for (;;) {
      const rows = await this.dataSource.query<
        { id: string; storage_key: string | null }[]
      >(
        `SELECT id, storage_key FROM drive_items
          WHERE deleted_at < $1 ORDER BY deleted_at LIMIT $2`,
        [cutoff, BATCH_SIZE],
      );
      if (rows.length === 0) return purged;

      const failed = new Set(
        await this.storage.deleteMany(
          rows.map((r) => r.storage_key).filter((k): k is string => k !== null),
        ),
      );
      const deletable = rows
        .filter((r) => r.storage_key === null || !failed.has(r.storage_key))
        .map((r) => r.id);
      if (deletable.length > 0) {
        await this.dataSource.query(
          'DELETE FROM drive_items WHERE id = ANY($1::uuid[])',
          [deletable],
        );
      }
      purged += deletable.length;

      // 실패한 행이 다음 조회에 다시 잡혀 무한 반복하지 않도록 여기서 멈추고 다음 실행에 맡긴다.
      if (deletable.length < rows.length) {
        this.logger.warn(
          `객체 삭제에 실패한 항목 ${rows.length - deletable.length}개는 다음 실행에서 다시 시도합니다.`,
        );
        return purged;
      }
    }
  }

  /**
   * 기간이 지난 폴더 중 항목도 하위 폴더도 남지 않은 것만 지운다. FK가 CASCADE라 한 번에 지우면 스토리지 정리가
   * 끝나지 않은 항목까지 행이 사라져 객체가 고아가 되므로, 바닥 폴더부터 한 겹씩 지운다.
   */
  private async purgeFolders(cutoff: Date): Promise<number> {
    let purged = 0;
    for (let depth = 0; depth < MAX_FOLDER_DEPTH; depth++) {
      const [{ count }] = await this.dataSource.query<{ count: number }[]>(
        `WITH d AS (
           DELETE FROM drive_folders f
            WHERE f.deleted_at < $1
              AND NOT EXISTS (SELECT 1 FROM drive_items i WHERE i.folder_id = f.id)
              AND NOT EXISTS (SELECT 1 FROM drive_folders c WHERE c.parent_id = f.id)
            RETURNING 1
         ) SELECT count(*)::int AS count FROM d`,
        [cutoff],
      );
      if (count === 0) break;
      purged += count;
    }
    return purged;
  }
}
