import { UserStatus, type User } from '../entities/user.entity.js';

/** 로그인·토큰 재발급이 가능한 사용자인지 확인한다. (ACTIVE이고 soft delete되지 않음) */
export const isUsableUser = (user: User | null): user is User =>
  !!user && user.status === UserStatus.ACTIVE && !user.deletedAt;
