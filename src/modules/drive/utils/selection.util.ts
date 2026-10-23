import { NotFoundException } from '@nestjs/common';

/** 조회 결과를 요청한 ID 순서로 정렬한다. */
export const sortByRequest = <T extends { id: string }>(
  found: T[],
  requestedIds: string[],
): T[] =>
  found.sort((a, b) => requestedIds.indexOf(a.id) - requestedIds.indexOf(b.id));

/** 요청한 ID가 하나라도 조회되지 않았으면 404 (없는 항목·남의 항목·이미 휴지통인 항목을 구분하지 않는다). */
export const assertAllFound = (
  label: string,
  requestedIds: string[],
  found: { id: string }[],
): void => {
  const foundIds = new Set(found.map((entry) => entry.id));
  const missing = requestedIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new NotFoundException(`찾을 수 없는 ${label}: ${missing.join(', ')}`);
  }
};
