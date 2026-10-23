import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthProvider, UserIdentity } from './user-identity.entity.js';
import { User } from './user.entity.js';

export interface SocialProfile {
  providerUserId: string;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserIdentity)
    private readonly identities: Repository<UserIdentity>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  async recordLogin(id: string): Promise<void> {
    await this.users.update(id, { lastLoginAt: new Date() });
  }

  /**
   * 소셜 계정에 연결된 사용자를 반환하고, 없으면 가입시킨다.
   * 탈퇴(soft delete)한 사용자도 반환하므로 호출 측에서 status를 확인해야 한다.
   * 소셜 로그인은 이메일 인증이 선행되므로 가입 시 emailVerifiedAt을 기록한다.
   */
  async findOrCreateBySocial(
    provider: AuthProvider,
    { providerUserId, ...profile }: SocialProfile,
  ): Promise<User> {
    const find = async () =>
      (
        await this.identities.findOne({
          where: { provider, providerUserId },
          relations: { user: true },
          withDeleted: true,
        })
      )?.user;

    const existing = await find();
    if (existing) return existing;

    try {
      return await this.identities.manager.transaction(async (em) => {
        const user = await em.save(
          em.create(User, { ...profile, emailVerifiedAt: new Date() }),
        );
        await em.insert(UserIdentity, {
          provider,
          providerUserId,
          userId: user.id,
        });
        return user;
      });
    } catch (error) {
      // 최초 로그인 동시 요청: 먼저 커밋된 계정을 사용한다.
      const code = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      const created = code === PG_UNIQUE_VIOLATION ? await find() : undefined;
      if (created) return created;
      throw error;
    }
  }
}
