import type { ValueTransformer } from 'typeorm';

// bigint는 드라이버가 문자열로 반환하므로 number로 변환한다. (Number.MAX_SAFE_INTEGER ≈ 9PB)
export const bigintTransformer: ValueTransformer = {
  to: (value?: number) => value,
  from: (value?: string | null) =>
    value === undefined || value === null ? value : Number(value),
};
