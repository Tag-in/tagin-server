export class TokenResponseDto {
  /** Access Token (JWT, Authorization: Bearer) */
  accessToken: string;

  /** Refresh Token (1회용, 재발급 시마다 교체) */
  refreshToken: string;
}
