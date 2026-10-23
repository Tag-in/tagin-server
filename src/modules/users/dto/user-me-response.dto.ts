import { ApiProperty } from '@nestjs/swagger';
import { User, UserRole, UserStatus } from '../entities/user.entity.js';

export class UserMeResponseDto {
  id: string;

  /** @example 'user@example.com' */
  email: string;

  /** @example '태그인' */
  nickname: string;

  profileImageUrl: string | null;

  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' })
  status: UserStatus;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;

  /** 저장 용량 한도(바이트) */
  storageLimitBytes: number;

  createdAt: Date;

  static from(user: User): UserMeResponseDto {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      profileImageUrl: user.profileImageUrl,
      status: user.status,
      role: user.role,
      storageLimitBytes: user.storageLimitBytes,
      createdAt: user.createdAt,
    };
  }
}
