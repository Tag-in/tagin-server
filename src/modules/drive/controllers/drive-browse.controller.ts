import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import {
  ApiAuth,
  ApiErrorResponse,
} from '../../../common/swagger/swagger.decorators.js';
import {
  DriveFolderContentsResponseDto,
  DriveFolderListResponseDto,
} from '../dto/drive-browse-response.dto.js';
import { DriveBrowseService } from '../services/drive-browse.service.js';

@ApiTags('Drive')
@Controller('drive')
export class DriveBrowseController {
  constructor(private readonly browse: DriveBrowseService) {}

  /** 내 폴더 전체 목록 (트리 구성용, 휴지통 제외) */
  @ApiAuth()
  @UseGuards(JwtAuthGuard)
  @Get('folders')
  listFolders(
    @CurrentUserId() userId: string,
  ): Promise<DriveFolderListResponseDto> {
    return this.browse.listFolders(userId);
  }

  /** 폴더 내용 (직속 하위 폴더와 파일·링크, 최상위부터의 경로) */
  @ApiAuth()
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '폴더가 없거나 본인 소유가 아니거나 휴지통에 있음',
  )
  @UseGuards(JwtAuthGuard)
  @Get('folders/:folderId/contents')
  getContents(
    @CurrentUserId() userId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
  ): Promise<DriveFolderContentsResponseDto> {
    return this.browse.getContents(userId, folderId);
  }
}
