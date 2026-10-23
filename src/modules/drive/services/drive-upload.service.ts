import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { errorMessage } from '../../../common/utils/error-message.util.js';
import { ObjectStorageService } from '../../../core/storage/object-storage.service.js';
import { DriveItemKind } from '../dto/drive-search-response.dto.js';
import type {
  UploadLinkDto,
  UploadResponseDto,
} from '../dto/upload-drive.dto.js';
import { addItemsToFolders } from '../utils/centroid.util.js';
import { resolveUniqueName } from '../utils/unique-name.util.js';
import {
  analyzeFile,
  analyzeLink,
  folderNameFor,
  normalizeVector,
  storageKeyFor,
  SUMMARY_CHARS,
  toVectorLiteral,
  type AnalyzedContent,
} from '../utils/upload-content.util.js';
import { ITEM_COLUMNS, toItem, type ItemRow } from './drive-browse.service.js';
import { EmbeddingService } from './embedding.service.js';

export interface UploadedFile {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

interface ItemMeta {
  kind: DriveItemKind;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  url: string | null;
  checksumSha256: string | null;
}

interface Placement {
  folder: { id: string; name: string };
  folderCreated: boolean;
  similarity: number | null;
}

/**
 * 파일·링크를 드라이브에 올린다. 내용을 임베딩해 가장 비슷한 폴더(코사인 유사도 ≥ DRIVE_SIMILARITY_THRESHOLD)에
 * 넣고, 없으면 내용에 맞는 이름으로 최상위 폴더를 새로 만든다. folderId를 주면 그 폴더에 바로 넣는다.
 */
@Injectable()
export class DriveUploadService {
  private readonly logger = new Logger(DriveUploadService.name);
  private readonly threshold: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly embedding: EmbeddingService,
    private readonly storage: ObjectStorageService,
    config: ConfigService,
  ) {
    this.threshold = config.getOrThrow<number>('DRIVE_SIMILARITY_THRESHOLD');
  }

  async uploadFile(
    ownerId: string,
    file: UploadedFile,
    folderId?: string,
  ): Promise<UploadResponseDto> {
    if (file.buffer.length === 0) {
      throw new BadRequestException('빈 파일은 올릴 수 없습니다.');
    }
    // 임베딩 API 호출 전에 확인한다: 남의 폴더/없는 폴더로 비용을 쓰지 않는다.
    if (folderId)
      await this.assertFolderOwned(this.dataSource, ownerId, folderId);

    const analyzed = await analyzeFile(
      file.originalName,
      file.mimeType,
      file.buffer,
    );
    const embedding = await this.embed(analyzed);

    // 스토리지 업로드는 트랜잭션(락) 밖에서 먼저 하고, DB 저장에 실패하면 지운다.
    const storageKey = storageKeyFor(ownerId, randomUUID(), file.originalName);
    await this.storage.put(storageKey, file.buffer, file.mimeType);
    try {
      return await this.save(ownerId, analyzed, embedding, folderId, {
        kind: DriveItemKind.FILE,
        name: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,
        storageKey,
        url: null,
        checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
      });
    } catch (e) {
      await this.storage.deleteMany([storageKey]).catch(() => []);
      throw e;
    }
  }

  async uploadLink(
    ownerId: string,
    dto: UploadLinkDto,
  ): Promise<UploadResponseDto> {
    if (dto.folderId)
      await this.assertFolderOwned(this.dataSource, ownerId, dto.folderId);

    const url = new URL(dto.url);
    const analyzed = analyzeLink(url, dto.title, dto.description);
    const embedding = await this.embed(analyzed);

    return this.save(ownerId, analyzed, embedding, dto.folderId, {
      kind: DriveItemKind.LINK,
      name: analyzed.title,
      mimeType: null,
      sizeBytes: null,
      storageKey: null,
      url: url.toString(),
      checksumSha256: null,
    });
  }

  private async embed({ title, text }: AnalyzedContent): Promise<number[]> {
    const input = `${title}\n${text}`.trim();
    if (!input) {
      throw new BadRequestException('분류할 내용을 찾을 수 없습니다.');
    }
    try {
      return normalizeVector(await this.embedding.embed(input));
    } catch (e) {
      this.logger.error(`업로드 임베딩 실패: ${errorMessage(e)}`);
      throw new ServiceUnavailableException(
        '업로드를 일시적으로 사용할 수 없습니다.',
      );
    }
  }

