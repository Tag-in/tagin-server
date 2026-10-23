import { extname } from 'node:path';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';

/**
 * 업로드한 파일·링크에서 분류(임베딩)에 쓸 제목과 본문을 뽑고, 새 폴더 이름을 정한다.
 * 지원: PDF, PPTX, 텍스트(txt/md/csv/json 등). 이미지와 그 밖의 형식은 파일명만으로 분류한다.
 */

/** 업로드 파일 최대 크기 (메모리에 올려 분석하므로 너무 크게 두지 않는다) */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** 임베딩에 넣을 텍스트 최대 길이 (문자). 모델 토큰 한도 안쪽으로 자른다. */
export const MAX_TEXT_CHARS = 6000;
/** drive_items.summary에 저장할 본문 길이 */
export const SUMMARY_CHARS = 500;
const MAX_FOLDER_NAME = 40;
export const DEFAULT_FOLDER_NAME = '새 폴더';

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'log',
  'html',
  'htm',
  'rtf',
]);

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'have',
  'has',
  'not',
  'www',
  'com',
  'http',
  'https',
  'html',
  'pdf',
  'pptx',
  'img',
  'image',
  'video',
  'file',
  '그리고',
  '그러나',
  '때문에',
  '입니다',
  '합니다',
  '있는',
  '있다',
  '하는',
  '대한',
  '위한',
  '이다',
]);

export interface AnalyzedContent {
  title: string;
  text: string;
}

type FileCategory = 'pdf' | 'pptx' | 'text' | 'other';

const extensionOf = (fileName: string) =>
  extname(fileName).slice(1).toLowerCase();

const categorize = (fileName: string, mimeType: string): FileCategory => {
  const ext = extensionOf(fileName);
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'pptx' || mimeType.includes('presentationml.presentation'))
    return 'pptx';
  if (mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'other';
};

const normalizeText = (s: string) =>
  s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

/** PPTX는 zip이다. 슬라이드 XML의 <a:t> 텍스트를 슬라이드 순서대로 이어 붙인다. */
async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map((path) => ({
      path,
      no: /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)?.[1],
    }))
    .filter((s): s is { path: string; no: string } => s.no !== undefined)
    .sort((a, b) => Number(a.no) - Number(b.no));

  const parts: string[] = [];
  for (const { path } of slides) {
    const xml = await zip.file(path)!.async('string');
    for (const m of xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g))
      parts.push(decodeXml(m[1]!));
  }
  return parts.join(' ');
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** 파일명(확장자 제외)과 본문 텍스트. 추출에 실패하면(손상·암호화 등) 파일명만으로 분류한다. */
export async function analyzeFile(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<AnalyzedContent> {
  let text = '';
  try {
    switch (categorize(fileName, mimeType)) {
      case 'pdf':
        text = await extractPdfText(buffer);
        break;
      case 'pptx':
        text = await extractPptxText(buffer);
        break;
      case 'text':
        text = buffer.toString('utf8');
        break;
      case 'other':
        break;
    }
  } catch {
    text = '';
  }
  const title = fileName
    .replace(extname(fileName), '')
    .replace(/[_\-.]+/g, ' ')
    .trim();
  return { title, text: normalizeText(text) };
}

/** 링크는 내려받지 않는다. 제공된 제목·설명과 URL 자체의 단어로만 분류한다. */
export function analyzeLink(
  url: URL,
  title?: string,
  description?: string,
): AnalyzedContent {
  const words = decodeURIComponent(
    `${url.pathname} ${url.searchParams.get('title') ?? ''}`,
  )
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  const host = url.hostname.replace(/^www\./, '');
  return {
    title: title?.trim() || host,
    text: normalizeText([description ?? '', host, ...words].join(' ')),
  };
}

/** 빈도 상위 단어로 새 폴더 이름을 만든다. */
export function folderNameFor({ title, text }: AnalyzedContent): string {
  const counts = new Map<string, number>();
  for (const w of `${title} ${title} ${text}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w);
  return sanitizeFolderName(top.join(' ') || title) || DEFAULT_FOLDER_NAME;
}

const sanitizeFolderName = (name: string) =>
  name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FOLDER_NAME);

/** 코사인 유사도만 쓰므로 단위 벡터로 맞춰 저장한다. */
export const normalizeVector = (v: number[]): number[] => {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
};

export const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`;

/** 스토리지 키: drive/<owner>/<uuid>[.ext] */
export const storageKeyFor = (
  ownerId: string,
  id: string,
  fileName: string,
) => {
  const ext = extensionOf(fileName);
  return `drive/${ownerId}/${id}${ext ? `.${ext}` : ''}`;
};
