import { DEFAULT_TEST_USER_ID, resolveTestUserId } from '../test-user.util.js';

describe('resolveTestUserId', () => {
  it('TEST_USER_ID가 있으면 그 값을 사용한다', () => {
    expect(
      resolveTestUserId({ NODE_ENV: 'local', TEST_USER_ID: 'custom-id' }),
    ).toBe('custom-id');
  });

  it('TEST_USER_ID가 비어 있으면 기본 테스트 사용자를 사용한다', () => {
    expect(resolveTestUserId({ NODE_ENV: 'local', TEST_USER_ID: '' })).toBe(
      DEFAULT_TEST_USER_ID,
    );
    expect(resolveTestUserId({ NODE_ENV: 'development' })).toBe(
      DEFAULT_TEST_USER_ID,
    );
  });

  it('production에서는 항상 null이다', () => {
    expect(
      resolveTestUserId({ NODE_ENV: 'production', TEST_USER_ID: 'custom-id' }),
    ).toBeNull();
  });
});
