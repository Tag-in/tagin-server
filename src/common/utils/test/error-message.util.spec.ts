import { errorMessage } from '../error-message.util.js';

describe('errorMessage', () => {
  it('일반 Error는 message를 그대로 쓴다', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('message가 빈 AggregateError는 하위 오류 메시지를 보여준다', () => {
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}`), {
        code: 'ECONNREFUSED',
      });
    const error = new AggregateError(
      [refused('::1:9000'), refused('127.0.0.1:9000')],
      '',
    );
    expect(errorMessage(error)).toBe(
      'AggregateError: connect ECONNREFUSED ::1:9000, connect ECONNREFUSED 127.0.0.1:9000',
    );
  });

  it('message도 하위 오류도 없으면 오류 이름을 쓴다', () => {
    expect(errorMessage(new TypeError(''))).toBe('TypeError');
  });

  it('Error가 아닌 값은 문자열로 바꾼다', () => {
    expect(errorMessage('plain')).toBe('plain');
  });
});
