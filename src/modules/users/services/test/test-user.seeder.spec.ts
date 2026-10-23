import type { Repository } from 'typeorm';
import { DEFAULT_TEST_USER_ID } from '../../../../common/utils/test-user.util.js';
import type { User } from '../../entities/user.entity.js';
import { TestUserSeeder } from '../test-user.seeder.js';

describe('TestUserSeeder', () => {
  const builder = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const users = {
    createQueryBuilder: vi.fn(() => builder),
  } as unknown as Repository<User>;
  const seeder = new TestUserSeeder(users);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'local');
    vi.stubEnv('TEST_USER_ID', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('기본 테스트 사용자를 중복 없이 생성한다', async () => {
    await seeder.onApplicationBootstrap();

    expect(builder.values).toHaveBeenCalledWith(
      expect.objectContaining({ id: DEFAULT_TEST_USER_ID }),
    );
    expect(builder.orIgnore).toHaveBeenCalled();
    expect(builder.execute).toHaveBeenCalled();
  });

  it('TEST_USER_ID가 있으면 그 id로 생성한다', async () => {
    vi.stubEnv('TEST_USER_ID', '11111111-1111-4111-8111-111111111111');

    await seeder.onApplicationBootstrap();

    expect(builder.values).toHaveBeenCalledWith(
      expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }),
    );
  });

  it('production에서는 아무것도 하지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await seeder.onApplicationBootstrap();

    expect(users.createQueryBuilder).not.toHaveBeenCalled();
  });
});
