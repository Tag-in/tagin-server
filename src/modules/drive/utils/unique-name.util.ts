/**
 * taken에 없는 이름을 반환한다. 겹치면 "report (1).pdf"처럼 번호를 붙이며,
 * 파일은 확장자 앞에, 확장자가 없거나 숨김 파일(".env")·폴더는 끝에 붙인다.
 */
export const resolveUniqueName = (
  name: string,
  taken: ReadonlySet<string>,
  { keepExtension }: { keepExtension: boolean },
): string => {
  if (!taken.has(name)) return name;

  const dot = keepExtension ? name.lastIndexOf('.') : -1;
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  for (let n = 1; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
};
