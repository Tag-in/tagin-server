import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  // UseGuards, // TEMP(test), #18
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
// TEMP(test): 테스트용 인증 가드 비활성화 (Tag-in/tagin-server#18). 배포 전 원복
// import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import {
  ApiAuth,
  ApiErrorResponse,
} from '../../../common/swagger/swagger.decorators.js';
import { MoveDriveDto } from '../dto/move-drive.dto.js';
import { MoveDriveResponseDto } from '../dto/move-drive-response.dto.js';
import { DriveMoveService } from '../services/drive-move.service.js';

@ApiTags('Drive')
@Controller('drive')
export class DriveMoveController {
  constructor(private readonly move: DriveMoveService) {}

  /** 파일·링크·폴더 이동 (여러 개 가능, 폴더를 옮기면 하위 폴더와 항목이 함께 이동) */
  @ApiAuth()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    '요청 값 검증 실패 (이동 대상 없음, 파일을 최상위로 이동, 폴더를 자기 자신/하위로 이동 포함)',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    '대상 폴더 또는 이동할 항목이 없거나 본인 소유가 아님',
  )
  @ApiErrorResponse(
    HttpStatus.CONFLICT,
    '대상 폴더에 같은 이름이 있음 (onConflict=FAIL). 응답 body의 conflicts에 충돌 항목 포함',
  )
  // @UseGuards(JwtAuthGuard) // TEMP(test), #18
  @HttpCode(HttpStatus.OK)
  @Post('move')
  moveEntries(
    @CurrentUserId() userId: string,
    @Body() dto: MoveDriveDto,
  ): Promise<MoveDriveResponseDto> {
    return this.move.move(userId, dto);
  }
}
