import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiErrorResponse } from '../../../common/swagger/swagger.decorators.js';
import { GoogleLoginDto } from '../dto/google-login.dto.js';
import { GoogleLoginResponseDto } from '../dto/google-login-response.dto.js';
import { GoogleSignupDto } from '../dto/google-signup.dto.js';
import { RefreshTokenDto } from '../dto/refresh-token.dto.js';
import { TokenResponseDto } from '../dto/token-response.dto.js';
import { AuthService } from '../services/auth.service.js';

@ApiTags('Auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Google ID Token으로 로그인 (미가입이면 계정을 만들지 않고 status=SIGNUP_REQUIRED 반환) */
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '요청 값 검증 실패')
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, '유효하지 않은 Google 토큰')
  @ApiErrorResponse(
    HttpStatus.FORBIDDEN,
    '이메일 인증이 안 된 Google 계정 또는 이용할 수 없는 계정(정지/탈퇴)',
  )
  @HttpCode(HttpStatus.OK)
  @Post('google')
  loginWithGoogle(
    @Body() dto: GoogleLoginDto,
  ): Promise<GoogleLoginResponseDto> {
    return this.auth.loginWithGoogle(dto.idToken);
  }

  /** Google ID Token으로 가입 (약관 동의 포함, 가입 후 바로 로그인) */
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (필수 약관 미동의 포함)',
  )
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, '유효하지 않은 Google 토큰')
  @ApiErrorResponse(HttpStatus.FORBIDDEN, '이메일 인증이 안 된 Google 계정')
  @ApiErrorResponse(HttpStatus.CONFLICT, '이미 가입된 계정')
  @HttpCode(HttpStatus.OK)
  @Post('google/signup')
  signUpWithGoogle(@Body() dto: GoogleSignupDto): Promise<TokenResponseDto> {
    return this.auth.signUpWithGoogle(dto);
  }

  /** 토큰 재발급 (Refresh Token은 1회용이며 재발급 시 교체됨) */
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '요청 값 검증 실패')
  @ApiErrorResponse(
    HttpStatus.UNAUTHORIZED,
    '유효하지 않거나 이미 사용된 Refresh Token',
  )
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  /** 로그아웃 (Refresh Token 폐기) */
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '요청 값 검증 실패')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }
}
