import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  DriveFolderContentsResponseDto,
  DriveFolderDto,
  DriveFolderListResponseDto,
  DriveItemDto,
} from '../dto/drive-browse-response.dto.js';
import type { DriveItemKind } from '../dto/drive-search-response.dto.js';

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  item_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface ItemRow {
  id: string;
  folder_id: string;
  kind: DriveItemKind;
  name: string;
  mime_type: string | null;
  size_bytes: string | number | null;
  url: string | null;
  summary: string | null;
  created_at: Date;
}

const FOLDER_COLUMNS =
  'id, name, parent_id, item_count, created_at, updated_at';
export const ITEM_COLUMNS =
  'id, folder_id, kind, name, mime_type, size_bytes, url, summary, created_at';

/** 내 드라이브의 폴더 트리와 폴더 내용을 조회한다 (휴지통 항목 제외). */
@Injectable()
export class DriveBrowseService {
  constructor(private readonly dataSource: DataSource) {}

  async listFolders(ownerId: string): Promise<DriveFolderListResponseDto> {
    const rows: FolderRow[] = await this.dataSource.query(
      `SELECT ${FOLDER_COLUMNS} FROM drive_folders
        WHERE owner_id = $1 AND deleted_at IS NULL
        ORDER BY name, id`,
      [ownerId],
    );
    return { folders: rows.map(toFolder) };
  }

  async getContents(
    ownerId: string,
    folderId: string,
  ): Promise<DriveFolderContentsResponseDto> {
    // 위로 올라가며 경로를 모은다. 시작 폴더가 내 것이 아니거나 휴지통에 있으면 빈 결과 → 404.
    const path: (FolderRow & { depth: number })[] = await this.dataSource.query(
      `WITH RECURSIVE up AS (
         SELECT ${FOLDER_COLUMNS}, 0 AS depth FROM drive_folders
          WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
         UNION ALL
         SELECT f.id, f.name, f.parent_id, f.item_count, f.created_at, f.updated_at, u.depth + 1
           FROM drive_folders f JOIN up u ON f.id = u.parent_id
       )
       SELECT * FROM up ORDER BY depth DESC`,
      [folderId, ownerId],
    );
    const folder = path[path.length - 1];
    // 다른 사용자의 폴더도 존재 여부를 드러내지 않도록 404로 통일한다.
    if (!folder) throw new NotFoundException('폴더를 찾을 수 없습니다.');

    const [folders, items]: [FolderRow[], ItemRow[]] = await Promise.all([
      this.dataSource.query(
        `SELECT ${FOLDER_COLUMNS} FROM drive_folders
          WHERE owner_id = $1 AND parent_id = $2 AND deleted_at IS NULL
          ORDER BY name, id`,
        [ownerId, folderId],
      ),
      this.dataSource.query(
        `SELECT ${ITEM_COLUMNS} FROM drive_items
          WHERE owner_id = $1 AND folder_id = $2 AND deleted_at IS NULL
          ORDER BY name, id`,
        [ownerId, folderId],
      ),
    ]);

    return {
      folder: toFolder(folder),
      path: path.map(({ id, name }) => ({ id, name })),
      folders: folders.map(toFolder),
      items: items.map(toItem),
    };
  }
}

function toFolder(row: FolderRow): DriveFolderDto {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    itemCount: Number(row.item_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toItem(row: ItemRow): DriveItemDto {
  return {
    id: row.id,
    folderId: row.folder_id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    // pg는 bigint를 문자열로 돌려준다.
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    url: row.url,
    summary: row.summary,
    createdAt: row.created_at,
  };
}
