import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import {
  ApiAuth,
  ApiErrorResponse,
} from '../../../common/swagger/swagger.decorators.js';
import { DriveSearchResponseDto } from '../dto/drive-search-response.dto.js';
import { SearchDriveItemsDto } from '../dto/search-drive-items.dto.js';
import { DriveSearchService } from '../services/drive-search.service.js';

@ApiTags('Drive')
@Controller('drive')
export class DriveSearchController {
  constructor(private readonly search: DriveSearchService) {}

  /** 드라이브 의미 검색 (folderId를 주면 선택한 폴더 안에서만 검색) */
  @ApiAuth()
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '요청 값 검증 실패')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, '폴더를 찾을 수 없음')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, '임베딩 API 호출 실패')
  // 요청마다 유료 임베딩 API를 호출하므로 전역 한도보다 낮게 둔다.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Get('search')
  searchItems(
    @CurrentUserId() userId: string,
    @Query() dto: SearchDriveItemsDto,
  ): Promise<DriveSearchResponseDto> {
    return this.search.search(userId, {
      query: dto.q,
      folderId: dto.folderId,
      limit: dto.limit,
    });
  }
}
