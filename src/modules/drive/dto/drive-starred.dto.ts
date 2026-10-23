import {
  DriveFolderDto,
  DriveItemWithFolderDto,
} from './drive-browse-response.dto.js';

export class DriveStarredResponseDto {
  /** 중요 표시한 폴더 (휴지통 제외, 최근 표시 순) */
  folders: DriveFolderDto[];

  /** 중요 표시한 파일·링크 (휴지통 제외, 최근 표시 순) */
  items: DriveItemWithFolderDto[];
}

export class StarDriveResponseDto {
  /** 중요 표시(또는 해제)한 파일·링크 수 */
  itemCount: number;

  /** 중요 표시(또는 해제)한 폴더 수 */
  folderCount: number;
}
