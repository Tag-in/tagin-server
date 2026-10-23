import type { EntityManager } from 'typeorm';

/** 사용자 단위로 삭제·복원·영구 삭제를 직렬화한다 (트랜잭션 종료 시 자동 해제). */
export const lockTrash = (em: EntityManager, userId: string) =>
  em.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `drive-trash:${userId}`,
  ]);
