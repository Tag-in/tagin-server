import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleTokenVerifier } from './google-token-verifier.js';

const verifyIdToken = vi.hoisted(() => vi.fn());

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

const clientIds: Record<string, string> = {
  GOOGLE_WEB_CLIENT_ID: 'web-id',
  GOOGLE_IOS_CLIENT_ID: '',
  GOOGLE_ANDROID_CLIENT_ID: 'android-id',
};

describe('GoogleTokenVerifier', () => {
  const verifier = new GoogleTokenVerifier({
    get: (key: string) => clientIds[key],
  } as unknown as ConfigService);

  const ticketOf = (payload: object) => ({ getPayload: () => payload });

  beforeEach(() => verifyIdToken.mockReset());

  it('설정된 Client ID만 audience로 사용해 검증하고 프로필을 반환한다', async () => {
    verifyIdToken.mockResolvedValueOnce(
      ticketOf({
        sub: 'g-1',
        email: 'a@tagin.com',
        email_verified: true,
        name: '태그인',
        picture: 'https://img',
      }),
    );

    await expect(verifier.verify('id-token')).resolves.toEqual({
      googleId: 'g-1',
      email: 'a@tagin.com',
      name: '태그인',
      picture: 'https://img',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: ['web-id', 'android-id'],
    });
  });

  it('이메일이 인증되지 않은 계정은 거부한다', async () => {
    verifyIdToken.mockResolvedValueOnce(
      ticketOf({ sub: 'g-1', email: 'a@tagin.com', email_verified: false }),
    );

    await expect(verifier.verify('id-token')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('토큰 검증에 실패하면 401을 던진다', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('Wrong recipient'));

    await expect(verifier.verify('id-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('이메일이 없는 토큰은 거부한다', async () => {
    verifyIdToken.mockResolvedValueOnce(ticketOf({ sub: 'g-1' }));

    await expect(verifier.verify('id-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
