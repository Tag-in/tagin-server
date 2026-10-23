import { ApiProperty } from '@nestjs/swagger';

export enum DriveItemKind {
  FILE = 'FILE',
  LINK = 'LINK',
}

export class DriveSearchItemDto {
  id: string;

  folderId: string;

  /** @example '매출 보고' */
  folderName: string;

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

  /**
   * 검색어와의 코사인 유사도 (-1~1, 클수록 관련 높음)
   * @example 0.72
   */
  similarity: number;

  createdAt: Date;
}

export class DriveSearchResponseDto {
  /** 유사도 높은 순 */
  items: DriveSearchItemDto[];
}
