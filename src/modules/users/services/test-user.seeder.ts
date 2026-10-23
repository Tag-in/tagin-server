import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resolveTestUserId } from '../../../common/utils/test-user.util.js';
import { User } from '../entities/user.entity.js';

/**
 * TEMP(test): 토큰 없는 요청에 쓰는 테스트 사용자를 기동 시 한 번 만든다 (Tag-in/tagin-server#18).
 * drive_* 테이블의 owner_id가 users를 참조하므로 사용자가 없으면 업로드가 FK 오류로 실패한다. 배포 전 제거.
 */
@Injectable()
export class TestUserSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(TestUserSeeder.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const id = resolveTestUserId();
    if (!id) {
      return;
    }
    const now = new Date();
    await this.users
      .createQueryBuilder()
      .insert()
      .values({
        id,
        email: `test-user+${id}@tagin.local`,
        nickname: '테스트 사용자',
        emailVerifiedAt: now,
        termsAgreedAt: now,
        privacyAgreedAt: now,
      })
      .orIgnore()
      .execute();
    this.logger.warn(
      `인증 우회 활성: 토큰 없는 요청은 테스트 사용자(${id})로 처리됩니다`,
    );
  }
}
