import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthProvider, UserIdentity } from './user-identity.entity.js';
import { User } from './user.entity.js';

export interface SocialProfile {
  providerUserId: string;
  email: string;
  name: string;
  picture: string | null;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserIdentity)
    private readonly identities: Repository<UserIdentity>,
  ) {}

  async findOrCreateBySocial(
    provider: AuthProvider,
    { providerUserId, ...profile }: SocialProfile,
  ): Promise<User> {
    const find = async () =>
      (
        await this.identities.findOne({
          where: { provider, providerUserId },
          relations: { user: true },
        })
      )?.user;

    const existing = await find();
    if (existing) return existing;

    try {
      return await this.identities.manager.transaction(async (em) => {
        const user = await em.save(em.create(User, profile));
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
