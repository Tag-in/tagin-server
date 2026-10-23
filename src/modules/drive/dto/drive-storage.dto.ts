export class DriveStorageResponseDto {
  /**
   * 사용 중인 용량(바이트). 휴지통 파일도 스토리지 객체가 남아 있으므로 포함한다.
   * @example 1502893
   */
  usedBytes: number;

  /** usedBytes 중 휴지통에 있는 파일의 용량 */
  trashBytes: number;

  /**
   * 저장 용량 한도(바이트)
   * @example 5368709120
   */
  limitBytes: number;

  /** 휴지통에 없는 파일·링크 수 */
  itemCount: number;
}