  private save(
    ownerId: string,
    analyzed: AnalyzedContent,
    embedding: number[],
    folderId: string | undefined,
    meta: ItemMeta,
  ): Promise<UploadResponseDto> {
    const vector = toVectorLiteral(embedding);
    // 새 폴더 이름은 락을 잡기 전에 정해 둔다.
    const newFolderName = folderNameFor(analyzed);

    return this.dataSource.transaction(async (em) => {
      // 동시 업로드가 같은 이름의 폴더를 만들거나 같은 이름의 항목을 넣지 않도록 사용자 단위로 직렬화한다.
      await em.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `drive-upload:${ownerId}`,
      ]);

      const placement = folderId
        ? {
            folder: await this.assertFolderOwned(em, ownerId, folderId),
            folderCreated: false,
            similarity: null,
          }
        : await this.classify(em, ownerId, vector, newFolderName);

      const taken: { name: string }[] = await em.query(
        'SELECT name FROM drive_items WHERE folder_id = $1 AND deleted_at IS NULL',
        [placement.folder.id],
      );
      const name = resolveUniqueName(
        meta.name,
        new Set(taken.map((r) => r.name)),
        { keepExtension: meta.kind === DriveItemKind.FILE },
      );

      const rows: ItemRow[] = await em.query(
        `INSERT INTO drive_items
           (owner_id, folder_id, kind, name, mime_type, size_bytes, storage_key, url,
            checksum_sha256, summary, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
         RETURNING ${ITEM_COLUMNS}`,
        [
          ownerId,
          placement.folder.id,
          meta.kind,
          name,
          meta.mimeType,
          meta.sizeBytes,
          meta.storageKey,
          meta.url,
          meta.checksumSha256,
          analyzed.text.slice(0, SUMMARY_CHARS) || null,
          vector,
        ],
      );
      const item = rows[0]!;
      await addItemsToFolders(em, [item.id]);

      return { item: toItem(item), ...placement };
    });
  }

  /** 가장 비슷한 폴더가 기준 이상이면 그 폴더, 아니면 최상위에 새 폴더를 만든다. */
  private async classify(
    em: EntityManager,
    ownerId: string,
    vector: string,
    newFolderName: string,
  ): Promise<Placement> {
    const nearest: { id: string; name: string; similarity: string | number }[] =
      await em.query(
        `SELECT id, name, 1 - (centroid <=> $2::vector) AS similarity
           FROM drive_folders
          WHERE owner_id = $1 AND centroid IS NOT NULL AND deleted_at IS NULL
          ORDER BY centroid <=> $2::vector
          LIMIT 1`,
        [ownerId, vector],
      );
    const best = nearest[0];
    if (best && Number(best.similarity) >= this.threshold) {
      return {
        folder: { id: best.id, name: best.name },
        folderCreated: false,
        similarity: Number(best.similarity),
      };
    }

    const roots: { name: string }[] = await em.query(
      'SELECT name FROM drive_folders WHERE owner_id = $1 AND parent_id IS NULL AND deleted_at IS NULL',
      [ownerId],
    );
    const name = resolveUniqueName(
      newFolderName,
      new Set(roots.map((r) => r.name)),
      { keepExtension: false },
    );
    // centroid·item_count는 항목을 넣은 뒤 addItemsToFolders가 채운다.
    const created: { id: string }[] = await em.query(
      `INSERT INTO drive_folders (owner_id, name, parent_id, item_count)
       VALUES ($1, $2, NULL, 0) RETURNING id`,
      [ownerId, name],
    );
    return {
      folder: { id: created[0]!.id, name },
      folderCreated: true,
      similarity: null,
    };
  }

  private async assertFolderOwned(
    runner: Pick<EntityManager, 'query'>,
    ownerId: string,
    folderId: string,
  ): Promise<{ id: string; name: string }> {
    const rows: { id: string; name: string }[] = await runner.query(
      'SELECT id, name FROM drive_folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL',
      [folderId, ownerId],
    );
    // 다른 사용자의 폴더도 존재 여부를 드러내지 않도록 404로 통일한다.
    if (!rows[0]) throw new NotFoundException('폴더를 찾을 수 없습니다.');
    return rows[0];
  }
}
