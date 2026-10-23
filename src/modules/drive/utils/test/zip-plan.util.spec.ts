import { buildZipPlan, type ZipFile, type ZipFolder } from '../zip-plan.util.js';

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({ id, name, parentId }) satisfies ZipFolder;
const file = (id: string, folderId: string, name: string) =>
  ({ id, folderId, name, storageKey: `key-${id}` }) satisfies ZipFile;

const paths = (entries: { path: string }[]) => entries.map((e) => e.path);

describe('buildZipPlan', () => {
  it('폴더 구조를 유지하고 선택한 폴더를 최상위 디렉터리로 둔다', () => {
    const docs = folder('d', 'docs');
    const sub = folder('s', 'sub', 'd');

    const entries = buildZipPlan({
      roots: [docs],
      folders: [docs, sub],
      files: [file('1', 'd', 'a.pdf'), file('2', 's', 'b.pdf')],
    });

    expect(paths(entries).sort()).toEqual([
      'docs/',
      'docs/a.pdf',
      'docs/sub/',
      'docs/sub/b.pdf',
    ]);
    expect(entries.find((e) => e.path === 'docs/')?.storageKey).toBeNull();
    expect(entries.find((e) => e.path === 'docs/sub/b.pdf')?.storageKey).toBe(
      'key-2',
    );
  });

  it('빈 폴더도 디렉터리 항목으로 남긴다', () => {
    const empty = folder('e', 'empty');

    expect(
      paths(buildZipPlan({ roots: [empty], folders: [empty], files: [] })),
    ).toEqual(['empty/']);
  });

  it('폴더 트리 밖의 파일은 최상위에 둔다', () => {
    const entries = buildZipPlan({
      roots: [],
      folders: [],
      files: [file('1', 'elsewhere', 'a.pdf')],
    });

    expect(paths(entries)).toEqual(['a.pdf']);
  });

  it('같은 디렉터리의 이름 충돌은 번호를 붙여 푼다 (파일끼리, 파일과 폴더 사이)', () => {
    const docs = folder('d', 'docs');
    const clash = folder('c', 'a.pdf', 'd');

    const entries = buildZipPlan({
      roots: [docs],
      folders: [docs, clash],
      files: [
        file('1', 'd', 'a.pdf'),
        file('2', 'd', 'a.pdf'),
        file('3', 'x', 'a.pdf'),
      ],
    });

    const all = paths(entries);
    expect(all).toContain('docs/a.pdf/');
    expect(all).toContain('docs/a (1).pdf');
    expect(all).toContain('docs/a (2).pdf');
    expect(all).toContain('a.pdf');
    expect(new Set(all).size).toBe(all.length);
  });

  it('선택한 폴더끼리 이름이 같아도 겹치지 않는다', () => {
    const a = folder('1', 'docs');
    const b = folder('2', 'docs');

    expect(
      paths(buildZipPlan({ roots: [a, b], folders: [a, b], files: [] })),
    ).toEqual(['docs/', 'docs (1)/']);
  });

  it('경로 구분자·제어문자·상대 경로 이름을 안전하게 바꾼다', () => {
    const odd = folder('1', '../etc');
    const dots = folder('2', '..');

    const entries = buildZipPlan({
      roots: [odd, dots],
      folders: [odd, dots],
      files: [file('f', '1', 'a/b\\c\u0001.txt')],
    });

    for (const { path } of entries) {
      expect(path.replace(/\/$/, '').split('/')).not.toContain('..');
    }
    expect(paths(entries)).toContain('.._etc/a_b_c_.txt');
  });
});
