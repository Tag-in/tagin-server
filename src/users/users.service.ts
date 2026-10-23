import { ConflictException, Injectable } from '@nestjs/common';
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

export interface SignupConsents {
  marketingAgreed: boolean;
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
   * 소셜 계정에 연결된 사용자를 반환한다. 없으면 null (가입시키지 않는다).
   * 탈퇴(soft delete)한 사용자도 반환하므로 호출 측에서 status를 확인해야 한다.
   */
  async findBySocial(
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<User | null> {
    const identity = await this.identities.findOne({
      where: { provider, providerUserId },
      relations: { user: true },
      withDeleted: true,
    });
    return identity?.user ?? null;
  }

  /**
   * 소셜 계정으로 사용자를 가입시킨다. 이용약관/개인정보 동의는 필수라 동의 시각을 함께 기록한다.
   * 소셜 로그인은 이메일 인증이 선행되므로 emailVerifiedAt도 기록한다.
   * 이미 가입된 소셜 계정이거나 같은 이메일의 사용자가 있으면(동시 요청 포함) ConflictException.
   */
  async createBySocial(
    provider: AuthProvider,
    { providerUserId, ...profile }: SocialProfile,
    { marketingAgreed }: SignupConsents,
  ): Promise<User> {
    const now = new Date();
    try {
      return await this.identities.manager.transaction(async (em) => {
        const user = await em.save(
          em.create(User, {
            ...profile,
            emailVerifiedAt: now,
            termsAgreedAt: now,
            privacyAgreedAt: now,
            marketingAgreedAt: marketingAgreed ? now : null,
          }),
        );
        await em.insert(UserIdentity, {
          provider,
          providerUserId,
          userId: user.id,
        });
        return user;
      });
    } catch (error) {
      const code = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      if (code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('이미 가입된 계정입니다.');
      }
      throw error;
    }
  }
}
