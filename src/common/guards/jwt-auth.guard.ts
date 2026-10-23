import { Injectable, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { resolveTestUserId } from '../utils/test-user.util.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    // TEMP(test): production이 아니고 Authorization 헤더가 없으면 테스트 사용자로 통과시킨다 (Tag-in/tagin-server#18).
    // 토큰이 있으면 항상 JWT를 검증하고, production에서는 우회하지 않는다. 배포 전 제거.
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: { userId: string };
    }>();
    const testUserId = resolveTestUserId();
    if (testUserId && !request.headers.authorization) {
      request.user = { userId: testUserId };
      return true;
    }
    return super.canActivate(context);
  }
}
