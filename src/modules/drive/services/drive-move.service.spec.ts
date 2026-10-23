import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { MoveConflictPolicy } from '../dto/move-drive.dto.js';
import { MoveStatus } from '../dto/move-drive-response.dto.js';
import { DriveMoveService } from './drive-move.service.js';

const USER = 'user-1';
const TARGET = 'target-1';

describe('DriveMoveService', () => {
  let targetExists: boolean;
  let items: { id: string; name: string; folder_id: string }[];
  let folders: { id: string; name: string; parent_id: string | null }[];
  let targetItemNames: string[];
  let targetFolderNames: string[];
  let ancestors: { id: string }[];

  // SQL 문장의 특징으로 어떤 조회인지 구분해 응답한다.
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('SELECT 1 FROM drive_folders')) {
      return targetExists ? [{ '?column?': 1 }] : [];
    }
    if (sql.includes('FOR UPDATE')) {
      return sql.includes('FROM drive_items') ? items : folders;
    }
    if (sql.includes('RECURSIVE')) return ancestors;
    if (sql.includes('SELECT name FROM drive_items')) {
      return targetItemNames.map((name) => ({ name }));
    }
    if (sql.includes('SELECT name FROM drive_folders')) {
      return targetFolderNames.map((name) => ({ name }));
    }
    return [];
  });
  const dataSource = {
    transaction: vi.fn((run: (em: { query: typeof query }) => unknown) =>
      run({ query }),
    ),
  };
  const service = new DriveMoveService(dataSource as unknown as DataSource);

  const writes = () =>
    query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => /^\s*UPDATE/.test(sql));

  beforeEach(() => {
    vi.clearAllMocks();
    targetExists = true;
    items = [];
    folders = [];
    targetItemNames = [];
    targetFolderNames = [];
    ancestors = [{ id: TARGET }];
  });

  describe('요청 검증', () => {
    it('이동할 항목이 없으면 400', () => {
      expect(() => service.move(USER, { targetFolderId: TARGET })).toThrow(
        BadRequestException,
      );
    });

    it('파일·링크를 최상위(null)로 옮기려 하면 400', () => {
      expect(() =>
        service.move(USER, { targetFolderId: null, itemIds: ['i1'] }),
      ).toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('대상 폴더가 없거나 내 것이 아니면 404', async () => {
      targetExists = false;

      await expect(
        service.move(USER, { targetFolderId: TARGET, itemIds: ['i1'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('요청한 항목 중 하나라도 없으면 404이고 아무것도 바꾸지 않는다', async () => {
      items = [{ id: 'i1', name: 'a.pdf', folder_id: 'x' }];

      await expect(
        service.move(USER, { targetFolderId: TARGET, itemIds: ['i1', 'i2'] }),
      ).rejects.toThrow(NotFoundException);
      expect(writes()).toEqual([]);
    });

    it('폴더를 자기 자신 또는 하위 폴더로 옮기면 400', async () => {
      folders = [{ id: 'top', name: 'a', parent_id: null }];
      ancestors = [{ id: TARGET }, { id: 'mid' }, { id: 'top' }];

      await expect(
        service.move(USER, { targetFolderId: TARGET, folderIds: ['top'] }),
      ).rejects.toThrow(BadRequestException);
      expect(writes()).toEqual([]);
    });

    it('폴더를 최상위(null)로 옮기는 것은 허용하고 순환 검사를 하지 않는다', async () => {
      folders = [{ id: 'f1', name: 'a', parent_id: 'p' }];

      const res = await service.move(USER, {
        targetFolderId: null,
        folderIds: ['f1'],
      });

      expect(res.results[0].status).toBe(MoveStatus.MOVED);
      expect(query).not.toHaveBeenCalledWith(
        expect.stringContaining('RECURSIVE'),
        expect.anything(),
      );
    });
  });

  describe('벡터(centroid) 갱신', () => {
    it('항목 이동은 원래 폴더 → 대상 폴더 → 항목 순으로 갱신한다', async () => {
      items = [
        { id: 'i1', name: 'a.pdf', folder_id: 'src' },
        { id: 'i2', name: 'b.pdf', folder_id: 'src' },
      ];

      await service.move(USER, {
        targetFolderId: TARGET,
        itemIds: ['i1', 'i2'],
      });

      const [source, target, moved] = writes();
      expect(source).toContain('UPDATE drive_folders');
      expect(source).toContain('f.centroid - m.vsum');
      expect(source).toContain('THEN NULL');
      expect(target).toContain('COALESCE(f.centroid + m.vsum, m.vsum)');
      expect(moved).toContain('UPDATE drive_items');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE drive_items'),
        [TARGET, ['i1', 'i2'], ['a.pdf', 'b.pdf'], USER],
      );
    });

    it('폴더만 옮기면 centroid와 항목은 건드리지 않고 parent_id만 바꾼다', async () => {
      folders = [{ id: 'f1', name: 'docs', parent_id: null }];

      await service.move(USER, { targetFolderId: TARGET, folderIds: ['f1'] });

      const [only] = writes();
      expect(writes()).toHaveLength(1);
      expect(only).toContain('SET parent_id');
      expect(only).not.toContain('centroid');
    });

    it('이미 대상 폴더에 있는 항목은 갱신하지 않는다', async () => {
      items = [{ id: 'i1', name: 'a.pdf', folder_id: TARGET }];
      targetItemNames = ['a.pdf'];

      const res = await service.move(USER, {
        targetFolderId: TARGET,
        itemIds: ['i1'],
      });

      expect(res.results[0].status).toBe(MoveStatus.UNCHANGED);
      expect(writes()).toEqual([]);
    });
  });

  describe('이름 충돌 정책', () => {
    beforeEach(() => {
      items = [
        { id: 'i1', name: 'a.pdf', folder_id: 'src' },
        { id: 'i2', name: 'b.pdf', folder_id: 'src' },
      ];
      targetItemNames = ['a.pdf'];
    });
    const ids = ['i1', 'i2'];

    it('FAIL(기본): 충돌 항목을 담아 409로 거부하고 아무것도 이동하지 않는다', async () => {
      const error = await service
        .move(USER, { targetFolderId: TARGET, itemIds: ids })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          conflicts: [
            expect.objectContaining({
              id: 'i1',
              status: MoveStatus.CONFLICT,
            }),
          ],
        }),
      );
      expect(writes()).toEqual([]);
    });

    it('SKIP: 충돌 항목은 건너뛰고 나머지만 이동한다', async () => {
      const res = await service.move(USER, {
        targetFolderId: TARGET,
        itemIds: ids,
        onConflict: MoveConflictPolicy.SKIP,
      });

      expect(res.results.map((r) => r.status)).toEqual([
        MoveStatus.SKIPPED,
        MoveStatus.MOVED,
      ]);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE drive_items'),
        [TARGET, ['i2'], ['b.pdf'], USER],
      );
    });

    it('RENAME: 번호를 붙인 이름으로 이동한다', async () => {
      const res = await service.move(USER, {
        targetFolderId: TARGET,
        itemIds: ids,
        onConflict: MoveConflictPolicy.RENAME,
      });

      expect(res.results[0].renamedTo).toBe('a (1).pdf');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE drive_items'),
        [TARGET, ['i1', 'i2'], ['a (1).pdf', 'b.pdf'], USER],
      );
    });

    it('dryRun: 변경 없이 결과를 반환하고 FAIL 충돌도 CONFLICT로 보여준다', async () => {
      const res = await service.move(USER, {
        targetFolderId: TARGET,
        itemIds: ids,
        dryRun: true,
      });

      expect(res.dryRun).toBe(true);
      expect(res.results.map((r) => r.status)).toEqual([
        MoveStatus.CONFLICT,
        MoveStatus.MOVED,
      ]);
      expect(writes()).toEqual([]);
    });

    it('폴더는 폴더끼리만 이름을 비교한다', async () => {
      folders = [{ id: 'f1', name: 'a.pdf', parent_id: null }];
      items = [];
      targetItemNames = ['a.pdf'];

      const res = await service.move(USER, {
        targetFolderId: TARGET,
        folderIds: ['f1'],
      });

      expect(res.results[0].status).toBe(MoveStatus.MOVED);
    });
  });

  it('반영 중 폴더 이름 unique 위반이 나면 409로 바꾼다', async () => {
    folders = [{ id: 'f1', name: 'docs', parent_id: null }];
    query.mockImplementation(async (sql: string) => {
      if (/^\s*UPDATE/.test(sql)) {
        throw { driverError: { code: '23505' } };
      }
      if (sql.includes('FOR UPDATE')) return folders;
      if (sql.includes('SELECT 1 FROM drive_folders')) return [{}];
      if (sql.includes('RECURSIVE')) return [{ id: TARGET }];
      return [];
    });

    await expect(
      service.move(USER, { targetFolderId: TARGET, folderIds: ['f1'] }),
    ).rejects.toThrow(ConflictException);
  });
});
