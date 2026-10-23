/**
 * 로그용 오류 메시지. 연결 실패 시 Node가 던지는 AggregateError는 message가 비어 있어
 * (예: localhost 접속 거부 시 IPv4·IPv6 시도가 각각 실패), 하위 오류의 message를 이어 붙인다.
 */
export const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const own = error.message || (error as NodeJS.ErrnoException).code || '';
  if (!(error instanceof AggregateError)) return own || error.name;
  const inner = error.errors
    .map((e) => (e instanceof Error ? e.message || e.name : String(e)))
    .join(', ');
  return [own || error.name, inner].filter(Boolean).join(': ');
};
