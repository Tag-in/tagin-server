import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** JwtAuthGuard를 통과한 요청의 사용자 id (JWT `sub`). 가드 없는 라우트에서는 쓰지 않는다. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<{ user: { userId: string } }>().user.userId,
);
