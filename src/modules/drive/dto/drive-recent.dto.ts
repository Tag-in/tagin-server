import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DriveItemWithFolderDto } from './drive-browse-response.dto.js';

export const DEFAULT_RECENT_LIMIT = 20;
export const MAX_RECENT_LIMIT = 100;

export class RecentDriveItemsDto {
  /**
   * 최대 결과 수 (생략 시 20)
   * @example 20
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RECENT_LIMIT)
  limit?: number;
}

export class DriveRecentResponseDto {
  /** 휴지통에 없는 내 파일·링크를 최근 추가 순으로 */
  items: DriveItemWithFolderDto[];
}
