import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { ObjectStorageService } from '../../../../core/storage/object-storage.service.js';
import { DriveDummySeeder } from '../drive-dummy-seeder.service.js';
import type { EmbeddingService } from '../embedding.service.js';

const OWNER = '00000000-0000-4000-8000-000000000001';

describe('DriveDummySeeder', () => {
  let root: string;
  let apiKey = 'key';
  let existingKeys: string[] = [];
  let userExists = true;
  let folderSeq = 0;

  const em = { query: vi.fn() };
  const dataSource = {
    query: vi.fn(),
    transaction: vi.fn((run: (m: typeof em) => unknown) => run(em)),
  };
  const embedding = { embed: vi.fn(async () => [3, 4]) };
  const storage = { put: vi.fn() };
  const config = {
    get: (key: string) => (key === 'EMBEDDING_API_KEY' ? apiKey : undefined),
  };
  const seeder = new DriveDummySeeder(
    config as unknown as ConfigService,
    dataSource as unknown as DataSource,
    embedding as unknown as EmbeddingService,
    storage as unknown as ObjectStorageService,
  );

  const sqlCalls = (db: { query: ReturnType<typeof vi.fn> }, text: string) =>
    db.query.mock.calls.filter(([sql]) => String(sql).includes(text));

  beforeEach(async () => {
    vi.clearAllMocks();
    apiKey = 'key';
    existingKeys = [];
    userExists = true;
    folderSeq = 0;
    root = await mkdtemp(join(tmpdir(), 'dummy-seed-'));
    await writeFile(join(root, 'a.txt'), 'hello a');
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'sub', 'b.txt'), 'hello b');

    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) return userExists ? [{}] : [];
      if (sql.includes('SELECT storage_key'))
        return existingKeys.map((storage_key) => ({ storage_key }));
      if (sql.includes('SELECT id FROM drive_folders')) return [];
      if (sql.includes('INSERT INTO drive_folders'))
        return [{ id: `folder-${++folderSeq}` }];
      return [];
    });
    em.query.mockImplementation(async (sql: string) =>
      sql.includes('INSERT INTO drive_items') ? [{ id: 'item-1' }] : [],
    );
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('파일을 스토리지에 올리고 임베딩해 폴더 구조와 함께 저장한다', async () => {
    await seeder.seed(OWNER, root);

    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(storage.put).toHaveBeenCalledWith(
      `drive/${OWNER}/seed/sub/b.txt`,
      expect.any(Buffer),
      'text/plain',
    );
    expect(embedding.embed).toHaveBeenCalledTimes(2);

    // 루트 폴더 'dummy-files'와 하위 폴더 'sub' (부모 = 루트 폴더)
    const folders = sqlCalls(dataSource, 'INSERT INTO drive_folders');
    expect(folders.map(([, p]) => [p[1], p[2]])).toEqual([
      ['dummy-files', null],
      ['sub', 'folder-1'],
    ]);

    // 단위 벡터로 정규화해서 저장하고 폴더 centroid를 갱신한다
    const items = sqlCalls(em, 'INSERT INTO drive_items');
    expect(items).toHaveLength(2);
    expect(items[0]![1][7]).toBe('[0.6,0.8]');
    expect(sqlCalls(em, 'UPDATE drive_folders')).toHaveLength(2);
  });

  it('이미 올린 파일은 임베딩·업로드 없이 건너뛴다', async () => {
    existingKeys = [
      `drive/${OWNER}/seed/a.txt`,
      `drive/${OWNER}/seed/sub/b.txt`,
    ];

    await seeder.seed(OWNER, root);

    expect(embedding.embed).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('일부만 올라가 있으면 나머지만 올린다', async () => {
    existingKeys = [`drive/${OWNER}/seed/a.txt`];

    await seeder.seed(OWNER, root);

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledWith(
      `drive/${OWNER}/seed/sub/b.txt`,
      expect.any(Buffer),
      'text/plain',
    );
  });

  it('임베딩 API 키가 없으면 아무것도 하지 않는다', async () => {
    apiKey = '';

    await seeder.seed(OWNER, root);

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('fixture 폴더가 없으면 건너뛴다', async () => {
    await seeder.seed(OWNER, join(root, 'missing'));

    expect(storage.put).not.toHaveBeenCalled();
  });

  it('임베딩이 실패하면 DB에 아무것도 남기지 않고 오류를 던진다', async () => {
    embedding.embed.mockRejectedValueOnce(new Error('embedding API 401'));

    await expect(seeder.seed(OWNER, root)).rejects.toThrow('embedding API 401');
    expect(storage.put).not.toHaveBeenCalled();
    expect(sqlCalls(em, 'INSERT INTO drive_items')).toHaveLength(0);
  });
});
