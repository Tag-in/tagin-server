import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { ObjectStorageService } from '../../../../core/storage/object-storage.service.js';
import { TrashPurgeService } from '../trash-purge.service.js';

/** 사용자가 휴지통에서 직접 영구 삭제하는 purgeSelection */
describe('TrashPurgeService.purgeSelection', () => {
  let trashedItems: { id: string }[];
  let trashedFolders: { id: string }[];
  let subtree: { id: string }[];
  let items: { id: string; storage_key: string | null }[];
  let folderCounts: number[];

  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FOR UPDATE')) {
      return sql.includes('FROM drive_items') ? trashedItems : trashedFolders;
    }
    if (sql.includes('SELECT id FROM subtree')) return subtree;
    if (sql.includes('SELECT id, storage_key')) return items;
    if (sql.includes('DELETE FROM drive_folders')) {
      return [{ count: folderCounts.shift() ?? 0 }];
    }
    return [];
  });
  const dataSource = {
    query,
    transaction: vi.fn((run: (em: { query: typeof query }) => unknown) =>
      run({ query }),
    ),
  };
  const storage = { deleteMany: vi.fn() };
  const service = new TrashPurgeService(
    dataSource as unknown as DataSource,
    storage as unknown as ObjectStorageService,
    { getOrThrow: () => 30 } as unknown as ConfigService,
  );

  const calls = (prefix: string) =>
    query.mock.calls.filter(([sql]) => sql.trimStart().startsWith(prefix));

  beforeEach(() => {
    vi.clearAllMocks();
    trashedItems = [];
    trashedFolders = [];
    subtree = [];
    items = [];
    folderCounts = [];
    storage.deleteMany.mockResolvedValue([]);
  });

  it('대상을 지정하지 않으면 400', () => {
    expect(() => service.purgeSelection('user-1', {})).toThrow(
      BadRequestException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('휴지통에 없는 항목이 있으면 404이고 아무것도 지우지 않는다', async () => {
    trashedItems = [{ id: 'a' }];

    await expect(
      service.purgeSelection('user-1', { itemIds: ['a', 'zzz'] }),
    ).rejects.toThrow(NotFoundException);

    expect(storage.deleteMany).not.toHaveBeenCalled();
    expect(calls('DELETE')).toHaveLength(0);
  });

  it('사용자 락을 잡고, 객체를 먼저 지운 뒤 성공한 항목의 행과 비어 있는 폴더를 지운다', async () => {
    trashedItems = [{ id: 'a' }];
    trashedFolders = [{ id: 'f1' }];
    subtree = [{ id: 'f1' }, { id: 'f2' }];
    items = [
      { id: 'a', storage_key: 'k-a' },
      { id: 'b', storage_key: 'k-b' },
      { id: 'c', storage_key: null },
    ];
    folderCounts = [1, 1, 0];

    const result = await service.purgeSelection('user-1', {
      itemIds: ['a'],
      folderIds: ['f1'],
    });

    expect(query.mock.calls[0]![0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[0]![1]).toEqual(['drive-trash:user-1']);
    // 요청한 항목 + 폴더 서브트리 안의 항목을 한 번에 조회한다
    const [, collectParams] = query.mock.calls.find(([sql]) =>
      sql.includes('SELECT id, storage_key'),
    )!;
    expect(collectParams).toEqual(['user-1', ['a'], ['f1', 'f2']]);
    expect(storage.deleteMany).toHaveBeenCalledWith(['k-a', 'k-b']);
    expect(calls('DELETE FROM drive_items')[0]![1]).toEqual([['a', 'b', 'c']]);
    // 폴더는 서브트리 안에서 바닥부터 한 겹씩, 더 지울 것이 없을 때까지
    expect(calls('WITH d AS')).toHaveLength(3);
    expect(result).toEqual({
      purgedItemCount: 3,
      purgedFolderCount: 2,
      failedItemCount: 0,
    });
  });

  it('객체 삭제에 실패한 항목은 행을 남기고 개수로 알린다', async () => {
    trashedItems = [{ id: 'a' }, { id: 'b' }];
    items = [
      { id: 'a', storage_key: 'k-a' },
      { id: 'b', storage_key: 'k-b' },
    ];
    storage.deleteMany.mockResolvedValueOnce(['k-b']);

    const result = await service.purgeSelection('user-1', {
      itemIds: ['a', 'b'],
    });

    expect(calls('DELETE FROM drive_items')[0]![1]).toEqual([['a']]);
    expect(result).toEqual({
      purgedItemCount: 1,
      purgedFolderCount: 0,
      failedItemCount: 1,
    });
  });
});
