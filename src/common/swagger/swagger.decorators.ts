import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto.js';
import { ACCESS_TOKEN_AUTH } from './swagger.constants.js';

export const ApiErrorResponse = (status: HttpStatus, description?: string) =>
  ApiResponse({ status, description, type: ErrorResponseDto });

// 인증이 필요한 API 문서화 (가드는 @UseGuards(JwtAuthGuard)로 별도 적용)
export const ApiAuth = () =>
  applyDecorators(
    ApiBearerAuth(ACCESS_TOKEN_AUTH),
    ApiErrorResponse(HttpStatus.UNAUTHORIZED, '인증 실패'),
  );
