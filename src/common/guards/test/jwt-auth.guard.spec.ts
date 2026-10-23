import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DEFAULT_TEST_USER_ID } from '../../utils/test-user.util.js';
import { JwtAuthGuard } from '../jwt-auth.guard.js';

const SECRET = 'test-secret-value-at-least-32-characters';
const USER_ID = '7d3c2a1b-0000-4000-8000-000000000042';

// 실제 JwtStrategy와 같은 설정으로 'jwt' 전략을 등록한다.
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: SECRET,
    });
  }

  validate(payload: { sub: string }) {
    return { userId: payload.sub };
  }
}

type TestRequest = {
  headers: Record<string, string>;
  user?: { userId: string };
};

function contextOf(request: TestRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard();
  const jwt = new JwtService({ secret: SECRET });
  new TestJwtStrategy();

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  // 우회 시에는 boolean, JWT 검증 시에는 Promise를 반환하므로 Promise로 맞춘다.
  const activate = (request: TestRequest) =>
    Promise.resolve(guard.canActivate(contextOf(request)));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('production이 아닐 때', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'local');
      vi.stubEnv('TEST_USER_ID', '');
    });

    it('토큰이 없으면 테스트 사용자로 통과한다', async () => {
      const request: TestRequest = { headers: {} };

      await expect(activate(request)).resolves.toBe(true);
      expect(request.user).toEqual({ userId: DEFAULT_TEST_USER_ID });
    });

    it('토큰이 있으면 JWT의 사용자로 통과한다', async () => {
      const request: TestRequest = {
        headers: bearer(jwt.sign({ sub: USER_ID })),
      };

      await expect(activate(request)).resolves.toBe(true);
      expect(request.user).toEqual({ userId: USER_ID });
    });

    it('토큰이 잘못되면 테스트 사용자로 대체하지 않고 거부한다', async () => {
      const request: TestRequest = { headers: bearer('invalid.token.value') };

      await expect(activate(request)).rejects.toThrow(UnauthorizedException);
      expect(request.user).toBeUndefined();
    });
  });

  describe('production일 때', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('유효한 토큰이면 JWT의 사용자로 통과한다', async () => {
      const request: TestRequest = {
        headers: bearer(jwt.sign({ sub: USER_ID })),
      };

      await expect(activate(request)).resolves.toBe(true);
      expect(request.user).toEqual({ userId: USER_ID });
    });

    it('토큰이 없으면 테스트 사용자로 우회하지 않고 거부한다', async () => {
      const request: TestRequest = { headers: {} };

      await expect(activate(request)).rejects.toThrow(UnauthorizedException);
      expect(request.user).toBeUndefined();
    });
  });
});
