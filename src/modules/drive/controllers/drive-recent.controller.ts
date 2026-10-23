import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { ApiAuth } from '../../../common/swagger/swagger.decorators.js';
import {
  DriveRecentResponseDto,
  RecentDriveItemsDto,
} from '../dto/drive-recent.dto.js';
import { DriveRecentService } from '../services/drive-recent.service.js';

@ApiTags('Drive')
@Controller('drive')
export class DriveRecentController {
  constructor(private readonly recent: DriveRecentService) {}

  /** 최근 추가한 파일·링크 (휴지통 제외, 최근 순) */
  @ApiAuth()
  @UseGuards(JwtAuthGuard)
  @Get('recent')
  list(
    @CurrentUserId() userId: string,
    @Query() dto: RecentDriveItemsDto,
  ): Promise<DriveRecentResponseDto> {
    return this.recent.list(userId, dto.limit);
  }
}
