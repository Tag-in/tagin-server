import { NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '../../entities/user.entity.js';
import type { UsersService } from '../../services/users.service.js';
import { UsersController } from '../users.controller.js';

describe('UsersController', () => {
  const users = { findById: vi.fn() };
  const controller = new UsersController(users as unknown as UsersService);
  const at = new Date('2026-10-01T00:00:00Z');

  beforeEach(() => vi.clearAllMocks());

  it('내 정보를 응답 DTO로 매핑한다 (내부 필드는 제외)', async () => {
    users.findById.mockResolvedValueOnce({
      id: 'u1',
      email: 'user@example.com',
      nickname: '태그인',
      profileImageUrl: null,
      status: UserStatus.ACTIVE,
      role: UserRole.USER,
      storageUsedBytes: 0,
      storageLimitBytes: 5 * 1024 ** 3,
      lastLoginAt: at,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });

    const result = await controller.getMe('u1');

    expect(users.findById).toHaveBeenCalledWith('u1');
    expect(result).toEqual({
      id: 'u1',
      email: 'user@example.com',
      nickname: '태그인',
      profileImageUrl: null,
      status: UserStatus.ACTIVE,
      role: UserRole.USER,
      storageLimitBytes: 5 * 1024 ** 3,
      createdAt: at,
    });
  });

  it('없는 사용자면 404', async () => {
    users.findById.mockResolvedValueOnce(null);

    await expect(controller.getMe('u9')).rejects.toThrow(NotFoundException);
  });
});
