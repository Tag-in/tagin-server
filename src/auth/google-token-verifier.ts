import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import type { GoogleProfile } from '../users/users.service.js';

const CLIENT_ID_KEYS = [
  'GOOGLE_WEB_CLIENT_ID',
  'GOOGLE_IOS_CLIENT_ID',
  'GOOGLE_ANDROID_CLIENT_ID',
];

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();
  private readonly audiences: string[];

  constructor(config: ConfigService) {
    this.audiences = CLIENT_ID_KEYS.map((key) =>
      config.get<string>(key),
    ).filter((id): id is string => !!id);
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.audiences,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('유효하지 않은 Google 토큰입니다.');
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('유효하지 않은 Google 토큰입니다.');
    }
    if (!payload.email_verified) {
      throw new ForbiddenException(
        '이메일 인증이 완료되지 않은 Google 계정입니다.',
      );
    }

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email,
      picture: payload.picture ?? null,
    };
  }
}
