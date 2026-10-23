import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { ApiAuth } from '../../../common/swagger/swagger.decorators.js';
import { DriveStorageResponseDto } from '../dto/drive-storage.dto.js';
import { DriveStorageService } from '../services/drive-storage.service.js';

@ApiTags('Drive')
@Controller('drive')
export class DriveStorageController {
  constructor(private readonly storage: DriveStorageService) {}

  /** 저장공간 사용량과 한도 (휴지통 파일 포함) */
  @ApiAuth()
  @UseGuards(JwtAuthGuard)
  @Get('storage')
  getUsage(@CurrentUserId() userId: string): Promise<DriveStorageResponseDto> {
    return this.storage.getUsage(userId);
  }
}
