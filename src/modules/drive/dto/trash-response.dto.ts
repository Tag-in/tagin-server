import { ApiProperty } from '@nestjs/swagger';
import { DriveItemKind } from './drive-search-response.dto.js';
import { MoveEntryType } from './move-drive-response.dto.js';

export class DeleteDriveResponseDto {
  /** 휴지통으로 보낸 파일·링크 수 (삭제한 폴더 안의 항목 포함) */
  deletedItemCount: number;

  /** 휴지통으로 보낸 폴더 수 (삭제한 폴더의 하위 폴더 포함) */
  deletedFolderCount: number;

  /** 이 시각이 지나면 자동으로 영구 삭제된다 */
  purgeAt: Date;
}

export class RestoreResultDto {
  type: MoveEntryType;

  id: string;

  /** 휴지통에 있던 이름 */
  name: string;

  /** 같은 위치에 같은 이름이 있어 번호를 붙인 경우의 새 이름, 아니면 null */
  renamedTo: string | null;
}

export class RestoreDriveResponseDto {
  /** 요청한 순서(항목 → 폴더)대로의 결과. 폴더와 함께 복원된 하위 항목은 포함하지 않는다. */
  results: RestoreResultDto[];
}

export class TrashEntryDto {
  type: MoveEntryType;

  id: string;

  name: string;

  /** 파일·링크 구분. 폴더는 null */
  @ApiProperty({
    enum: DriveItemKind,
    enumName: 'DriveItemKind',
    nullable: true,
  })
  kind: DriveItemKind | null;

  /** 파일만 값이 있다 */
  sizeBytes: number | null;

  deletedAt: Date;

  /** 이 시각이 지나면 자동으로 영구 삭제된다 */
  purgeAt: Date;
}

export class TrashListResponseDto {
  /** 보관 일수 */
  retentionDays: number;

  /** 직접 삭제한 항목만, 최근 삭제 순. 폴더와 함께 지워진 하위 항목은 폴더를 복원하면 같이 돌아온다. */
  entries: TrashEntryDto[];
}
