import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import { Readable } from 'node:stream';
import type { DataSource } from 'typeorm';
import type { ObjectStorageService } from '../../../../core/storage/object-storage.service.js';
import { DriveItemKind } from '../../dto/drive-search-response.dto.js';
import { DriveDownloadService } from '../drive-download.service.js';

const USER = 'user-1';

const item = (
  id: string,
  folderId: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  folder_id: folderId,
  name,
  kind: DriveItemKind.FILE,
  size_bytes: '10',
  storage_key: `key-${id}`,
  ...extra,
});

describe('DriveDownloadService', () => {
  let requestedItems: ReturnType<typeof item>[];
  let requestedFolders: {
    id: string;
    parent_id: string | null;
    name: string;
  }[];
  let tree: { id: string; parent_id: string | null; name: string }[];
  let treeItems: ReturnType<typeof item>[];
  let single: unknown[];
  let limits: { bytes: number; files: number };

  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT name, kind, storage_key')) return single;
    if (sql.includes('WITH RECURSIVE tree')) return tree;
    if (sql.includes('FROM drive_items') && sql.includes('folder_id = ANY')) {
      return treeItems;
    }
    if (sql.includes('FROM drive_items')) return requestedItems;
    if (sql.includes('FROM drive_folders')) return requestedFolders;
    return [];
  });
  const storage = {
    getDownloadUrl: vi.fn(async () => 'https://s3.example/signed'),
    getStream: vi.fn(async (key: string) =>
      Readable.from([Buffer.from(`data:${key}`)]),
    ),
  };
  const buildService = () =>
    new DriveDownloadService(
      { query } as unknown as DataSource,
      storage as unknown as ObjectStorageService,
      {
        getOrThrow: (key: string) =>
          key === 'DOWNLOAD_ZIP_MAX_BYTES' ? limits.bytes : limits.files,
      } as unknown as ConfigService,
    );
  let service: DriveDownloadService;

  const readZip = async (archive: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of archive) chunks.push(chunk as Buffer);
    return JSZip.loadAsync(Buffer.concat(chunks));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requestedItems = [];
    requestedFolders = [];
    tree = [];
    treeItems = [];
    single = [];
    limits = { bytes: 1000, files: 100 };
    service = buildService();
  });

  describe('getDownloadUrl', () => {
    it('내 파일이면 5분짜리 임시 URL과 만료 시각을 반환한다', async () => {
      single = [
        { name: '분기 매출.pdf', kind: DriveItemKind.FILE, storage_key: 'k1' },
      ];

      const res = await service.getDownloadUrl(USER, 'i1');

      expect(storage.getDownloadUrl).toHaveBeenCalledWith(
        'k1',
        '분기 매출.pdf',
        300,
      );
      expect(res.url).toBe('https://s3.example/signed');
      expect(res.filename).toBe('분기 매출.pdf');
      expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now() + 290_000);
    });

    it('소유자·휴지통 조건으로 조회한다', async () => {
      single = [];

      await expect(service.getDownloadUrl(USER, 'i1')).rejects.toThrow(
        NotFoundException,
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('owner_id = $2 AND deleted_at IS NULL'),
        ['i1', USER],
      );
    });

    it('링크는 내려받을 파일이 없어 400', async () => {
      single = [{ name: '영상', kind: DriveItemKind.LINK, storage_key: null }];

      await expect(service.getDownloadUrl(USER, 'i1')).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.getDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('createArchive', () => {
    it('선택 대상이 없으면 400', async () => {
      await expect(service.createArchive(USER, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('요청한 항목이 없거나 남의 것이면 404', async () => {
      requestedItems = [item('i1', 'f', 'a.pdf')];

      await expect(
        service.createArchive(USER, { itemIds: ['i1', 'i2'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('내려받을 파일이 없으면(링크만 선택 등) 400', async () => {
      requestedItems = [
        item('i1', 'f', '영상', {
          kind: DriveItemKind.LINK,
          storage_key: null,
        }),
      ];

      await expect(
        service.createArchive(USER, { itemIds: ['i1'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('파일 수 한도를 넘으면 스트리밍 전에 413', async () => {
      limits.files = 1;
      service = buildService();
      requestedItems = [item('i1', 'f', 'a.pdf'), item('i2', 'f', 'b.pdf')];

      await expect(
        service.createArchive(USER, { itemIds: ['i1', 'i2'] }),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    it('총 크기 한도를 넘으면 스트리밍 전에 413', async () => {
      limits.bytes = 15;
      service = buildService();
      requestedItems = [item('i1', 'f', 'a.pdf'), item('i2', 'f', 'b.pdf')];

      await expect(
        service.createArchive(USER, { itemIds: ['i1', 'i2'] }),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('선택한 파일을 ZIP에 담는다 (링크는 제외)', async () => {
      requestedItems = [
        item('i1', 'f', 'a.pdf'),
        item('i2', 'f', '영상', {
          kind: DriveItemKind.LINK,
          storage_key: null,
        }),
      ];

      const { filename, archive } = await service.createArchive(USER, {
        itemIds: ['i1', 'i2'],
      });
      const zip = await readZip(archive);

      expect(filename).toMatch(/^drive-\d{4}-\d{2}-\d{2}\.zip$/);
      expect(Object.keys(zip.files)).toEqual(['a.pdf']);
      expect(await zip.file('a.pdf')!.async('string')).toBe('data:key-i1');
    });

    it('폴더를 고르면 폴더 구조를 유지하고 폴더 이름으로 ZIP 이름을 정한다', async () => {
      requestedFolders = [{ id: 'd', parent_id: null, name: 'docs' }];
      tree = [
        { id: 'd', parent_id: null, name: 'docs' },
        { id: 's', parent_id: 'd', name: 'sub' },
        { id: 'e', parent_id: 'd', name: 'empty' },
      ];
      treeItems = [item('i1', 'd', 'a.pdf'), item('i2', 's', 'b.pdf')];

      const { filename, archive } = await service.createArchive(USER, {
        folderIds: ['d'],
      });
      const zip = await readZip(archive);

      expect(filename).toBe('docs.zip');
      expect(Object.keys(zip.files).sort()).toEqual([
        'docs/',
        'docs/a.pdf',
        'docs/empty/',
        'docs/sub/',
        'docs/sub/b.pdf',
      ]);
    });

    it('폴더 안의 파일을 따로 골라도 한 번만 담는다', async () => {
      requestedFolders = [{ id: 'd', parent_id: null, name: 'docs' }];
      tree = [{ id: 'd', parent_id: null, name: 'docs' }];
      requestedItems = [item('i1', 'd', 'a.pdf')];
      treeItems = [item('i1', 'd', 'a.pdf')];

      const { archive } = await service.createArchive(USER, {
        itemIds: ['i1'],
        folderIds: ['d'],
      });
      const zip = await readZip(archive);

      expect(Object.keys(zip.files).sort()).toEqual(['docs/', 'docs/a.pdf']);
    });

    it('스토리지 읽기에 실패하면 스트림을 오류로 끝낸다', async () => {
      requestedItems = [item('i1', 'f', 'a.pdf')];
      storage.getStream.mockRejectedValueOnce(new Error('s3 down'));

      const { archive } = await service.createArchive(USER, {
        itemIds: ['i1'],
      });

      await expect(readZip(archive)).rejects.toThrow('s3 down');
    });

    it('응답이 끊겨 archive가 파기되면 나머지 파일은 열지 않는다', async () => {
      requestedItems = [item('i1', 'f', 'a.pdf'), item('i2', 'f', 'b.pdf')];
      storage.getStream.mockImplementationOnce(async () => {
        // 첫 파일을 여는 사이 클라이언트가 끊은 상황
        archiveRef.destroy();
        return Readable.from([Buffer.from('x')]);
      });
      const archiveRef = (
        await service.createArchive(USER, { itemIds: ['i1', 'i2'] })
      ).archive;
      archiveRef.on('error', () => {});

      await new Promise((r) => setTimeout(r, 50));

      expect(storage.getStream).toHaveBeenCalledTimes(1);
    });
  });
});
