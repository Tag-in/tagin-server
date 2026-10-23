import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { RefreshTokenService } from './refresh-token.service.js';

// 필요한 명령만 구현한 인메모리 Redis (TTL은 검증 대상이 아님)
function createFakeRedis() {
  const store = new Map<string, string>();
  const redis = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    getdel: async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    del: async (...keys: string[]) => {
      keys.forEach((key) => store.delete(key));
      return keys.length;
    },
    multi: () => {
      const ops: Array<[string, string]> = [];
      const chain = {
        set: (key: string, value: string) => {
          ops.push([key, value]);
          return chain;
        },
        exec: async () => {
          ops.forEach(([key, value]) => store.set(key, value));
          return [];
        },
      };
      return chain;
    },
  };
  return { redis, store };
}

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let store: Map<string, string>;

  beforeEach(() => {
    const fake = createFakeRedis();
    store = fake.store;
    service = new RefreshTokenService(
      fake.redis as unknown as Redis,
      { getOrThrow: () => 1_209_600 } as unknown as ConfigService,
    );
  });

  it('토큰 원문은 저장하지 않는다', async () => {
    const token = await service.issue('user-1');

    expect([...store.keys()].some((key) => key.includes(token))).toBe(false);
    expect([...store.values()].some((value) => value.includes(token))).toBe(
      false,
    );
  });

  it('rotate는 기존 토큰을 소비하고 새 토큰을 발급한다', async () => {
    const first = await service.issue('user-1');

    const { userId, refreshToken: second } = await service.rotate(first);

    expect(userId).toBe('user-1');
    expect(second).not.toBe(first);
    await expect(service.rotate(second)).resolves.toMatchObject({
      userId: 'user-1',
    });
  });

  it('이미 교체된 토큰을 재사용하면 거부하고 family 전체를 폐기한다', async () => {
    const first = await service.issue('user-1');
    const { refreshToken: second } = await service.rotate(first);

    await expect(service.rotate(first)).rejects.toThrow(UnauthorizedException);
    await expect(service.rotate(second)).rejects.toThrow(UnauthorizedException);
  });

  it('알 수 없는 토큰은 거부한다', async () => {
    await expect(service.rotate('unknown')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('revoke 이후에는 재발급할 수 없다', async () => {
    const token = await service.issue('user-1');

    await service.revoke(token);

    await expect(service.rotate(token)).rejects.toThrow(UnauthorizedException);
  });

  it('revoke는 다른 로그인(family)의 토큰에 영향을 주지 않는다', async () => {
    const mine = await service.issue('user-1');
    const other = await service.issue('user-1');

    await service.revoke(mine);

    await expect(service.rotate(other)).resolves.toMatchObject({
      userId: 'user-1',
    });
  });
});
