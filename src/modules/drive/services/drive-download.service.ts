import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZipArchive } from 'archiver';
import { DataSource } from 'typeorm';
import { ObjectStorageService } from '../../../core/storage/object-storage.service.js';
import { DriveSelectionDto } from '../dto/drive-selection.dto.js';
import { DriveItemKind } from '../dto/drive-search-response.dto.js';
import { DownloadUrlResponseDto } from '../dto/download-response.dto.js';
import { assertAllFound, sortByRequest } from '../utils/selection.util.js';
import {
  buildZipPlan,
  type ZipEntry,
  type ZipFile,
  type ZipFolder,
} from '../utils/zip-plan.util.js';

/** presigned URL 유효 시간 */
const URL_EXPIRES_SECONDS = 5 * 60;

interface ItemRow {
  id: string;
  folder_id: string;
  name: string;
  kind: DriveItemKind;
  size_bytes: string | null;
  storage_key: string | null;
}

export interface DriveArchive {
  filename: string;
  archive: ZipArchive;
}

@Injectable()
export class DriveDownloadService {
  private readonly logger = new Logger(DriveDownloadService.name);
  private readonly maxBytes: number;
  private readonly maxFiles: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: ObjectStorageService,
    config: ConfigService,
  ) {
    this.maxBytes = config.getOrThrow<number>('DOWNLOAD_ZIP_MAX_BYTES');
    this.maxFiles = config.getOrThrow<number>('DOWNLOAD_ZIP_MAX_FILES');
  }

  /** 파일 1개를 내려받는 임시 URL. 파일 바이트는 서버를 거치지 않고 스토리지에서 직접 내려간다. */
  async getDownloadUrl(
    userId: string,
    itemId: string,
  ): Promise<DownloadUrlResponseDto> {
    const [item] = await this.dataSource.query<
      Pick<ItemRow, 'name' | 'kind' | 'storage_key'>[]
    >(
      `SELECT name, kind, storage_key FROM drive_items
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [itemId, userId],
    );
    if (!item) throw new NotFoundException('파일을 찾을 수 없습니다.');
    if (item.kind !== DriveItemKind.FILE || !item.storage_key) {
      throw new BadRequestException(
        '링크는 내려받을 파일이 없습니다. 링크의 url로 이동하세요.',
      );
    }

    const url = await this.storage.getDownloadUrl(
      item.storage_key,
      item.name,
      URL_EXPIRES_SECONDS,
    );
    return {
      url,
      filename: item.name,
      expiresAt: new Date(Date.now() + URL_EXPIRES_SECONDS * 1000),
    };
  }

  /**
   * 선택한 파일·폴더를 폴더 구조를 유지한 ZIP으로 묶는다. 폴더는 하위 폴더까지 포함하고 링크·휴지통 항목은 제외한다.
   * 크기와 개수 한도는 스트리밍을 시작하기 전에 검사한다. 시작한 뒤에는 상태 코드를 바꿀 수 없다.
   * 반환된 archive를 응답에 연결하면 파일을 하나씩 스토리지에서 읽어 채운다.
   */
  async createArchive(
    userId: string,
    { itemIds = [], folderIds = [] }: DriveSelectionDto,
  ): Promise<DriveArchive> {
    if (itemIds.length === 0 && folderIds.length === 0) {
      throw new BadRequestException(
        '내려받을 파일 또는 폴더를 지정해야 합니다.',
      );
    }

    const requestedItems = sortByRequest(
      itemIds.length === 0
        ? []
        : await this.dataSource.query<ItemRow[]>(
            `SELECT id, folder_id, name, kind, size_bytes, storage_key FROM drive_items
              WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL`,
            [itemIds, userId],
          ),
      itemIds,
    );
    const rootRows = sortByRequest(
      folderIds.length === 0
        ? []
        : await this.dataSource.query<
            { id: string; parent_id: null; name: string }[]
          >(
            `SELECT id, parent_id, name FROM drive_folders
              WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL`,
            [folderIds, userId],
          ),
      folderIds,
    );
    assertAllFound('파일', itemIds, requestedItems);
    assertAllFound('폴더', folderIds, rootRows);
    const roots = rootRows.map(toZipFolder);

    const tree = roots.length === 0 ? [] : await this.loadTree(folderIds);
    const treeItems =
      tree.length === 0
        ? []
        : await this.dataSource.query<ItemRow[]>(
            `SELECT id, folder_id, name, kind, size_bytes, storage_key FROM drive_items
              WHERE folder_id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL`,
            [tree.map((f) => f.id), userId],
          );

    const rows = new Map<string, ItemRow>();
    for (const row of [...requestedItems, ...treeItems]) rows.set(row.id, row);
    const downloadable = [...rows.values()].filter(
      (row) => row.kind === DriveItemKind.FILE && row.storage_key !== null,
    );
    if (downloadable.length === 0) {
      throw new BadRequestException('내려받을 파일이 없습니다.');
    }
    this.assertWithinLimits(downloadable);

    const entries = buildZipPlan({
      roots,
      folders: tree,
      files: downloadable.map(toZipFile),
    });
    const archive = new ZipArchive({ zlib: { level: 1 } });
    void this.feed(archive, entries);

    return {
      filename: this.archiveName(roots, itemIds.length),
      archive,
    };
  }

  /** 선택한 폴더와 그 아래의 살아 있는 폴더 전체 */
  private loadTree(rootIds: string[]): Promise<ZipFolder[]> {
    return this.dataSource
      .query<{ id: string; parent_id: string | null; name: string }[]>(
        `WITH RECURSIVE tree AS (
           SELECT id, parent_id, name FROM drive_folders
            WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
           UNION ALL
           SELECT f.id, f.parent_id, f.name FROM drive_folders f
             JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at IS NULL
         ) SELECT id, parent_id, name FROM tree ORDER BY name`,
        [rootIds],
      )
      .then((rows) => rows.map(toZipFolder));
  }

  private assertWithinLimits(files: ItemRow[]): void {
    if (files.length > this.maxFiles) {
      throw new PayloadTooLargeException(
        `한 번에 내려받을 수 있는 파일은 ${this.maxFiles}개까지입니다. (선택: ${files.length}개)`,
      );
    }
    // pg는 bigint를 문자열로 돌려준다.
    const total = files.reduce((sum, f) => sum + Number(f.size_bytes ?? 0), 0);
    if (total > this.maxBytes) {
      throw new PayloadTooLargeException(
        `한 번에 내려받을 수 있는 크기는 ${formatBytes(this.maxBytes)}까지입니다. 나눠서 내려받으세요.`,
      );
    }
  }

  private archiveName(roots: ZipFolder[], itemCount: number): string {
    // 폴더 하나만 고르면 그 폴더 이름을, 아니면 날짜로 정한다.
    if (roots.length === 1 && itemCount === 0) return `${roots[0].name}.zip`;
    return `drive-${new Date().toISOString().slice(0, 10)}.zip`;
  }

  /**
   * 파일을 하나씩 열어 archive에 넣는다. 한꺼번에 열면 연결이 수천 개가 되므로 항목이 처리될 때까지 기다린 뒤
   * 다음 파일을 연다 (소비 속도에 맞춘 backpressure). 응답이 끊기면(archive 파기) 중단한다.
   */
  private async feed(archive: ZipArchive, entries: ZipEntry[]): Promise<void> {
    try {
      for (const { path, storageKey } of entries) {
        if (archive.destroyed) return;
        if (storageKey === null) {
          archive.append(Buffer.alloc(0), { name: path });
          continue;
        }
        const body = await this.storage.getStream(storageKey);
        await new Promise<void>((resolve, reject) => {
          const done = (error?: Error) => {
            archive.off('entry', onEntry);
            archive.off('close', onClose);
            body.off('error', onError);
            if (error) {
              body.destroy();
              reject(error);
            } else {
              resolve();
            }
          };
          const onEntry = () => done();
          const onClose = () => done(new Error('archive closed'));
          const onError = (error: Error) => done(error);
          archive.on('entry', onEntry);
          archive.on('close', onClose);
          body.on('error', onError);
          archive.append(body, { name: path });
        });
      }
      await archive.finalize();
    } catch (error) {
      // 클라이언트가 끊은 경우는 오류가 아니다.
      if (!archive.destroyed) {
        this.logger.error(`ZIP 생성 실패: ${(error as Error).message}`);
      }
      archive.destroy(error as Error);
    }
  }
}

const toZipFolder = (row: {
  id: string;
  parent_id: string | null;
  name: string;
}): ZipFolder => ({ id: row.id, parentId: row.parent_id, name: row.name });

const toZipFile = (row: ItemRow): ZipFile => ({
  id: row.id,
  folderId: row.folder_id,
  name: row.name,
  storageKey: row.storage_key!,
});

const formatBytes = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${+(bytes / 1024 ** 3).toFixed(1)}GiB`
    : `${+(bytes / 1024 ** 2).toFixed(1)}MiB`;
