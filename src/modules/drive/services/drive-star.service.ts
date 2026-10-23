import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DriveSelectionDto } from '../dto/drive-selection.dto.js';
import {
  DriveStarredResponseDto,
  StarDriveResponseDto,
} from '../dto/drive-starred.dto.js';
import {
  assertAllFound,
  assertSelectionNotEmpty,
} from '../utils/selection.util.js';
import {
  FOLDER_COLUMNS,
  toFolder,
  type FolderRow,
} from './drive-browse.service.js';
import {
  ITEM_WITH_FOLDER_COLUMNS,
  toItemWithFolder,
  type ItemWithFolderRow,
} from './drive-recent.service.js';

/** 중요 표시(별표). starred_at에 표시 시각을 두고, 해제하면 null로 돌린다. */
@Injectable()
export class DriveStarService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * 휴지통에 없는 내 항목만 대상이다. 하나라도 없으면 404이고 아무것도 바꾸지 않는다.
   * 이미 표시된 항목을 다시 표시하면 시각만 갱신된다.
   */
  setStarred(
    userId: string,
    { itemIds = [], folderIds = [] }: DriveSelectionDto,
    starred: boolean,
  ): Promise<StarDriveResponseDto> {
    assertSelectionNotEmpty(itemIds, folderIds, starred ? '표시할' : '해제할');

    return this.dataSource.transaction(async (em) => {
      const items =
        itemIds.length === 0
          ? []
          : await em.query<{ id: string }[]>(
              // TypeORM은 UPDATE 결과를 [rows, count]로 돌려주므로 CTE로 감싸 SELECT로 읽는다.
              `WITH u AS (
                 UPDATE drive_items SET starred_at = CASE WHEN $3::boolean THEN now() ELSE NULL END
                  WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL
                  RETURNING id
               ) SELECT id FROM u`,
              [itemIds, userId, starred],
            );
      const folders =
        folderIds.length === 0
          ? []
          : await em.query<{ id: string }[]>(
              `WITH u AS (
                 UPDATE drive_folders SET starred_at = CASE WHEN $3::boolean THEN now() ELSE NULL END
                  WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL
                  RETURNING id
               ) SELECT id FROM u`,
              [folderIds, userId, starred],
            );
      // 예외를 던지면 트랜잭션이 롤백되어 위 UPDATE도 취소된다.
      assertAllFound('파일', itemIds, items);
      assertAllFound('폴더', folderIds, folders);

      return { itemCount: items.length, folderCount: folders.length };
    });
  }

  async list(userId: string): Promise<DriveStarredResponseDto> {
    const [folders, items]: [FolderRow[], ItemWithFolderRow[]] =
      await Promise.all([
        this.dataSource.query(
          `SELECT ${FOLDER_COLUMNS} FROM drive_folders
            WHERE owner_id = $1 AND starred_at IS NOT NULL AND deleted_at IS NULL
            ORDER BY starred_at DESC, id`,
          [userId],
        ),
        this.dataSource.query(
          `SELECT ${ITEM_WITH_FOLDER_COLUMNS}
             FROM drive_items i JOIN drive_folders f ON f.id = i.folder_id
            WHERE i.owner_id = $1 AND i.starred_at IS NOT NULL AND i.deleted_at IS NULL
            ORDER BY i.starred_at DESC, i.id`,
          [userId],
        ),
      ]);
    return {
      folders: folders.map(toFolder),
      items: items.map(toItemWithFolder),
    };
  }
}
