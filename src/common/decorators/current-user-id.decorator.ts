import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { resolveTestUserId } from '../utils/test-user.util.js';

/**
 * JwtAuthGuard를 통과한 요청의 사용자 id (JWT `sub`).
 * TEMP(test): 가드를 끈 동안에는 TEST_USER_ID(없으면 기본 테스트 사용자)를 대신 사용한다 (Tag-in/tagin-server#18). 배포 전 원복.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: { userId: string } }>();
    const userId = request.user?.userId ?? resolveTestUserId();
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  },
);
