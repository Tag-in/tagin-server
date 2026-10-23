import { ApiProperty } from '@nestjs/swagger';
import { DriveItemKind } from './drive-search-response.dto.js';

export class DriveFolderDto {
  id: string;

  /** @example '매출 보고' */
  name: string;

  /** 최상위 폴더면 null */
  parentId: string | null;

  /** 폴더 직속 파일·링크 수 (하위 폴더 안의 항목은 제외) */
  itemCount: number;

  /** 중요 표시한 시각. 표시하지 않았으면 null */
  starredAt: Date | null;

  createdAt: Date;

  updatedAt: Date;
}

export class DriveFolderListResponseDto {
  /** 휴지통에 없는 내 폴더 전체 (이름 순). parentId로 트리를 구성한다. */
  folders: DriveFolderDto[];
}

export class DriveItemDto {
  id: string;

  folderId: string;

  @ApiProperty({ enum: DriveItemKind, enumName: 'DriveItemKind' })
  kind: DriveItemKind;

  /** 파일명 또는 링크 제목 */
  name: string;

  /** FILE만 값이 있다 */
  mimeType: string | null;

  /** FILE만 값이 있다 */
  sizeBytes: number | null;

  /** LINK만 값이 있다 */
  url: string | null;

  /** 임베딩에 사용한 본문 일부 */
  summary: string | null;

  /** 중요 표시한 시각. 표시하지 않았으면 null */
  starredAt: Date | null;

  createdAt: Date;
}

export class DriveItemWithFolderDto extends DriveItemDto {
  /** 항목이 들어 있는 폴더 이름 */
  folderName: string;
}

export class DriveFolderPathEntryDto {
  id: string;

  name: string;
}

export class DriveFolderContentsResponseDto {
  folder: DriveFolderDto;

  /** 최상위 폴더부터 현재 폴더까지 (현재 폴더 포함) */
  path: DriveFolderPathEntryDto[];

  /** 직속 하위 폴더 (이름 순) */
  folders: DriveFolderDto[];

  /** 직속 파일·링크 (이름 순) */
  items: DriveItemDto[];
}
