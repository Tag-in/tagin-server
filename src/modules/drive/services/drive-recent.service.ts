import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DriveItemWithFolderDto } from '../dto/drive-browse-response.dto.js';
import {
  DEFAULT_RECENT_LIMIT,
  type DriveRecentResponseDto,
} from '../dto/drive-recent.dto.js';
import {
  ITEM_COLUMNS,
  qualify,
  toItem,
  type ItemRow,
} from './drive-browse.service.js';

export interface ItemWithFolderRow extends ItemRow {
  folder_name: string;
}

export const ITEM_WITH_FOLDER_COLUMNS = `${qualify(ITEM_COLUMNS, 'i')}, f.name AS folder_name`;

export const toItemWithFolder = (
  row: ItemWithFolderRow,
): DriveItemWithFolderDto => ({
  ...toItem(row),
  folderName: row.folder_name,
});

/** 최근에 추가한 파일·링크 (휴지통 제외). 항목은 수정되지 않으므로 추가 시각 순이다. */
@Injectable()
export class DriveRecentService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    ownerId: string,
    limit = DEFAULT_RECENT_LIMIT,
  ): Promise<DriveRecentResponseDto> {
    const rows: ItemWithFolderRow[] = await this.dataSource.query(
      `SELECT ${ITEM_WITH_FOLDER_COLUMNS}
         FROM drive_items i JOIN drive_folders f ON f.id = i.folder_id
        WHERE i.owner_id = $1 AND i.deleted_at IS NULL
        ORDER BY i.created_at DESC, i.id
        LIMIT $2`,
      [ownerId, limit],
    );
    return { items: rows.map(toItemWithFolder) };
  }
}
