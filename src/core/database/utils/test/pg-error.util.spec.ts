import { isUniqueViolation } from '../pg-error.util.js';

describe('isUniqueViolation', () => {
  it('PostgreSQL unique 제약 위반(23505)이면 true', () => {
    expect(isUniqueViolation({ driverError: { code: '23505' } })).toBe(true);
  });

  it.each([
    { driverError: { code: '23503' } },
    new Error('db down'),
    null,
    undefined,
  ])('그 외 오류(%s)는 false', (error) => {
    expect(isUniqueViolation(error)).toBe(false);
  });
});
