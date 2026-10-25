export class DownloadUrlResponseDto {
  /** 스토리지에서 바로 내려받는 임시 URL (인증 헤더 불필요, 유출되지 않게 주의) */
  url: string;

  /** 저장될 파일명 */
  filename: string;

  /** 이 시각이 지나면 URL이 만료된다 */
  expiresAt: Date;
}
