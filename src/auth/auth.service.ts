import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider } from '../users/user-identity.entity.js';
import { UserStatus } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
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

  async loginWithGoogle(idToken: string): Promise<TokenResponseDto> {
    const profile = await this.googleVerifier.verify(idToken);
    const user = await this.users.findOrCreateBySocial(
      AuthProvider.GOOGLE,
      profile,
    );
    if (user.status !== UserStatus.ACTIVE || user.deletedAt) {
      throw new ForbiddenException('이용할 수 없는 계정입니다.');
    }

    await this.users.recordLogin(user.id);
    return this.toTokens(user.id, await this.refreshTokens.issue(user.id));
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

  private async toTokens(
    userId: string,
    refreshToken: string,
  ): Promise<TokenResponseDto> {
    const payload: JwtPayload = { sub: userId };
    return { accessToken: await this.jwt.signAsync(payload), refreshToken };
  }
}
