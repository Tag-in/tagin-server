import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { AuthProvider } from '../../../users/entities/user-identity.entity.js';
import { UserStatus, type User } from '../../../users/entities/user.entity.js';
import type { UsersService } from '../../../users/services/users.service.js';
import { GoogleLoginStatus } from '../../dto/google-login-response.dto.js';
import { AuthService } from '../auth.service.js';
import type { GoogleTokenVerifier } from '../google-token-verifier.js';
import type { RefreshTokenService } from '../refresh-token.service.js';

describe('AuthService', () => {
  const googleVerifier = { verify: vi.fn() };
  const users = {
    findBySocial: vi.fn(),
    createBySocial: vi.fn(),
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
    const profile = {
      providerUserId: 'g-1',
      email: 'a@tagin.com',
      nickname: '태그인',
      profileImageUrl: null,
    };

    beforeEach(() => googleVerifier.verify.mockResolvedValue(profile));

    it('활성 사용자면 마지막 로그인 시각을 기록하고 토큰을 발급한다', async () => {
      users.findBySocial.mockResolvedValueOnce(userOf(UserStatus.ACTIVE));
      refreshTokens.issue.mockResolvedValueOnce('refresh-token');

      await expect(service.loginWithGoogle('id-token')).resolves.toEqual({
        status: GoogleLoginStatus.LOGIN,
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(users.recordLogin).toHaveBeenCalledWith('user-1');
      expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'user-1' });
    });

    it('미가입이면 계정을 만들지 않고 가입 필요 응답과 프로필을 반환한다', async () => {
      users.findBySocial.mockResolvedValueOnce(null);

      await expect(service.loginWithGoogle('id-token')).resolves.toEqual({
        status: GoogleLoginStatus.SIGNUP_REQUIRED,
        profile: {
          email: 'a@tagin.com',
          nickname: '태그인',
          profileImageUrl: null,
        },
      });
      expect(users.createBySocial).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
      expect(users.recordLogin).not.toHaveBeenCalled();
    });

    it('status와 무관하게 soft delete된 사용자는 거부한다', async () => {
      users.findBySocial.mockResolvedValueOnce({
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
        users.findBySocial.mockResolvedValueOnce(userOf(status));

        await expect(service.loginWithGoogle('id-token')).rejects.toThrow(
          ForbiddenException,
        );
        expect(refreshTokens.issue).not.toHaveBeenCalled();
        expect(users.recordLogin).not.toHaveBeenCalled();
      },
    );
  });

  describe('signUpWithGoogle', () => {
    const profile = {
      providerUserId: 'g-1',
      email: 'a@tagin.com',
      nickname: '태그인',
      profileImageUrl: null,
    };
    const dto = {
      idToken: 'id-token',
      termsAgreed: true as const,
      privacyAgreed: true as const,
    };

    beforeEach(() => googleVerifier.verify.mockResolvedValue(profile));

    it('ID Token의 프로필로 가입시키고 바로 토큰을 발급한다', async () => {
      users.findBySocial.mockResolvedValueOnce(null);
      users.createBySocial.mockResolvedValueOnce(userOf(UserStatus.ACTIVE));
      refreshTokens.issue.mockResolvedValueOnce('refresh-token');

      await expect(service.signUpWithGoogle(dto)).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(users.createBySocial).toHaveBeenCalledWith(
        AuthProvider.GOOGLE,
        profile,
        { marketingAgreed: false },
      );
      expect(users.recordLogin).toHaveBeenCalledWith('user-1');
    });

    it('마케팅 수신 동의 값을 전달한다', async () => {
      users.findBySocial.mockResolvedValueOnce(null);
      users.createBySocial.mockResolvedValueOnce(userOf(UserStatus.ACTIVE));

      await service.signUpWithGoogle({ ...dto, marketingAgreed: true });

      expect(users.createBySocial).toHaveBeenCalledWith(
        AuthProvider.GOOGLE,
        profile,
        { marketingAgreed: true },
      );
    });

    it('이미 가입된 계정(탈퇴 포함)이면 생성하지 않고 거부한다', async () => {
      users.findBySocial.mockResolvedValueOnce(userOf(UserStatus.WITHDRAWN));

      await expect(service.signUpWithGoogle(dto)).rejects.toThrow(
        ConflictException,
      );
      expect(users.createBySocial).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('ID Token 검증에 실패하면 가입시키지 않는다', async () => {
      googleVerifier.verify.mockRejectedValueOnce(new UnauthorizedException());

      await expect(service.signUpWithGoogle(dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(users.createBySocial).not.toHaveBeenCalled();
    });
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
