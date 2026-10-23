import type { Repository } from 'typeorm';
import { AuthProvider, UserIdentity } from './user-identity.entity.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  const profile = {
    providerUserId: 'g-1',
    email: 'a@tagin.com',
    nickname: '태그인',
    profileImageUrl: null,
  };
  const em = {
    create: vi.fn((_: unknown, data: object) => data),
    save: vi.fn(async (data: object) => ({ id: 'user-1', ...data })),
    insert: vi.fn(),
  };
  const identities = {
    findOne: vi.fn(),
    manager: {
      transaction: vi.fn((run: (m: typeof em) => unknown) => run(em)),
    },
  };
  const users = { findOneBy: vi.fn(), update: vi.fn() };
  const service = new UsersService(
    identities as unknown as Repository<UserIdentity>,
    users as unknown as Repository<User>,
  );

  beforeEach(() => vi.clearAllMocks());

  it('이미 연결된 계정이면 탈퇴한 사용자까지 포함해 기존 사용자를 반환한다', async () => {
    const user = { id: 'user-1' } as User;
    identities.findOne.mockResolvedValueOnce({ user });

    await expect(
      service.findOrCreateBySocial(AuthProvider.GOOGLE, profile),
    ).resolves.toBe(user);
    expect(identities.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
    expect(identities.manager.transaction).not.toHaveBeenCalled();
  });

  it('최초 로그인이면 이메일 인증 시각과 함께 사용자와 소셜 계정을 생성한다', async () => {
    identities.findOne.mockResolvedValueOnce(null);

    const user = await service.findOrCreateBySocial(
      AuthProvider.GOOGLE,
      profile,
    );

    expect(user.id).toBe('user-1');
    expect(em.create).toHaveBeenCalledWith(User, {
      email: 'a@tagin.com',
      nickname: '태그인',
      profileImageUrl: null,
      emailVerifiedAt: expect.any(Date),
    });
    expect(em.insert).toHaveBeenCalledWith(UserIdentity, {
      provider: AuthProvider.GOOGLE,
      providerUserId: 'g-1',
      userId: 'user-1',
    });
  });

  it('동시 최초 로그인으로 unique 충돌이 나면 먼저 생성된 사용자를 반환한다', async () => {
    const user = { id: 'user-1' } as User;
    identities.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user });
    identities.manager.transaction.mockRejectedValueOnce({
      driverError: { code: '23505' },
    });

    await expect(
      service.findOrCreateBySocial(AuthProvider.GOOGLE, profile),
    ).resolves.toBe(user);
  });

  it('unique 충돌이 아닌 오류는 그대로 던진다', async () => {
    identities.findOne.mockResolvedValueOnce(null);
    identities.manager.transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.findOrCreateBySocial(AuthProvider.GOOGLE, profile),
    ).rejects.toThrow('db down');
  });

  it('recordLogin은 lastLoginAt을 갱신한다', async () => {
    await service.recordLogin('user-1');

    expect(users.update).toHaveBeenCalledWith('user-1', {
      lastLoginAt: expect.any(Date),
    });
  });
});
