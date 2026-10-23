import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  /** 로그인 또는 재발급 시 받은 Refresh Token */
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
