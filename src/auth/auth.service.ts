import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider } from '../users/user-identity.entity.js';
import { UserStatus, type User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  GoogleLoginStatus,
  type GoogleLoginResponseDto,
} from './dto/google-login-response.dto.js';
import type { GoogleSignupDto } from './dto/google-signup.dto.js';
import type { TokenResponseDto } from './dto/token-response.dto.js';
import { GoogleTokenVerifier } from './google-token-verifier.js';
import type { JwtPayload } from './jwt-payload.interface.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly googleVerifier: GoogleTokenVerifier,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /** 가입된 사용자만 로그인시키고, 미가입이면 계정을 만들지 않고 가입 필요 응답을 돌려준다. */
  async loginWithGoogle(idToken: string): Promise<GoogleLoginResponseDto> {
    const { providerUserId, ...profile } =
      await this.googleVerifier.verify(idToken);
    const user = await this.users.findBySocial(
      AuthProvider.GOOGLE,
      providerUserId,
    );
    if (!user) {
      return { status: GoogleLoginStatus.SIGNUP_REQUIRED, profile };
    }
    this.assertUsable(user);

    return {
      status: GoogleLoginStatus.LOGIN,
      ...(await this.startSession(user.id)),
    };
  }

  /** 가입 화면에서 약관에 동의한 사용자를 가입시키고 바로 로그인시킨다. */
  async signUpWithGoogle(dto: GoogleSignupDto): Promise<TokenResponseDto> {
    // 프로필은 클라이언트가 아니라 ID Token에서 다시 읽는다.
    const profile = await this.googleVerifier.verify(dto.idToken);
    if (
      await this.users.findBySocial(AuthProvider.GOOGLE, profile.providerUserId)
    ) {
      throw new ConflictException('이미 가입된 계정입니다.');
    }

    const user = await this.users.createBySocial(AuthProvider.GOOGLE, profile, {
      marketingAgreed: dto.marketingAgreed ?? false,
    });
    return this.startSession(user.id);
  }

  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    const rotated = await this.refreshTokens.rotate(refreshToken);

    // 정지/탈퇴된 계정은 더 이상 재발급하지 않는다.
    const user = await this.users.findById(rotated.userId);
    if (user?.status !== UserStatus.ACTIVE) {
      await this.refreshTokens.revoke(rotated.refreshToken);
      throw new UnauthorizedException('유효하지 않은 Refresh Token입니다.');
    }

    return this.toTokens(rotated.userId, rotated.refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revoke(refreshToken);
  }

  private assertUsable(user: User): void {
    if (user.status !== UserStatus.ACTIVE || user.deletedAt) {
      throw new ForbiddenException('이용할 수 없는 계정입니다.');
    }
  }

  private async startSession(userId: string): Promise<TokenResponseDto> {
    await this.users.recordLogin(userId);
    return this.toTokens(userId, await this.refreshTokens.issue(userId));
  }

  private async toTokens(
    userId: string,
    refreshToken: string,
  ): Promise<TokenResponseDto> {
    const payload: JwtPayload = { sub: userId };
    return { accessToken: await this.jwt.signAsync(payload), refreshToken };
  }
}
