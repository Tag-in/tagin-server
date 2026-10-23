import { describeError } from '../error-detail.util.js';

describe('describeError', () => {
  it('이름과 메시지를 보여준다', () => {
    expect(describeError(new TypeError('fetch failed'))).toBe(
      'TypeError: fetch failed',
    );
  });

  it('message가 비어 있는 AggregateError는 하위 에러의 코드까지 보여준다', () => {
    const refused = (addr: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${addr}`), {
        code: 'ECONNREFUSED',
      });
    const error = new AggregateError([
      refused('::1:9000'),
      refused('127.0.0.1:9000'),
    ]);

    expect(describeError(error)).toBe(
      'AggregateError (Error: connect ECONNREFUSED ::1:9000 [ECONNREFUSED], Error: connect ECONNREFUSED 127.0.0.1:9000 [ECONNREFUSED])',
    );
  });

  it('cause를 따라간다', () => {
    const error = new Error('request failed', {
      cause: new Error('socket hang up'),
    });

    expect(describeError(error)).toBe(
      'Error: request failed (Error: socket hang up)',
    );
  });

  it('Error가 아니면 문자열로 바꾼다', () => {
    expect(describeError('boom')).toBe('boom');
  });
});
