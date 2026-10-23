import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { UserStatus, type User } from '../users/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { GoogleTokenVerifier } from './google-token-verifier.js';
import type { RefreshTokenService } from './refresh-token.service.js';

describe('AuthService', () => {
  const googleVerifier = { verify: vi.fn() };
  const users = {
    findOrCreateBySocial: vi.fn(),
    recordLogin: vi.fn(),
    findById: vi.fn(),
  };
  const jwt = { signAsync: vi.fn(async () => 'access-token') };
  const refreshTokens = { issue: vi.fn(), rotate: vi.fn(), revoke: vi.fn() };
  const service = new AuthService(
    googleVerifier as unknown as GoogleTokenVerifier,
    users as unknown as UsersService,
    jwt as unknown as JwtService,
    refreshTokens as unknown as RefreshTokenService,
  );

  const userOf = (status: UserStatus) => ({ id: 'user-1', status }) as User;

  beforeEach(() => vi.clearAllMocks());

  describe('loginWithGoogle', () => {
    it('활성 사용자면 마지막 로그인 시각을 기록하고 토큰을 발급한다', async () => {
      users.findOrCreateBySocial.mockResolvedValueOnce(
        userOf(UserStatus.ACTIVE),
      );
      refreshTokens.issue.mockResolvedValueOnce('refresh-token');

      await expect(service.loginWithGoogle('id-token')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(users.recordLogin).toHaveBeenCalledWith('user-1');
      expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'user-1' });
    });

    it('status와 무관하게 soft delete된 사용자는 거부한다', async () => {
      users.findOrCreateBySocial.mockResolvedValueOnce({
        ...userOf(UserStatus.ACTIVE),
        deletedAt: new Date(),
      });

      await expect(service.loginWithGoogle('id-token')).rejects.toThrow(
        ForbiddenException,
      );
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it.each([UserStatus.SUSPENDED, UserStatus.WITHDRAWN])(
      '%s 사용자는 토큰을 발급하지 않고 거부한다',
      async (status) => {
        users.findOrCreateBySocial.mockResolvedValueOnce(userOf(status));

        await expect(service.loginWithGoogle('id-token')).rejects.toThrow(
          ForbiddenException,
        );
        expect(refreshTokens.issue).not.toHaveBeenCalled();
        expect(users.recordLogin).not.toHaveBeenCalled();
      },
    );
  });

  describe('refresh', () => {
    it('활성 사용자면 새 토큰 쌍을 반환한다', async () => {
      refreshTokens.rotate.mockResolvedValueOnce({
        userId: 'user-1',
        refreshToken: 'new-refresh',
      });
      users.findById.mockResolvedValueOnce(userOf(UserStatus.ACTIVE));

      await expect(service.refresh('old-refresh')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'new-refresh',
      });
    });

    it.each([UserStatus.SUSPENDED, UserStatus.WITHDRAWN, null])(
      '정지/탈퇴/삭제된 사용자(%s)는 새 토큰을 폐기하고 거부한다',
      async (status) => {
        refreshTokens.rotate.mockResolvedValueOnce({
          userId: 'user-1',
          refreshToken: 'new-refresh',
        });
        users.findById.mockResolvedValueOnce(status && userOf(status));

        await expect(service.refresh('old-refresh')).rejects.toThrow(
          UnauthorizedException,
        );
        expect(refreshTokens.revoke).toHaveBeenCalledWith('new-refresh');
      },
    );
  });
});
