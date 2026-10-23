import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';

export type GoogleProfile = Pick<
  User,
  'googleId' | 'email' | 'name' | 'picture'
>;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async findOrCreateByGoogle(profile: GoogleProfile): Promise<User> {
    const existing = await this.users.findOneBy({ googleId: profile.googleId });
    if (existing) return existing;

    // 최초 로그인 동시 요청 시 unique 충돌을 무시하고 먼저 생성된 행을 사용한다.
    await this.users
      .createQueryBuilder()
      .insert()
      .values(profile)
      .orIgnore()
      .execute();
    return this.users.findOneByOrFail({ googleId: profile.googleId });
  }
}
