import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SearchDriveItemsDto {
  /**
   * 검색어. 키워드가 아니라 의미(벡터 유사도)로 찾는다.
   * @example '분기별 매출 보고서'
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  q: string;

  /** 검색 범위로 선택한 폴더. 지정하면 이 폴더와 하위 폴더의 항목만 찾고, 비우면 내 드라이브 전체에서 찾는다. */
  @IsOptional()
  @IsUUID()
  folderId?: string;

  /**
   * 최대 결과 수 (유사도 높은 순)
   * @example 20
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
