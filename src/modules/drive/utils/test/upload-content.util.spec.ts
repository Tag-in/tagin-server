import JSZip from 'jszip';
import {
  analyzeFile,
  analyzeLink,
  DEFAULT_FOLDER_NAME,
  folderNameFor,
  normalizeVector,
  storageKeyFor,
} from '../upload-content.util.js';

const text = (s: string) => Buffer.from(s, 'utf8');

describe('analyzeFile', () => {
  it('텍스트 파일은 본문을 읽고 파일명을 제목으로 쓴다', async () => {
    const result = await analyzeFile(
      '2025_예산-계획.txt',
      'text/plain',
      text('  2025년\n예산과   매출 계획 '),
    );
    expect(result).toEqual({
      title: '2025 예산 계획',
      text: '2025년 예산과 매출 계획',
    });
  });

  it('PPTX는 슬라이드 순서대로 텍스트를 뽑는다', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide2.xml',
      '<p:sld><a:t>두 번째 &amp; 끝</a:t></p:sld>',
    );
    zip.file('ppt/slides/slide1.xml', '<p:sld><a:t>요리 레시피</a:t></p:sld>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await analyzeFile(
      'deck.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer,
    );
    expect(result.text).toBe('요리 레시피 두 번째 & 끝');
  });

  it('손상된 파일과 지원하지 않는 형식은 파일명만으로 분류한다', async () => {
    await expect(
      analyzeFile('broken.pdf', 'application/pdf', text('not a pdf')),
    ).resolves.toEqual({ title: 'broken', text: '' });
    await expect(
      analyzeFile('사진_01.png', 'image/png', text('binary')),
    ).resolves.toEqual({ title: '사진 01', text: '' });
  });
});

describe('analyzeLink', () => {
  it('제목이 없으면 도메인을 제목으로 쓰고 URL 단어를 본문에 넣는다', () => {
    const result = analyzeLink(
      new URL('https://www.youtube.com/watch/kimchi-recipe?v=abc'),
    );
    expect(result.title).toBe('youtube.com');
    expect(result.text).toBe('youtube.com watch kimchi recipe');
  });

  it('제목과 설명이 있으면 함께 쓴다', () => {
    const result = analyzeLink(
      new URL('https://example.com/a'),
      ' 김치찌개 레시피 ',
      '맛있는 요리',
    );
    expect(result).toEqual({
      title: '김치찌개 레시피',
      text: '맛있는 요리 example.com',
    });
  });
});

describe('folderNameFor', () => {
  it('제목과 본문에서 자주 나온 단어로 이름을 만든다', () => {
    expect(
      folderNameFor({ title: '분기 매출', text: '매출 보고 매출 분기 the' }),
    ).toBe('매출 분기');
  });

  it('쓸 단어가 없으면 기본 이름을 쓴다', () => {
    expect(folderNameFor({ title: '', text: '2025 the and' })).toBe(
      DEFAULT_FOLDER_NAME,
    );
  });

  it('경로 문자를 지우고 40자로 자른다', () => {
    const name = folderNameFor({ title: 'a/b:c', text: '' });
    expect(name).not.toMatch(/[/:]/);
    expect(folderNameFor({ title: 'x'.repeat(80), text: '' })).toHaveLength(40);
  });
});

describe('normalizeVector', () => {
  it('단위 벡터로 만들고 0 벡터는 그대로 둔다', () => {
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
    expect(normalizeVector([0, 0])).toEqual([0, 0]);
  });
});

describe('storageKeyFor', () => {
  it('확장자를 소문자로 붙이고 없으면 생략한다', () => {
    expect(storageKeyFor('u1', 'id1', '보고서.PDF')).toBe('drive/u1/id1.pdf');
    expect(storageKeyFor('u1', 'id1', 'README')).toBe('drive/u1/id1');
  });
});
