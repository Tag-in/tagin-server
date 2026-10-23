import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { ObjectStorageService } from '../../../../core/storage/object-storage.service.js';
import { DriveItemKind } from '../../dto/drive-search-response.dto.js';
import { DriveUploadService } from '../drive-upload.service.js';
import type { EmbeddingService } from '../embedding.service.js';

describe('DriveUploadService', () => {
  /** SQL 문구로 응답을 고르는 가짜 DB */
  const db = {
    ownedFolders: new Map<string, string>(),
    nearest: null as { id: string; name: string; similarity: number } | null,
    rootNames: [] as string[],
    itemNames: [] as string[],
    failInsert: false,
  };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('SELECT id, name FROM drive_folders WHERE id = $1')) {
      const name = db.ownedFolders.get(params[0] as string);
      return name ? [{ id: params[0], name }] : [];
    }
    if (sql.includes('centroid <=>')) return db.nearest ? [db.nearest] : [];
    if (sql.includes('parent_id IS NULL AND deleted_at IS NULL'))
      return db.rootNames.map((name) => ({ name }));
    if (sql.includes('INSERT INTO drive_folders'))
      return [{ id: 'new-folder' }];
    if (sql.includes('SELECT name FROM drive_items'))
      return db.itemNames.map((name) => ({ name }));
    if (sql.includes('INSERT INTO drive_items')) {
      if (db.failInsert) throw new Error('db down');
      const [, folderId, kind, name, mimeType, size, , url, , summary] = params;
      return [
        {
          id: 'new-item',
          folder_id: folderId,
          kind,
          name,
          mime_type: mimeType,
          size_bytes: size === null ? null : String(size),
          url,
          summary,
          created_at: new Date(0),
        },
      ];
    }
    if (sql.includes('UPDATE drive_folders f')) return [];
    throw new Error(`unexpected sql: ${sql}`);
  });
  const dataSource = {
    query,
    transaction: vi.fn((work: (em: unknown) => unknown) => work({ query })),
  };
  const embedding = { embed: vi.fn() };
  const storage = {
    put: vi.fn(),
    deleteMany: vi.fn(),
  };
  const config = { getOrThrow: vi.fn().mockReturnValue(0.55) };
  const service = new DriveUploadService(
    dataSource as unknown as DataSource,
    embedding as unknown as EmbeddingService,
    storage as unknown as ObjectStorageService,
    config as unknown as ConfigService,
  );

  const file = (name: string, body = '분기 매출 보고') => ({
    originalName: name,
    mimeType: 'text/plain',
    buffer: Buffer.from(body, 'utf8'),
  });
  const insertParams = () =>
    query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO drive_items'),
    )![1]!;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      ownedFolders: new Map([['f1', '매출 보고']]),
      nearest: null,
      rootNames: [],
      itemNames: [],
      failInsert: false,
    });
    embedding.embed.mockResolvedValue([3, 4]);
    storage.put.mockResolvedValue(undefined);
    storage.deleteMany.mockResolvedValue([]);
  });

  it('가장 비슷한 폴더가 기준 이상이면 그 폴더에 넣는다', async () => {
    db.nearest = { id: 'f1', name: '매출 보고', similarity: 0.8 };

    const result = await service.uploadFile('user-1', file('분기 매출.txt'));

    expect(embedding.embed).toHaveBeenCalledWith('분기 매출\n분기 매출 보고');
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^drive\/user-1\/[0-9a-f-]+\.txt$/),
      expect.any(Buffer),
      'text/plain',
    );
    expect(result).toMatchObject({
      folder: { id: 'f1', name: '매출 보고' },
      folderCreated: false,
      similarity: 0.8,
      item: {
        id: 'new-item',
        folderId: 'f1',
        kind: DriveItemKind.FILE,
        name: '분기 매출.txt',
        sizeBytes: Buffer.byteLength('분기 매출 보고'),
      },
    });
    // 단위 벡터로 저장하고, 폴더 centroid에 더한다.
    expect(insertParams()[10]).toBe('[0.6,0.8]');
    expect(
      query.mock.calls.some(([sql]) => sql.includes('UPDATE drive_folders f')),
    ).toBe(true);
  });

  it('비슷한 폴더가 없으면 내용에 맞는 이름으로 최상위 폴더를 만든다 (이름이 겹치면 번호)', async () => {
    db.nearest = { id: 'f1', name: '매출 보고', similarity: 0.3 };
    db.rootNames = ['매출 분기'];

    const result = await service.uploadFile(
      'user-1',
      file('분기 매출.txt', '매출 분기 매출'),
    );

    const created = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO drive_folders'),
    )!;
    expect(created[1]).toEqual(['user-1', '매출 분기 (1)']);
    expect(result).toMatchObject({
      folder: { id: 'new-folder', name: '매출 분기 (1)' },
      folderCreated: true,
      similarity: null,
    });
  });

  it('folderId를 주면 분류하지 않고 그 폴더에 넣으며, 같은 이름이 있으면 번호를 붙인다', async () => {
    db.itemNames = ['분기 매출.txt'];

    const result = await service.uploadFile(
      'user-1',
      file('분기 매출.txt'),
      'f1',
    );

    expect(query.mock.calls.some(([sql]) => sql.includes('centroid <=>'))).toBe(
      false,
    );
    expect(result).toMatchObject({
      folder: { id: 'f1', name: '매출 보고' },
      folderCreated: false,
      similarity: null,
      item: { name: '분기 매출 (1).txt' },
    });
  });

  it('내 폴더가 아니면 임베딩·스토리지를 쓰지 않고 404를 던진다', async () => {
    await expect(
      service.uploadFile('user-1', file('a.txt'), 'other'),
    ).rejects.toThrow(NotFoundException);
    expect(embedding.embed).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('빈 파일은 400', async () => {
    await expect(
      service.uploadFile('user-1', file('a.txt', '')),
    ).rejects.toThrow(BadRequestException);
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it('임베딩에 실패하면 스토리지에 올리지 않고 503', async () => {
    embedding.embed.mockRejectedValueOnce(new Error('embedding API 500'));

    await expect(service.uploadFile('user-1', file('a.txt'))).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('DB 저장에 실패하면 올린 객체를 지운다', async () => {
    db.failInsert = true;

    await expect(service.uploadFile('user-1', file('a.txt'))).rejects.toThrow(
      'db down',
    );
    const key = storage.put.mock.calls[0]![0];
    expect(storage.deleteMany).toHaveBeenCalledWith([key]);
  });

  it('링크는 스토리지에 올리지 않고 URL과 제목만 저장한다', async () => {
    const result = await service.uploadLink('user-1', {
      url: 'https://youtube.com/watch?v=abc',
      title: '김치찌개 레시피 영상',
    });

    expect(storage.put).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      folderCreated: true,
      item: {
        kind: DriveItemKind.LINK,
        name: '김치찌개 레시피 영상',
        url: 'https://youtube.com/watch?v=abc',
        mimeType: null,
        sizeBytes: null,
      },
    });
  });
});
