import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { ObjectStorageService } from '../../../core/storage/object-storage.service.js';
import { TrashPurgeService } from './trash-purge.service.js';

const NOW = new Date('2026-10-31T00:00:00.000Z');
const CUTOFF = new Date('2026-10-01T00:00:00.000Z');

describe('TrashPurgeService', () => {
  let expiredBatches: { id: string; storage_key: string | null }[][];
  let folderCounts: number[];
  let locked: boolean;

  const runner = {
    connect: vi.fn(),
    release: vi.fn(),
    query: vi.fn(async (sql: string) =>
      sql.includes('pg_try_advisory_lock') ? [{ locked }] : [],
    ),
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('DELETE FROM drive_folders')) {
      return [{ count: folderCounts.shift() ?? 0 }];
    }
    if (sql.includes('SELECT id, storage_key')) {
      return expiredBatches.shift() ?? [];
    }
    return [];
  });
  const dataSource = { query, createQueryRunner: () => runner };
  const storage = { deleteMany: vi.fn() };
  const service = new TrashPurgeService(
    dataSource as unknown as DataSource,
    storage as unknown as ObjectStorageService,
    { getOrThrow: () => 30 } as unknown as ConfigService,
  );

  const deletedItemIds = () =>
    query.mock.calls
      .filter(([sql]) => sql.startsWith('DELETE FROM drive_items'))
      .flatMap(([, params]) => params![0] as string[]);

  beforeEach(() => {
    vi.clearAllMocks();
    expiredBatches = [];
    folderCounts = [];
    locked = true;
    storage.deleteMany.mockResolvedValue([]);
  });

  it('보관 기간(30일)이 지난 항목만 기준으로 삼는다', async () => {
    await service.purgeExpired(NOW);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('deleted_at < $1'),
      [CUTOFF, expect.any(Number)],
    );
  });

  it('스토리지 객체를 먼저 지운 뒤 DB 행을 지운다 (링크는 객체 없이 행만)', async () => {
    expiredBatches = [
      [
        { id: 'a', storage_key: 'k-a' },
        { id: 'b', storage_key: null },
      ],
    ];

    const result = await service.purgeExpired(NOW);

    expect(storage.deleteMany).toHaveBeenCalledWith(['k-a']);
    expect(deletedItemIds()).toEqual(['a', 'b']);
    expect(result).toEqual({ items: 2, folders: 0 });
  });

  it('객체 삭제에 실패한 항목은 행을 남기고 멈춘다 (다음 실행에서 재시도)', async () => {
    expiredBatches = [
      [
        { id: 'a', storage_key: 'k-a' },
        { id: 'b', storage_key: 'k-b' },
      ],
    ];
    storage.deleteMany.mockResolvedValueOnce(['k-b']);

    const result = await service.purgeExpired(NOW);

    expect(deletedItemIds()).toEqual(['a']);
    expect(result?.items).toBe(1);
    // 실패한 행을 다시 조회하며 반복하지 않고 한 번에 멈춘다
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes('SELECT id, storage_key'),
      ),
    ).toHaveLength(1);
  });

  it('배치가 가득 차 있는 동안 계속 처리한다', async () => {
    const full = Array.from({ length: 2 }, (_, i) => ({
      id: `x${i}`,
      storage_key: null,
    }));
    expiredBatches = [full, [{ id: 'y', storage_key: null }]];

    const result = await service.purgeExpired(NOW);

    expect(result?.items).toBe(3);
  });

  it('폴더는 바닥부터 한 겹씩, 더 지울 것이 없을 때까지 지운다', async () => {
    folderCounts = [2, 1, 0];

    const result = await service.purgeExpired(NOW);

    expect(result?.folders).toBe(3);
    const sql = query.mock.calls.find(([s]) =>
      s.includes('DELETE FROM drive_folders'),
    )![0];
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM drive_items');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM drive_folders c');
  });

  it('다른 인스턴스가 실행 중이면(락 실패) 아무것도 하지 않는다', async () => {
    locked = false;

    await expect(service.purgeExpired(NOW)).resolves.toBeNull();
    expect(storage.deleteMany).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('끝나면 락을 풀고 연결을 반환한다', async () => {
    await service.purgeExpired(NOW);

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      expect.anything(),
    );
    expect(runner.release).toHaveBeenCalled();
  });

  it('스케줄 실행은 예외를 삼키고 로그만 남긴다', async () => {
    runner.query.mockRejectedValueOnce(new Error('db down'));

    await expect(service.runScheduled()).resolves.toBeUndefined();
  });
});
