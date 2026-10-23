import {
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { DriveItemDto } from './drive-browse-response.dto.js';

export class UploadFileDto {
  /** 넣을 폴더. 비우면 내용이 가장 비슷한 폴더에 자동으로 넣거나 새 폴더를 만든다. */
  @IsOptional()
  @IsUUID()
  folderId?: string;
}

export class UploadLinkDto {
  /** http(s) 링크. 내려받지 않고 URL·제목·설명만 저장한다. */
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url: string;

  /** 비우면 도메인을 제목으로 쓴다 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** 분류에 함께 쓰는 설명 */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** 넣을 폴더. 비우면 내용이 가장 비슷한 폴더에 자동으로 넣거나 새 폴더를 만든다. */
  @IsOptional()
  @IsUUID()
  folderId?: string;
}

export class UploadedFolderDto {
  id: string;

  name: string;
}

export class UploadResponseDto {
  item: DriveItemDto;

  /** 항목이 들어간 폴더 */
  folder: UploadedFolderDto;

  /** 이번 업로드로 새 폴더를 만들었으면 true */
  folderCreated: boolean;

  /** 자동 분류로 기존 폴더에 넣은 경우 그 폴더와의 코사인 유사도, 아니면 null */
  similarity: number | null;
}
