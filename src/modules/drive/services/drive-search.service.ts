import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  DriveItemKind,
  DriveSearchItemDto,
  DriveSearchResponseDto,
} from '../dto/drive-search-response.dto.js';
import { EmbeddingService } from './embedding.service.js';

export interface DriveSearchOptions {
  query: string;
  /** 지정하면 이 폴더 안에서만 찾는다. */
  folderId?: string;
  limit?: number;
}

interface SearchRow {
  id: string;
  folder_id: string;
  folder_name: string;
  kind: DriveItemKind;
  name: string;
  mime_type: string | null;
  size_bytes: string | null;
  url: string | null;
  summary: string | null;
  similarity: string | number;
  created_at: Date;
}

const DEFAULT_LIMIT = 20;

const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`;

/** 검색어를 임베딩해 drive_items를 코사인 유사도 순으로 찾는다 (pgvector). */
@Injectable()
export class DriveSearchService {
  private readonly logger = new Logger(DriveSearchService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly embedding: EmbeddingService,
  ) {}

  async search(
    ownerId: string,
    { query, folderId, limit = DEFAULT_LIMIT }: DriveSearchOptions,
  ): Promise<DriveSearchResponseDto> {
    // 임베딩 API 호출 전에 확인한다: 남의 폴더/없는 폴더로 비용을 쓰지 않는다.
    if (folderId) await this.assertFolderOwned(ownerId, folderId);

    const vector = toVectorLiteral(await this.embedQuery(query));

    // 폴더 조건은 owner 조건과 함께 건다. folderId만으로 거르면 다른 사용자의 항목이 섞일 수 있다.
    const params: unknown[] = [ownerId, vector, limit];
    let scope = '';
    if (folderId) {
      params.push(folderId);
      // 선택한 폴더와 그 하위 폴더 전체
      scope = `AND i.folder_id IN (
        WITH RECURSIVE subtree AS (
          SELECT id FROM drive_folders WHERE id = $4 AND deleted_at IS NULL
          UNION ALL
          SELECT f.id FROM drive_folders f JOIN subtree s ON f.parent_id = s.id
           WHERE f.deleted_at IS NULL
        ) SELECT id FROM subtree)`;
    }

    const rows: SearchRow[] = await this.dataSource.query(
      `SELECT i.id, i.folder_id, f.name AS folder_name, i.kind, i.name, i.mime_type,
              i.size_bytes, i.url, i.summary, i.created_at,
              1 - (i.embedding <=> $2::vector) AS similarity
         FROM drive_items i
         JOIN drive_folders f ON f.id = i.folder_id
        WHERE i.owner_id = $1 AND i.deleted_at IS NULL ${scope}
        ORDER BY i.embedding <=> $2::vector
        LIMIT $3`,
      params,
    );

    return { items: rows.map(toItem) };
  }

  private async assertFolderOwned(
    ownerId: string,
    folderId: string,
  ): Promise<void> {
    const rows: unknown[] = await this.dataSource.query(
      'SELECT 1 FROM drive_folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL',
      [folderId, ownerId],
    );
    // 다른 사용자의 폴더도 존재 여부를 드러내지 않도록 404로 통일한다.
    if (rows.length === 0)
      throw new NotFoundException('폴더를 찾을 수 없습니다.');
  }

  private async embedQuery(query: string): Promise<number[]> {
    try {
      return await this.embedding.embed(query);
    } catch (e) {
      this.logger.error(`검색어 임베딩 실패: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        '검색을 일시적으로 사용할 수 없습니다.',
      );
    }
  }
}

function toItem(row: SearchRow): DriveSearchItemDto {
  return {
    id: row.id,
    folderId: row.folder_id,
    folderName: row.folder_name,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    // pg는 bigint/float8 계산 결과를 문자열로 돌려줄 수 있다.
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    url: row.url,
    summary: row.summary,
    similarity: Number(row.similarity),
    createdAt: row.created_at,
  };
}
