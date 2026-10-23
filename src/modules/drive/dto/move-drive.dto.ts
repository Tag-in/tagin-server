import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export const MAX_MOVE_ITEMS = 100;

export enum MoveConflictPolicy {
  /** 이름이 겹치는 항목이 하나라도 있으면 아무것도 이동하지 않고 409 */
  FAIL = 'FAIL',
  /** 이름이 겹치는 항목은 건너뛰고 나머지만 이동 */
  SKIP = 'SKIP',
  /** 이름이 겹치는 항목은 "이름 (1)"처럼 번호를 붙여 이동 */
  RENAME = 'RENAME',
}

export class MoveDriveDto {
  /**
   * 이동할 대상 폴더 ID. null이면 최상위로 이동한다 (폴더만 가능, 파일·링크는 항상 폴더 안에 있어야 한다).
   * @example '3f1c7a52-8b1e-4c0e-9d57-2b6f2f6a9e10'
   */
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  targetFolderId: string | null;

  /** 이동할 파일·링크 ID 목록 (최대 100개) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MOVE_ITEMS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds?: string[];

  /** 이동할 폴더 ID 목록 (최대 100개). 하위 폴더와 그 안의 항목은 함께 이동한다. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MOVE_ITEMS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  folderIds?: string[];

  /**
   * 대상 폴더에 같은 이름이 있을 때의 처리 방식 (생략 시 FAIL)
   * @example 'FAIL'
   */
  @IsOptional()
  @IsEnum(MoveConflictPolicy)
  onConflict?: MoveConflictPolicy;

  /**
   * true면 실제로 이동하지 않고 결과만 미리 계산한다. FAIL 정책의 충돌도 409 대신 결과(CONFLICT)로 반환한다. (생략 시 false)
   * @example false
   */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
