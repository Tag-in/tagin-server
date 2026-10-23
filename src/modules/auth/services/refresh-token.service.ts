import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants.js';

interface RefreshSession {
  userId: string;
  familyId: string;
}

// 토큰 원문은 저장하지 않고 SHA-256 해시만 키로 사용한다.
//  - rt:{hash}        현재 유효한 토큰 → 세션 정보
//  - rt:used:{hash}   교체되어 소비된 토큰 → familyId (재사용 감지용)
//  - rt:family:{id}   로그인 단위(family)의 현재 유효 토큰 해시
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const tokenKey = (hash: string) => `rt:${hash}`;
const usedKey = (hash: string) => `rt:used:${hash}`;
const familyKey = (familyId: string) => `rt:family:${familyId}`;

@Injectable()
export class RefreshTokenService {
  private readonly ttl: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.ttl = config.getOrThrow<number>('JWT_REFRESH_EXPIRES_IN');
  }

  /** 로그인 시 새 family의 첫 토큰을 발급한다. */
  issue(userId: string): Promise<string> {
    return this.create(userId, randomUUID());
  }

  /**
   * 토큰을 소비하고 같은 family의 새 토큰을 발급한다.
   * 이미 교체된 토큰이 다시 들어오면 탈취로 보고 해당 family를 폐기한다.
   */
  async rotate(
    token: string,
  ): Promise<{ userId: string; refreshToken: string }> {
    const hash = hashToken(token);
    const raw = await this.redis.getdel(tokenKey(hash));

    if (!raw) {
      const reusedFamilyId = await this.redis.get(usedKey(hash));
      if (reusedFamilyId) await this.revokeFamily(reusedFamilyId);
      throw new UnauthorizedException('유효하지 않은 Refresh Token입니다.');
    }

    const { userId, familyId } = JSON.parse(raw) as RefreshSession;
    await this.redis.set(usedKey(hash), familyId, 'EX', this.ttl);
    return { userId, refreshToken: await this.create(userId, familyId) };
  }

  /** 로그아웃: 해당 토큰이 속한 family(로그인 1건)를 폐기한다. */
  async revoke(token: string): Promise<void> {
    const raw = await this.redis.get(tokenKey(hashToken(token)));
    if (!raw) return;
    await this.revokeFamily((JSON.parse(raw) as RefreshSession).familyId);
  }

  private async create(userId: string, familyId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = hashToken(token);
    const session: RefreshSession = { userId, familyId };

    await this.redis
      .multi()
      .set(tokenKey(hash), JSON.stringify(session), 'EX', this.ttl)
      .set(familyKey(familyId), hash, 'EX', this.ttl)
      .exec();
    return token;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    const currentHash = await this.redis.get(familyKey(familyId));
    await this.redis.del(
      familyKey(familyId),
      ...(currentHash ? [tokenKey(currentHash)] : []),
    );
  }
}
