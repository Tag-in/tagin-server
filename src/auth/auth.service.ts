import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
    const user = await this.users.findOrCreateByGoogle(profile);
    return this.toTokens(user.id, await this.refreshTokens.issue(user.id));
  }

  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    const rotated = await this.refreshTokens.rotate(refreshToken);
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
