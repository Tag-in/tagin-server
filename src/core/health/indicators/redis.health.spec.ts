import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { RedisHealthIndicator } from './redis.health.js';

describe('RedisHealthIndicator', () => {
  const redis = { ping: vi.fn() };
  const indicator = new RedisHealthIndicator(
    redis as unknown as Redis,
    new HealthIndicatorService(),
  );

  it('PING 성공 시 up을 반환한다', async () => {
    redis.ping.mockResolvedValueOnce('PONG');

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
  });

  it('PING 실패 시 에러 메시지와 함께 down을 반환한다', async () => {
    redis.ping.mockRejectedValueOnce(new Error('connection refused'));

    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'down', message: 'connection refused' },
    });
  });
});
