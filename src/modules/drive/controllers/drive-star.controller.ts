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
  DriveStarredResponseDto,
  StarDriveResponseDto,
} from '../dto/drive-starred.dto.js';
import { DriveStarService } from '../services/drive-star.service.js';

@ApiTags('Drive')
@Controller('drive')
export class DriveStarController {
  constructor(private readonly stars: DriveStarService) {}

  /** 중요 표시한 폴더와 파일·링크 (휴지통 제외, 최근 표시 순) */
  @ApiAuth()
  @UseGuards(JwtAuthGuard)
  @Get('starred')
  list(@CurrentUserId() userId: string): Promise<DriveStarredResponseDto> {
    return this.stars.list(userId);
  }

  /** 파일·링크·폴더에 중요 표시 (여러 개 가능) */
  @ApiAuth()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (대상 없음 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '항목이 없거나 본인 소유가 아니거나 휴지통에 있음',
  )
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('star')
  star(
    @CurrentUserId() userId: string,
    @Body() dto: DriveSelectionDto,
  ): Promise<StarDriveResponseDto> {
    return this.stars.setStarred(userId, dto, true);
  }

  /** 중요 표시 해제 (여러 개 가능) */
  @ApiAuth()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (대상 없음 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '항목이 없거나 본인 소유가 아니거나 휴지통에 있음',
  )
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('unstar')
  unstar(
    @CurrentUserId() userId: string,
    @Body() dto: DriveSelectionDto,
  ): Promise<StarDriveResponseDto> {
    return this.stars.setStarred(userId, dto, false);
  }
}
