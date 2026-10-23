import { resolveUniqueName } from './unique-name.util.js';

describe('resolveUniqueName', () => {
  const file = { keepExtension: true };
  const folder = { keepExtension: false };

  it('겹치지 않으면 원래 이름을 그대로 쓴다', () => {
    expect(resolveUniqueName('a.pdf', new Set(['b.pdf']), file)).toBe('a.pdf');
  });

  it('파일은 확장자 앞에 번호를 붙인다', () => {
    expect(resolveUniqueName('a.pdf', new Set(['a.pdf']), file)).toBe(
      'a (1).pdf',
    );
  });

  it('이미 쓰인 번호는 건너뛴다', () => {
    const taken = new Set(['a.pdf', 'a (1).pdf', 'a (2).pdf']);
    expect(resolveUniqueName('a.pdf', taken, file)).toBe('a (3).pdf');
  });

  it('여러 점이 있으면 마지막 확장자 앞에 붙인다', () => {
    expect(
      resolveUniqueName('backup.tar.gz', new Set(['backup.tar.gz']), file),
    ).toBe('backup.tar (1).gz');
  });

  it('확장자가 없거나 숨김 파일이면 끝에 붙인다', () => {
    expect(resolveUniqueName('README', new Set(['README']), file)).toBe(
      'README (1)',
    );
    expect(resolveUniqueName('.env', new Set(['.env']), file)).toBe('.env (1)');
  });

  it('폴더는 점이 있어도 끝에 붙인다', () => {
    expect(resolveUniqueName('v1.2', new Set(['v1.2']), folder)).toBe(
      'v1.2 (1)',
    );
  });
});
