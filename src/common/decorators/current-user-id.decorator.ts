import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';

/**
 * JwtAuthGuard를 통과한 요청의 사용자 id (JWT `sub`).
 * TEMP(test): 가드를 끈 동안에는 TEST_USER_ID 환경변수를 대신 사용한다 (Tag-in/tagin-server#18). 배포 전 원복.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: { userId: string } }>();
    const userId = request.user?.userId ?? process.env.TEST_USER_ID;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  },
);
