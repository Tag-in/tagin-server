export enum MoveEntryType {
  /** 파일 또는 링크 */
  ITEM = 'ITEM',
  FOLDER = 'FOLDER',
}

export enum MoveStatus {
  /** 이동함 (dryRun이면 이동하게 될 항목) */
  MOVED = 'MOVED',
  /** 이미 대상 폴더에 있어 변경 없음 */
  UNCHANGED = 'UNCHANGED',
  /** 이름 충돌로 건너뜀 (onConflict=SKIP) */
  SKIPPED = 'SKIPPED',
  /** 이름 충돌 (onConflict=FAIL, dryRun 응답에서만 나타남) */
  CONFLICT = 'CONFLICT',
}

export class MoveResultDto {
  type: MoveEntryType;

  id: string;

  /** 이동 전 이름 */
  name: string;

  status: MoveStatus;

  /** onConflict=RENAME으로 이름이 바뀐 경우의 새 이름, 아니면 null */
  renamedTo: string | null;
}

export class MoveDriveResponseDto {
  dryRun: boolean;

  /** 이동한 대상 폴더 ID (최상위면 null) */
  targetFolderId: string | null;

  /** 요청한 순서(항목 → 폴더)대로의 결과 */
  results: MoveResultDto[];
}
