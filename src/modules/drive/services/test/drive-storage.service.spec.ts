import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { UsersService } from '../../../users/services/users.service.js';
import { DriveStorageService } from '../drive-storage.service.js';

describe('DriveStorageService', () => {
  const dataSource = { query: vi.fn() };
  const users = { findById: vi.fn() };
  const service = new DriveStorageService(
    dataSource as unknown as DataSource,
    users as unknown as UsersService,
  );

  beforeEach(() => vi.clearAllMocks());

  it('살아 있는 파일과 휴지통 파일의 용량을 합산하고 한도는 사용자에서 읽는다', async () => {
    users.findById.mockResolvedValueOnce({ storageLimitBytes: 5 * 1024 ** 3 });
    // pg는 bigint 합을 문자열로 돌려준다.
    dataSource.query.mockResolvedValueOnce([
      { live_bytes: '1000', trash_bytes: '24', item_count: 3 },
    ]);

    const result = await service.getUsage('user-1');

    expect(dataSource.query.mock.calls[0]![1]).toEqual(['user-1']);
    expect(result).toEqual({
      usedBytes: 1024,
      trashBytes: 24,
      limitBytes: 5 * 1024 ** 3,
      itemCount: 3,
    });
  });

  it('탈퇴했거나 없는 사용자면 404', async () => {
    users.findById.mockResolvedValueOnce(null);
    dataSource.query.mockResolvedValueOnce([
      { live_bytes: '0', trash_bytes: '0', item_count: 0 },
    ]);

    await expect(service.getUsage('user-9')).rejects.toThrow(NotFoundException);
  });
});
