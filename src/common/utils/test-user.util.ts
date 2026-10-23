/**
 * TEMP(test): 인증 가드를 끈 동안 모든 요청이 사용할 사용자 id (Tag-in/tagin-server#18).
 * TEST_USER_ID를 따로 지정하지 않아도 동작하도록 고정 UUID를 기본값으로 쓴다. 배포 전 제거.
 */
export const DEFAULT_TEST_USER_ID = '00000000-0000-4000-8000-000000000001';

/** 운영(production)에서는 null을 반환해 인증 우회가 열리지 않게 한다. */
export function resolveTestUserId(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.NODE_ENV === 'production') {
    return null;
  }
  return env.TEST_USER_ID || DEFAULT_TEST_USER_ID;
}
