import { ConflictException } from '@nestjs/common';
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

  describe('findBySocial', () => {
    it('연결된 계정이 있으면 탈퇴한 사용자까지 포함해 반환한다', async () => {
      const user = { id: 'user-1' } as User;
      identities.findOne.mockResolvedValueOnce({ user });

      await expect(
        service.findBySocial(AuthProvider.GOOGLE, 'g-1'),
      ).resolves.toBe(user);
      expect(identities.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
    });

    it('연결된 계정이 없으면 가입시키지 않고 null을 반환한다', async () => {
      identities.findOne.mockResolvedValueOnce(null);

      await expect(
        service.findBySocial(AuthProvider.GOOGLE, 'g-1'),
      ).resolves.toBeNull();
      expect(identities.manager.transaction).not.toHaveBeenCalled();
    });
  });

  describe('createBySocial', () => {
    it('이메일 인증·필수 동의 시각과 함께 사용자와 소셜 계정을 생성한다', async () => {
      const user = await service.createBySocial(AuthProvider.GOOGLE, profile, {
        marketingAgreed: false,
      });

      expect(user.id).toBe('user-1');
      expect(em.create).toHaveBeenCalledWith(User, {
        email: 'a@tagin.com',
        nickname: '태그인',
        profileImageUrl: null,
        emailVerifiedAt: expect.any(Date),
        termsAgreedAt: expect.any(Date),
        privacyAgreedAt: expect.any(Date),
        marketingAgreedAt: null,
      });
      expect(em.insert).toHaveBeenCalledWith(UserIdentity, {
        provider: AuthProvider.GOOGLE,
        providerUserId: 'g-1',
        userId: 'user-1',
      });
    });

    it('마케팅 수신에 동의하면 동의 시각을 기록한다', async () => {
      await service.createBySocial(AuthProvider.GOOGLE, profile, {
        marketingAgreed: true,
      });

      expect(em.create).toHaveBeenCalledWith(
        User,
        expect.objectContaining({ marketingAgreedAt: expect.any(Date) }),
      );
    });

    it('unique 충돌(동시 가입, 이메일 중복)이면 ConflictException을 던진다', async () => {
      identities.manager.transaction.mockRejectedValueOnce({
        driverError: { code: '23505' },
      });

      await expect(
        service.createBySocial(AuthProvider.GOOGLE, profile, {
          marketingAgreed: false,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('unique 충돌이 아닌 오류는 그대로 던진다', async () => {
      identities.manager.transaction.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        service.createBySocial(AuthProvider.GOOGLE, profile, {
          marketingAgreed: false,
        }),
      ).rejects.toThrow('db down');
    });
  });

  it('recordLogin은 lastLoginAt을 갱신한다', async () => {
    await service.recordLogin('user-1');

    expect(users.update).toHaveBeenCalledWith('user-1', {
      lastLoginAt: expect.any(Date),
    });
  });
});
