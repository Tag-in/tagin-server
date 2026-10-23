import { UserStatus, type User } from '../entities/user.entity.js';
import { isUsableUser } from './user-status.util.js';

describe('isUsableUser', () => {
  const userOf = (status: UserStatus, deletedAt: Date | null = null) =>
    ({ id: 'user-1', status, deletedAt }) as User;

  it('ACTIVE이고 삭제되지 않은 사용자만 허용한다', () => {
    expect(isUsableUser(userOf(UserStatus.ACTIVE))).toBe(true);
  });

  it.each([UserStatus.SUSPENDED, UserStatus.WITHDRAWN])(
    '%s 사용자는 거부한다',
    (status) => {
      expect(isUsableUser(userOf(status))).toBe(false);
    },
  );

  it('status와 무관하게 soft delete된 사용자는 거부한다', () => {
    expect(isUsableUser(userOf(UserStatus.ACTIVE, new Date()))).toBe(false);
  });

  it('사용자가 없으면 거부한다', () => {
    expect(isUsableUser(null)).toBe(false);
  });
});
