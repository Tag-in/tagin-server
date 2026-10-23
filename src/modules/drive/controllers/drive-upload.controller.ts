import {
  BadRequestException,
  Body,
  Controller,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import {
  ApiAuth,
  ApiErrorResponse,
} from '../../../common/swagger/swagger.decorators.js';
import {
  UploadFileDto,
  UploadLinkDto,
  UploadResponseDto,
} from '../dto/upload-drive.dto.js';
import { DriveUploadService } from '../services/drive-upload.service.js';
import { MAX_UPLOAD_BYTES } from '../utils/upload-content.util.js';

/** multer가 메모리에 올린 파일 (필요한 필드만) */
interface MulterFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

@ApiTags('Drive')
@Controller('drive')
export class DriveUploadController {
  constructor(private readonly upload: DriveUploadService) {}

  /** 파일 업로드. 내용을 분석해 비슷한 폴더에 자동으로 넣거나 새 폴더를 만든다 (folderId를 주면 그 폴더에) */
  @ApiAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        folderId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (파일 없음, 빈 파일, 분류할 내용 없음 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '폴더가 없거나 본인 소유가 아니거나 휴지통에 있음',
  )
  @ApiErrorResponse(HttpStatus.PAYLOAD_TOO_LARGE, '파일이 100MB를 넘음')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, '임베딩 API 호출 실패')
  // 요청마다 유료 임베딩 API를 호출하므로 전역 한도보다 낮게 둔다.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      // 기본값(latin1)이면 한글 파일명이 깨진다.
      defParamCharset: 'utf8',
    }),
  )
  @Post('files')
  uploadFile(
    @CurrentUserId() userId: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() dto: UploadFileDto,
  ): Promise<UploadResponseDto> {
    if (!file)
      throw new BadRequestException('file 필드로 파일을 보내야 합니다.');
    return this.upload.uploadFile(
      userId,
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      },
      dto.folderId,
    );
  }

  /** 링크 저장. 내려받지 않고 URL·제목·설명으로 분류한다 (folderId를 주면 그 폴더에) */
  @ApiAuth()
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '요청 값 검증 실패')
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '폴더가 없거나 본인 소유가 아니거나 휴지통에 있음',
  )
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, '임베딩 API 호출 실패')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('links')
  uploadLink(
    @CurrentUserId() userId: string,
    @Body() dto: UploadLinkDto,
  ): Promise<UploadResponseDto> {
    return this.upload.uploadLink(userId, dto);
  }
}
