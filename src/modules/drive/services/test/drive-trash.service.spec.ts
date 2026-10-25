import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { MoveEntryType } from '../../dto/move-drive-response.dto.js';
import { DriveTrashService } from '../drive-trash.service.js';

const USER = 'user-1';
const NOW = new Date('2026-10-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const T1 = new Date('2026-09-01T00:00:00.000Z');
const T2 = new Date('2026-09-02T00:00:00.000Z');

describe('DriveTrashService', () => {
  let liveItems: { id: string; folder_id: string }[];
  let liveFolders: { id: string }[];
  let subtree: { id: string }[];
  let trashedItems: unknown[];
  let trashedFolders: unknown[];
  let liveParents: string[];
  let takenItemNames: string[];
  let takenFolderNames: string[];

  const query = vi.fn(async (sql: string) => {
    if (sql.includes('clock_timestamp')) return [{ now: NOW }];
    if (sql.includes('WITH d AS')) return [{ count: 3 }];
    if (sql.includes('FOR UPDATE')) {
      const inTrash = sql.includes('deleted_at IS NOT NULL');
      if (sql.includes('FROM drive_items')) {
        return inTrash ? trashedItems : liveItems;
      }
      return inTrash ? trashedFolders : liveFolders;
    }
    if (sql.includes('SELECT id FROM subtree')) return subtree;
    if (
      sql.includes('deleted_at IS NULL') &&
      sql.includes('SELECT id FROM drive_folders')
    ) {
      return liveParents.map((id) => ({ id }));
    }
    if (sql.startsWith('SELECT name FROM drive_items')) {
      return takenItemNames.map((name) => ({ name }));
    }
    if (sql.startsWith('SELECT name FROM drive_folders')) {
      return takenFolderNames.map((name) => ({ name }));
    }
    return [];
  });
  const dataSource = {
    query,
    transaction: vi.fn((run: (em: { query: typeof query }) => unknown) =>
      run({ query }),
    ),
  };
  const config = { getOrThrow: () => 30 } as unknown as ConfigService;
  const service = new DriveTrashService(
    dataSource as unknown as DataSource,
    config,
  );

  const sqlOf = (re: RegExp) =>
    query.mock.calls.map(([sql]) => sql).filter((sql) => re.test(sql));

  beforeEach(() => {
    vi.clearAllMocks();
    liveItems = [];
    liveFolders = [];
    subtree = [];
    trashedItems = [];
    trashedFolders = [];
    liveParents = [];
    takenItemNames = [];
    takenFolderNames = [];
  });

  describe('delete', () => {
    it('대상이 없으면 400', () => {
      expect(() => service.delete(USER, {})).toThrow(BadRequestException);
    });

    it('이미 휴지통에 있거나 남의 항목이면 404', async () => {
      liveItems = [{ id: 'i1', folder_id: 'f1' }];

      await expect(
        service.delete(USER, { itemIds: ['i1', 'i2'] }),
      ).rejects.toThrow(NotFoundException);
      expect(sqlOf(/UPDATE drive_items SET deleted_at/)).toEqual([]);
    });

    it('개수와 자동 삭제 시각을 반환한다', async () => {
      liveItems = [{ id: 'i1', folder_id: 'f1' }];

      const res = await service.delete(USER, { itemIds: ['i1'] });

      expect(res).toEqual({
        deletedItemCount: 3,
        deletedFolderCount: 3,
        purgeAt: new Date(NOW.getTime() + 30 * DAY_MS),
      });
    });

    it('직접 지우는 항목만 폴더 centroid에서 빼고, 지우는 폴더 안의 항목은 빼지 않는다', async () => {
      liveItems = [
        { id: 'direct', folder_id: 'other' },
        { id: 'inside', folder_id: 'doomed' },
      ];
      liveFolders = [{ id: 'doomed' }];
      subtree = [{ id: 'doomed' }, { id: 'child' }];

      await service.delete(USER, {
        itemIds: ['direct', 'inside'],
        folderIds: ['doomed'],
      });

      const [removal] = sqlOf(/f\.centroid - m\.vsum/);
      expect(removal).toBeDefined();
      expect(query).toHaveBeenCalledWith(removal, [['direct']]);
    });

    it('폴더만 지우면 centroid는 건드리지 않는다', async () => {
      liveFolders = [{ id: 'doomed' }];
      subtree = [{ id: 'doomed' }];

      await service.delete(USER, { folderIds: ['doomed'] });

      expect(sqlOf(/f\.centroid - m\.vsum/)).toEqual([]);
    });

    it('모든 행에 같은 삭제 시각을 찍는다', async () => {
      liveFolders = [{ id: 'doomed' }];
      subtree = [{ id: 'doomed' }];

      await service.delete(USER, { folderIds: ['doomed'] });

      const stamped = query.mock.calls.filter(([sql]) =>
        /SET deleted_at = \$1/.test(sql),
      );
      expect(stamped).toHaveLength(2);
      for (const [, params] of stamped) expect(params![0]).toBe(NOW);
    });
  });

  describe('restore', () => {
    const trashedItem = (id: string, folder: string, at = T1) => ({
      id,
      name: `${id}.pdf`,
      folder_id: folder,
      deleted_at: at,
    });
    const trashedFolder = (id: string, parent: string | null, at = T1) => ({
      id,
      name: id,
      parent_id: parent,
      deleted_at: at,
    });

    it('대상이 없으면 400', () => {
      expect(() => service.restore(USER, {})).toThrow(BadRequestException);
    });

    it('휴지통에 없는 항목이면 404', async () => {
      await expect(service.restore(USER, { itemIds: ['i1'] })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('상위 폴더가 휴지통에 있으면 409로 먼저 복원할 폴더를 알려준다', async () => {
      trashedItems = [trashedItem('i1', 'parent', T1)];
      liveParents = [];

      const error = await service
        .restore(USER, { itemIds: ['i1'] })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({ parentFolderIds: ['parent'] }),
      );
      expect(sqlOf(/SET deleted_at = NULL/)).toEqual([]);
    });

    it('상위 폴더를 같은 요청에서 함께 복원하면 허용한다', async () => {
      trashedItems = [trashedItem('i1', 'parent', T1)];
      trashedFolders = [trashedFolder('parent', null, T2)];

      await expect(
        service.restore(USER, { itemIds: ['i1'], folderIds: ['parent'] }),
      ).resolves.toBeDefined();
    });

    it('상위 폴더가 살아 있으면 복원하고 centroid에 다시 더한다', async () => {
      trashedItems = [trashedItem('i1', 'folder')];
      liveParents = ['folder'];

      const res = await service.restore(USER, { itemIds: ['i1'] });

      expect(res.results).toEqual([
        { type: MoveEntryType.ITEM, id: 'i1', name: 'i1.pdf', renamedTo: null },
      ]);
      expect(sqlOf(/COALESCE\(f\.centroid \+ m\.vsum/)).toHaveLength(1);
    });

    it('같은 위치에 같은 이름이 생겼으면 번호를 붙여 복원한다', async () => {
      trashedItems = [trashedItem('i1', 'folder')];
      liveParents = ['folder'];
      takenItemNames = ['i1.pdf'];

      const res = await service.restore(USER, { itemIds: ['i1'] });

      expect(res.results[0].renamedTo).toBe('i1 (1).pdf');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining(
          'UPDATE drive_items i SET deleted_at = NULL, name',
        ),
        [['i1'], ['i1 (1).pdf'], USER],
      );
    });

    it('폴더와 함께 지워진 항목은 따로 되살리지 않고 centroid도 건드리지 않는다', async () => {
      trashedFolders = [trashedFolder('folder', null, T1)];
      trashedItems = [trashedItem('inside', 'folder', T1)];

      const res = await service.restore(USER, {
        itemIds: ['inside'],
        folderIds: ['folder'],
      });

      expect(res.results.map((r) => r.id)).toEqual(['inside', 'folder']);
      expect(sqlOf(/COALESCE\(f\.centroid \+ m\.vsum/)).toEqual([]);
      expect(sqlOf(/UPDATE drive_items i SET deleted_at = NULL, name/)).toEqual(
        [],
      );
    });

    it('폴더를 복원할 때 함께 지워진 하위 폴더·항목까지 되살린다', async () => {
      trashedFolders = [trashedFolder('folder', null)];

      await service.restore(USER, { folderIds: ['folder'] });

      const recursive = sqlOf(/WITH RECURSIVE sub/);
      expect(recursive).toHaveLength(2);
      for (const sql of recursive) {
        expect(sql).toContain('f.deleted_at = s.deleted_at');
      }
      // 항목을 먼저 되살린 뒤 폴더를 되살려야 deleted_at 비교가 맞다
      expect(recursive[0]).toContain('UPDATE drive_items');
      expect(recursive[1]).toContain('UPDATE drive_folders');
    });

    it('복원 중 폴더 이름 unique 위반이 나면 409로 바꾼다', async () => {
      trashedFolders = [trashedFolder('folder', null)];
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) return trashedFolders;
        if (/^\s*(WITH RECURSIVE|UPDATE)/.test(sql)) {
          throw { driverError: { code: '23505' } };
        }
        return [];
      });

      await expect(
        service.restore(USER, { folderIds: ['folder'] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('직접 삭제한 항목만 최근 삭제 순으로 보여주고 자동 삭제 시각을 계산한다', async () => {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM drive_folders f')) {
          return [{ id: 'f1', name: 'docs', deleted_at: T1 }];
        }
        return [
          {
            id: 'i1',
            name: 'a.pdf',
            kind: 'FILE',
            size_bytes: '2048',
            deleted_at: T2,
          },
        ];
      });

      const res = await service.list(USER);

      expect(res.retentionDays).toBe(30);
      expect(res.entries.map((e) => e.id)).toEqual(['i1', 'f1']);
      expect(res.entries[0]).toEqual(
        expect.objectContaining({
          type: MoveEntryType.ITEM,
          sizeBytes: 2048,
          purgeAt: new Date(T2.getTime() + 30 * DAY_MS),
        }),
      );
      expect(res.entries[1]).toEqual(
        expect.objectContaining({ kind: null, sizeBytes: null }),
      );
      // 폴더와 함께 지워진 하위 항목은 목록에서 뺀다
      for (const [sql] of query.mock.calls) {
        expect(sql).toContain('p.deleted_at');
      }
    });
  });
});
