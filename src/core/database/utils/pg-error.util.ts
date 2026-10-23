const PG_UNIQUE_VIOLATION = '23505';

/** TypeORM QueryFailedError가 PostgreSQL unique 제약 위반인지 확인한다. */
export const isUniqueViolation = (error: unknown): boolean =>
  (error as { driverError?: { code?: string } } | null)?.driverError?.code ===
  PG_UNIQUE_VIOLATION;
