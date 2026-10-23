import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { resolveTestUserId } from '../../../common/utils/test-user.util.js';
import { ObjectStorageService } from '../../../core/storage/object-storage.service.js';
import { addItemsToFolders } from '../utils/centroid.util.js';
import { EmbeddingService } from './embedding.service.js';
import { errorMessage } from '../../../common/utils/error-message.util.js';

const FIXTURE_DIR = join(process.cwd(), 'test', 'fixtures', 'dummy-files');
const ROOT_FOLDER_NAME = 'dummy-files';
/** 임베딩에 넣을 텍스트 최대 길이 (문자) */
const MAX_TEXT_CHARS = 6000;
const USER_WAIT_ATTEMPTS = 20;
const USER_WAIT_MS = 500;

interface FixtureFile {
  /** fixture 루트 기준 폴더 ('' = 루트) */
  dir: string;
  name: string;
  /** fixture 루트 기준 경로 (예: folder-03/file-01.txt) */
  path: string;
}

const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`;

const normalize = (v: number[]) => {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
};

/** fixture 폴더(1단계)의 파일을 경로순으로 모은다. 폴더가 없으면 null. */
async function collectFixtures(root: string): Promise<FixtureFile[] | null> {
  const files: FixtureFile[] = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isFile()) {
        files.push({ dir: '', name: entry.name, path: entry.name });
      } else if (entry.isDirectory()) {
        for (const child of await readdir(join(root, entry.name), {
          withFileTypes: true,
        })) {
          if (child.isFile()) {
            files.push({
              dir: entry.name,
              name: child.name,
              path: `${entry.name}/${child.name}`,
            });
          }
        }
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/**
 * TEMP(test): 기동 시 test/fixtures/dummy-files를 테스트 사용자의 드라이브에 업로드한다 (스토리지 → 임베딩 → DB).
 * 검색·다운로드·이동 API를 바로 시험할 수 있게 하기 위한 것으로, 배포 전 제거한다.
 * - non-production + SEED_DUMMY_DRIVE=true + EMBEDDING_API_KEY 설정 시에만 동작한다.
 * - 이미 올린 파일(storage_key 기준)은 건너뛰므로 재기동해도 임베딩 비용이 다시 들지 않는다.
 * - 임베딩 호출이 파일 수만큼 걸려 기동을 막지 않도록 백그라운드로 실행한다.
 */
@Injectable()
export class DriveDummySeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DriveDummySeeder.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly embedding: EmbeddingService,
    private readonly storage: ObjectStorageService,
  ) {}

  onApplicationBootstrap(): void {
    const ownerId = resolveTestUserId();
    if (!ownerId || !this.config.get<boolean>('SEED_DUMMY_DRIVE')) return;
    void this.seed(ownerId).catch((e: Error) =>
      this.logger.error(`더미 파일 업로드 중단: ${errorMessage(e)}`),
    );
  }

  async seed(ownerId: string, root = FIXTURE_DIR): Promise<void> {
    if (!this.config.get<string>('EMBEDDING_API_KEY')) {
      this.logger.warn(
        'EMBEDDING_API_KEY가 없어 더미 파일 업로드를 건너뜁니다.',
      );
      return;
    }
    const files = await collectFixtures(root);
    if (files === null) {
      this.logger.warn(`더미 파일 폴더가 없어 건너뜁니다: ${root}`);
      return;
    }
    if (!(await this.waitForUser(ownerId))) {
      this.logger.warn('테스트 사용자가 없어 더미 파일 업로드를 건너뜁니다.');
      return;
    }

    const prefix = `drive/${ownerId}/seed/`;
    const rows: { storage_key: string }[] = await this.dataSource.query(
      'SELECT storage_key FROM drive_items WHERE owner_id = $1 AND storage_key LIKE $2',
      [ownerId, `${prefix}%`],
    );
    const done = new Set(rows.map((r) => r.storage_key));
    const pending = files.filter((f) => !done.has(prefix + f.path));
    if (pending.length === 0) return;

    this.logger.log(`더미 파일 ${pending.length}개 업로드를 시작합니다.`);
    const folderIds = new Map<string, string>();
    for (const file of pending) {
      const buffer = await readFile(join(root, file.path));
      const storageKey = prefix + file.path;

      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ');
      const text = buffer
        .toString('utf8')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT_CHARS);
      const embedding = normalize(
        await this.embedding.embed(`${title}\n${text}`),
      );

      await this.storage.put(storageKey, buffer, 'text/plain');
      const folderId = await this.ensureFolder(ownerId, file.dir, folderIds);
      await this.insertItem(
        ownerId,
        folderId,
        file,
        buffer,
        storageKey,
        text,
        embedding,
      );
    }
    this.logger.log(`더미 파일 ${pending.length}개를 업로드했습니다.`);
  }

  /** TestUserSeeder가 사용자를 만들 때까지 잠시 기다린다 (모듈 간 기동 순서가 보장되지 않는다). */
  private async waitForUser(ownerId: string): Promise<boolean> {
    for (let i = 0; i < USER_WAIT_ATTEMPTS; i++) {
      const rows: unknown[] = await this.dataSource.query(
        'SELECT 1 FROM users WHERE id = $1',
        [ownerId],
      );
      if (rows.length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, USER_WAIT_MS));
    }
    return false;
  }

  /** 루트 파일은 'dummy-files' 폴더에, 하위 폴더 파일은 그 아래 같은 이름의 폴더에 둔다. */
  private async ensureFolder(
    ownerId: string,
    dir: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const cached = cache.get(dir);
    if (cached) return cached;

    const parentId = dir ? await this.ensureFolder(ownerId, '', cache) : null;
    const name = dir || ROOT_FOLDER_NAME;
    const found: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM drive_folders
        WHERE owner_id = $1 AND name = $2 AND parent_id IS NOT DISTINCT FROM $3::uuid
          AND deleted_at IS NULL`,
      [ownerId, name, parentId],
    );
    const id =
      found[0]?.id ??
      (
        (await this.dataSource.query(
          `INSERT INTO drive_folders (owner_id, name, parent_id, item_count)
           VALUES ($1, $2, $3, 0) RETURNING id`,
          [ownerId, name, parentId],
        )) as { id: string }[]
      )[0]!.id;
    cache.set(dir, id);
    return id;
  }

  private insertItem(
    ownerId: string,
    folderId: string,
    file: FixtureFile,
    buffer: Buffer,
    storageKey: string,
    text: string,
    embedding: number[],
  ): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      const rows: { id: string }[] = await em.query(
        `INSERT INTO drive_items
           (owner_id, folder_id, kind, name, mime_type, size_bytes, storage_key,
            checksum_sha256, summary, embedding)
         VALUES ($1, $2, 'FILE', $3, 'text/plain', $4, $5, $6, $7, $8::vector)
         ON CONFLICT (storage_key) DO NOTHING
         RETURNING id`,
        [
          ownerId,
          folderId,
          file.name,
          buffer.length,
          storageKey,
          createHash('sha256').update(buffer).digest('hex'),
          text.slice(0, 500),
          toVectorLiteral(embedding),
        ],
      );
      if (rows[0]) await addItemsToFolders(em, [rows[0].id]);
    });
  }
}
