/**
 * 로그용 에러 설명. message가 비어 있는 에러(예: IPv4/IPv6 연결이 모두 거부될 때의 AggregateError)나
 * 원인이 cause/errors에 들어 있는 에러도 이름·코드·하위 에러까지 풀어서 보여준다.
 */
export function describeError(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return String(error);

  const { code } = error as { code?: unknown };
  const parts = [
    error.name,
    error.message && `: ${error.message}`,
    code !== undefined && ` [${String(code)}]`,
  ].filter(Boolean);
  let text = parts.join('');
  if (depth >= 2) return text;

  const nested = [
    ...((error as { errors?: unknown[] }).errors ?? []),
    ...(error.cause === undefined ? [] : [error.cause]),
  ];
  if (nested.length > 0) {
    text += ` (${nested.map((e) => describeError(e, depth + 1)).join(', ')})`;
  }
  return text;
}
