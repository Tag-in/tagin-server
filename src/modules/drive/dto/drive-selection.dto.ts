import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

export const MAX_SELECTION = 100;

/** 이동·삭제·복원에서 공통으로 쓰는 다중 선택. 둘 중 하나는 비어 있지 않아야 한다. */
export class DriveSelectionDto {
  /** 파일·링크 ID 목록 (최대 100개) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SELECTION)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds?: string[];

  /** 폴더 ID 목록 (최대 100개). 폴더를 대상으로 하면 하위 폴더와 그 안의 항목도 함께 처리된다. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SELECTION)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  folderIds?: string[];
}
