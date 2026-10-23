import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  // UseGuards, // TEMP(test), #18
} from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
// TEMP(test): 테스트용 인증 가드 비활성화 (Tag-in/tagin-server#18). 배포 전 원복
// import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import {
  ApiAuth,
  ApiErrorResponse,
} from '../../../common/swagger/swagger.decorators.js';
import { attachmentDisposition } from '../../../common/utils/content-disposition.util.js';
import { DriveSelectionDto } from '../dto/drive-selection.dto.js';
import { DownloadUrlResponseDto } from '../dto/download-response.dto.js';
import { DriveDownloadService } from '../services/drive-download.service.js';

@ApiTags('Drive')
@Controller('drive')
export class DriveDownloadController {
  constructor(private readonly download: DriveDownloadService) {}

  /** 파일 1개 다운로드 URL 발급 (5분간 유효한 임시 URL, 파일은 스토리지에서 직접 내려받음) */
  @ApiAuth()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '링크 항목이라 내려받을 파일이 없음',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '파일이 없거나 본인 소유가 아니거나 휴지통에 있음',
  )
  // @UseGuards(JwtAuthGuard) // TEMP(test), #18
  @Get('items/:itemId/download')
  getUrl(
    @CurrentUserId() userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<DownloadUrlResponseDto> {
    return this.download.getDownloadUrl(userId, itemId);
  }

  /** 여러 파일·폴더를 폴더 구조를 유지한 ZIP으로 내려받기 (링크·휴지통 항목 제외, 응답 본문이 ZIP 파일) */
  @ApiAuth()
  @ApiProduces('application/zip')
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (선택 대상 없음, 내려받을 파일 없음 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '항목이 없거나 본인 소유가 아니거나 휴지통에 있음',
  )
  @ApiErrorResponse(
    HttpStatus.PAYLOAD_TOO_LARGE,
    '선택한 파일 수 또는 총 크기가 한도를 넘음',
  )
  // 서버가 직접 스트리밍하므로 전역 한도보다 낮게 둔다.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  // @UseGuards(JwtAuthGuard) // TEMP(test), #18
  @HttpCode(HttpStatus.OK)
  @Post('download')
  async downloadZip(
    @CurrentUserId() userId: string,
    @Body() dto: DriveSelectionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { filename, archive } = await this.download.createArchive(
      userId,
      dto,
    );
    // 클라이언트가 중간에 끊으면 스토리지 읽기도 멈춘다.
    res.once('close', () => {
      if (!res.writableFinished) archive.destroy();
    });
    return new StreamableFile(archive, {
      type: 'application/zip',
      disposition: attachmentDisposition(filename),
    });
  }
}
