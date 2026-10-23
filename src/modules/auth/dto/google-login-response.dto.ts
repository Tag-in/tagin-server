import { ApiProperty } from '@nestjs/swagger';

export enum GoogleLoginStatus {
  LOGIN = 'LOGIN',
  SIGNUP_REQUIRED = 'SIGNUP_REQUIRED',
}

/** 가입 화면에 미리 채워 보여줄 Google 프로필 (표시용, 가입 시 서버가 ID Token에서 다시 읽는다) */
export class SignupProfileDto {
  /** @example 'user@tagin.com' */
  email: string;

  /** @example '태그인' */
  nickname: string;

  profileImageUrl: string | null;
}

export class GoogleLoginResponseDto {
  /** LOGIN: 로그인 완료(토큰 포함), SIGNUP_REQUIRED: 미가입 상태(가입 화면으로 이동) */
  @ApiProperty({ enum: GoogleLoginStatus, enumName: 'GoogleLoginStatus' })
  status: GoogleLoginStatus;

  /** Access Token (JWT, Authorization: Bearer). status가 LOGIN일 때만 포함 */
  accessToken?: string;

  /** Refresh Token (1회용, 재발급 시마다 교체). status가 LOGIN일 때만 포함 */
  refreshToken?: string;

  /** Google 프로필. status가 SIGNUP_REQUIRED일 때만 포함 */
  profile?: SignupProfileDto;
}
