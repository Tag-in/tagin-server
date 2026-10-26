import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';

/** JwtAuthGuard를 통과한 요청의 사용자 id (JWT `sub`). */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const userId = ctx
      .switchToHttp()
      .getRequest<{ user?: { userId: string } }>().user?.userId;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  },
);
