import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import {
  ApiAuth,
  ApiErrorResponse,
} from '../../../common/swagger/swagger.decorators.js';
import { UserMeResponseDto } from '../dto/user-me-response.dto.js';
import { UsersService } from '../services/users.service.js';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** 내 정보 (프로필, 저장 용량 한도) */
  @ApiAuth()
  @ApiErrorResponse(HttpStatus.NOT_FOUND, '탈퇴했거나 없는 사용자')
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUserId() userId: string): Promise<UserMeResponseDto> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    return UserMeResponseDto.from(user);
  }
}
