import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import {
  ApiAuth,
  ApiErrorResponse,
} from '../../../common/swagger/swagger.decorators.js';
import { DriveSelectionDto } from '../dto/drive-selection.dto.js';
import {
  DeleteDriveResponseDto,
  PurgeDriveResponseDto,
  RestoreDriveResponseDto,
  TrashListResponseDto,
} from '../dto/trash-response.dto.js';
import { DriveTrashService } from '../services/drive-trash.service.js';
import { TrashPurgeService } from '../services/trash-purge.service.js';

@ApiTags('Drive')
@Controller('drive')
export class DriveTrashController {
  constructor(
    private readonly trash: DriveTrashService,
    private readonly purge: TrashPurgeService,
  ) {}

  /** 파일·링크·폴더를 휴지통으로 이동 (여러 개 가능, 폴더는 하위 폴더·항목까지). 보관 기간이 지나면 자동 영구 삭제 */
  @ApiAuth()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (삭제 대상 없음 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '항목이 없거나 본인 소유가 아니거나 이미 휴지통에 있음',
  )
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('delete')
  delete(
    @CurrentUserId() userId: string,
    @Body() dto: DriveSelectionDto,
  ): Promise<DeleteDriveResponseDto> {
    return this.trash.delete(userId, dto);
  }

  /** 휴지통에서 복원 (여러 개 가능, 폴더는 함께 지워진 하위 폴더·항목까지). 이름이 겹치면 번호를 붙여 복원 */
  @ApiAuth()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (복원 대상 없음 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '휴지통에 없거나 본인 소유가 아님 (보관 기간이 지나 영구 삭제된 경우 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    '상위 폴더가 휴지통에 있음. 응답 body의 parentFolderIds를 먼저 복원',
  )
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('restore')
  restore(
    @CurrentUserId() userId: string,
    @Body() dto: DriveSelectionDto,
  ): Promise<RestoreDriveResponseDto> {
    return this.trash.restore(userId, dto);
  }

  /** 휴지통 목록 (직접 삭제한 항목만, 최근 삭제 순) */
  @ApiAuth()
  @UseGuards(JwtAuthGuard)
  @Get('trash')
  list(@CurrentUserId() userId: string): Promise<TrashListResponseDto> {
    return this.trash.list(userId);
  }

  /** 휴지통의 항목을 즉시 영구 삭제 (여러 개 가능, 폴더는 하위 폴더·항목까지). 되돌릴 수 없다 */
  @ApiAuth()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (삭제 대상 없음 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '휴지통에 없거나 본인 소유가 아님 (보관 기간이 지나 이미 영구 삭제된 경우 포함)',
  )
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('trash/purge')
  purgeSelection(
    @CurrentUserId() userId: string,
    @Body() dto: DriveSelectionDto,
  ): Promise<PurgeDriveResponseDto> {
    return this.purge.purgeSelection(userId, dto);
  }
}
