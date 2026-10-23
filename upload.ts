/**
 * 드라이브 업로드: 파일/링크를 받아 내용을 벡터화하고, 가장 가까운 폴더가 있으면 그 폴더에,
 * 없으면 내용에 맞는 새 폴더를 만들어 저장한다.
 *
 * 지원 입력
 *  - 파일: PDF, PPTX, 텍스트(txt/md/csv/json 등), 이미지 → 오브젝트 스토리지(S3/MinIO)에 업로드
 *  - 링크: 영상 등 외부 URL → 다운로드하지 않고 URL/제목/설명만 저장 (스토리지 업로드 없음)
 *
 * 흐름: 텍스트 추출 → 임베딩 → pgvector 최근접 폴더 검색(코사인 유사도 ≥ 임계값) → 폴더 결정 → 저장
 *
 * 스키마는 src/core/database/migrations(CreateDriveFolders, AddDriveFolderHierarchy)에 있다.
 * Embedder 구현은 EmbeddingService(src/modules/drive/services), ObjectStorage 구현은
 * ObjectStorageService(src/core/storage)를 쓴다.
 */
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';

// ───────────────────────── 타입 ─────────────────────────

export type UploadInput =
  | { kind: 'file'; ownerId: string; fileName: string; mimeType: string; buffer: Buffer }
  | { kind: 'link'; ownerId: string; url: string; title?: string; description?: string };

export interface UploadResult {
  itemId: string;
  folderId: string;
  folderName: string;
  /** true면 이번 업로드로 새 폴더가 만들어졌다. */
  folderCreated: boolean;
  /** 기존 폴더에 배치된 경우 최근접 폴더와의 코사인 유사도 */
  similarity: number | null;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
}

export interface FolderMatch {
  id: string;
  name: string;
  /** 코사인 유사도 (1에 가까울수록 유사) */
  similarity: number;
}

/** DB 접근 계층. 기본 구현은 TypeORM DataSource + pgvector. */
export interface DriveStore {
  /** 같은 owner의 업로드를 직렬화해 동시 업로드 시 폴더가 중복 생성되는 것을 막는다. */
  transaction<T>(ownerId: string, work: (tx: DriveTx) => Promise<T>): Promise<T>;
}

export interface DriveTx {
  findNearestFolder(ownerId: string, vector: number[]): Promise<FolderMatch | null>;
  createFolder(ownerId: string, name: string, vector: number[]): Promise<string>;
  /** 폴더 대표 벡터(centroid, 항목 벡터의 합)에 새 항목을 더한다. */
  addToFolder(folderId: string, vector: number[]): Promise<void>;
  insertItem(item: NewItem): Promise<string>;
  folderNameExists(ownerId: string, name: string): Promise<boolean>;
}

export interface NewItem {
  ownerId: string;
  folderId: string;
  kind: 'FILE' | 'LINK';
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  url: string | null;
  checksumSha256: string | null;
  summary: string;
  embedding: number[];
}

export interface ObjectStorage {
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
}

export interface DriveUploaderOptions {
  store: DriveStore;
  embedder: Embedder;
  storage: ObjectStorage;
  /** 기존 폴더로 인정할 최소 코사인 유사도. 기본 0.55 (임베딩 모델에 맞춰 튜닝 필요) */
  similarityThreshold?: number;
  /** 이미지 설명 생성(예: 비전 LLM). 없으면 파일명만으로 분류한다. */
  describeImage?: (buffer: Buffer, mimeType: string) => Promise<string>;
  /** 새 폴더명 생성(예: LLM). 없으면 제목/키워드 기반으로 만든다. */
  nameFolder?: (context: { title: string; text: string }) => Promise<string>;
}

// ───────────────────────── 상수 ─────────────────────────

const DEFAULT_THRESHOLD = 0.55;
/** 임베딩에 넣을 텍스트 최대 길이 (문자). 모델 토큰 한도 안쪽으로 자른다. */
const MAX_TEXT_CHARS = 6000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FOLDER_NAME = 40;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'html', 'htm', 'rtf',
]);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'have', 'has', 'not',
  'www', 'com', 'http', 'https', 'html', 'pdf', 'pptx', 'img', 'image', 'video', 'file',
  '그리고', '그러나', '때문에', '입니다', '합니다', '있는', '있다', '하는', '대한', '위한', '이다',
]);

// ───────────────────────── 오류 ─────────────────────────

export class UploadError extends Error {
  constructor(
    message: string,
    readonly code: 'UNSUPPORTED' | 'TOO_LARGE' | 'EMPTY' | 'INVALID_URL' | 'EMBEDDING_FAILED',
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

// ───────────────────────── 콘텐츠 분석 ─────────────────────────

type FileCategory = 'pdf' | 'pptx' | 'text' | 'image' | 'other';

function extensionOf(fileName: string): string {
  return extname(fileName).slice(1).toLowerCase();
}

function categorize(fileName: string, mimeType: string): FileCategory {
  const ext = extensionOf(fileName);
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'pptx' || mimeType.includes('presentationml.presentation')) return 'pptx';
  if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'other';
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

/** PPTX는 zip이다. 슬라이드 XML의 <a:t> 텍스트를 슬라이드 순서대로 이어 붙인다. */
async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map((path) => ({ path, no: /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)?.[1] }))
    .filter((s): s is { path: string; no: string } => s.no !== undefined)
    .sort((a, b) => Number(a.no) - Number(b.no));

  const parts: string[] = [];
  for (const { path } of slides) {
    const xml = await zip.file(path)!.async('string');
    for (const m of xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) parts.push(decodeXml(m[1]!));
  }
  return parts.join(' ');
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

/** URL에서 의미 있는 단어만 뽑는다 (제목/설명이 없는 링크의 최소한의 분류 단서). */
function textFromUrl(url: URL): string {
  const words = decodeURIComponent(url.pathname + ' ' + url.searchParams.get('title'))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && w !== 'null');
  return [url.hostname.replace(/^www\./, ''), ...words].join(' ');
}

interface Analyzed {
  title: string;
  text: string;
}

// ───────────────────────── 폴더명 ─────────────────────────

/** 빈도 상위 단어로 폴더명을 만든다. nameFolder 훅이 없을 때의 기본값. */
function heuristicFolderName(title: string, text: string): string {
  const counts = new Map<string, number>();
  for (const w of `${title} ${title} ${text}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w);
  const base = top.length > 0 ? top.join(' ') : title.replace(extname(title), '');
  return sanitizeFolderName(base) || '새 폴더';
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FOLDER_NAME);
}

// ───────────────────────── 업로더 ─────────────────────────

export class DriveUploader {
  private readonly threshold: number;

  constructor(private readonly opts: DriveUploaderOptions) {
    this.threshold = opts.similarityThreshold ?? DEFAULT_THRESHOLD;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    return input.kind === 'file' ? this.uploadFile(input) : this.uploadLink(input);
  }

  private async uploadFile(input: Extract<UploadInput, { kind: 'file' }>): Promise<UploadResult> {
    const { ownerId, fileName, mimeType, buffer } = input;
    if (buffer.length === 0) throw new UploadError('빈 파일입니다.', 'EMPTY');
    if (buffer.length > MAX_FILE_BYTES) throw new UploadError('파일이 너무 큽니다.', 'TOO_LARGE');

    const analyzed = await this.analyzeFile(fileName, mimeType, buffer);
    const embedding = await this.embed(analyzed);

    // 스토리지 업로드는 DB 트랜잭션 밖에서 먼저 한다. DB 실패 시 고아 객체는 정리 작업 대상.
    const storageKey = `drive/${ownerId}/${randomUUID()}${extensionOf(fileName) ? '.' + extensionOf(fileName) : ''}`;
    await this.opts.storage.put(storageKey, buffer, mimeType);

    return this.place(ownerId, analyzed, embedding, {
      kind: 'FILE',
      name: fileName,
      mimeType,
      sizeBytes: buffer.length,
      storageKey,
      url: null,
      checksumSha256: createHash('sha256').update(buffer).digest('hex'),
    });
  }

  /** 링크는 내려받지 않는다. 제공된 제목/설명과 URL 자체로만 분류한다. */
  private async uploadLink(input: Extract<UploadInput, { kind: 'link' }>): Promise<UploadResult> {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new UploadError('올바른 URL이 아닙니다.', 'INVALID_URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new UploadError('http/https 링크만 지원합니다.', 'INVALID_URL');
    }

    const title = input.title?.trim() || url.hostname.replace(/^www\./, '');
    const text = normalizeText([input.description ?? '', textFromUrl(url)].join(' '));
    const analyzed: Analyzed = { title, text };
    const embedding = await this.embed(analyzed);

    return this.place(input.ownerId, analyzed, embedding, {
      kind: 'LINK',
      name: title,
      mimeType: null,
      sizeBytes: null,
      storageKey: null,
      url: url.toString(),
      checksumSha256: null,
    });
  }

  private async analyzeFile(fileName: string, mimeType: string, buffer: Buffer): Promise<Analyzed> {
    const category = categorize(fileName, mimeType);
    let text = '';
    try {
      switch (category) {
        case 'pdf':
          text = await extractPdfText(buffer);
          break;
        case 'pptx':
          text = await extractPptxText(buffer);
          break;
        case 'text':
          text = buffer.toString('utf8');
          break;
        case 'image':
          text = this.opts.describeImage ? await this.opts.describeImage(buffer, mimeType) : '';
          break;
        case 'other':
          break;
      }
    } catch {
      // 손상/암호화 파일 등 추출 실패 시 파일명만으로 분류한다. 업로드 자체는 막지 않는다.
      text = '';
    }
    const baseName = fileName.replace(extname(fileName), '').replace(/[_\-.]+/g, ' ');
    return { title: baseName, text: normalizeText(text) };
  }

  private async embed({ title, text }: Analyzed): Promise<number[]> {
    const input = `${title}\n${text}`.trim();
    if (!input) throw new UploadError('분류할 내용을 찾을 수 없습니다.', 'EMPTY');
    try {
      return normalizeVector(await this.opts.embedder.embed(input));
    } catch (e) {
      throw new UploadError(`임베딩 생성 실패: ${(e as Error).message}`, 'EMBEDDING_FAILED');
    }
  }

  private async place(
    ownerId: string,
    analyzed: Analyzed,
    embedding: number[],
    meta: Pick<NewItem, 'kind' | 'name' | 'mimeType' | 'sizeBytes' | 'storageKey' | 'url' | 'checksumSha256'>,
  ): Promise<UploadResult> {
    // 새 폴더 이름은 외부 호출(LLM)이 필요할 수 있으니 트랜잭션(락) 밖에서 미리 정한다.
    const candidateName = sanitizeFolderName(
      (await this.opts.nameFolder?.(analyzed).catch(() => '')) || '',
    ) || heuristicFolderName(analyzed.title, analyzed.text);

    return this.opts.store.transaction(ownerId, async (tx) => {
      const nearest = await tx.findNearestFolder(ownerId, embedding);
      const reuse = nearest !== null && nearest.similarity >= this.threshold;

      let folderId: string;
      let folderName: string;
      if (reuse) {
        folderId = nearest.id;
        folderName = nearest.name;
        await tx.addToFolder(folderId, embedding);
      } else {
        folderName = await this.uniqueName(tx, ownerId, candidateName);
        folderId = await tx.createFolder(ownerId, folderName, embedding);
      }

      const itemId = await tx.insertItem({
        ownerId,
        folderId,
        summary: analyzed.text.slice(0, 500),
        embedding,
        ...meta,
      });

      return {
        itemId,
        folderId,
        folderName,
        folderCreated: !reuse,
        similarity: reuse ? nearest.similarity : null,
      };
    });
  }

  private async uniqueName(tx: DriveTx, ownerId: string, base: string): Promise<string> {
    if (!(await tx.folderNameExists(ownerId, base))) return base;
    for (let n = 2; n < 100; n++) {
      const name = `${base} (${n})`;
      if (!(await tx.folderNameExists(ownerId, name))) return name;
    }
    return `${base} (${randomUUID().slice(0, 6)})`;
  }
}

function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

// ───────────────────────── 기본 구현: DB (TypeORM + pgvector) ─────────────────────────

/** TypeORM DataSource와 호환되는 최소 인터페이스 (테스트에서 대체하기 쉽게 분리). */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<any>;
}
export interface SqlSource extends SqlRunner {
  transaction<T>(work: (runner: { query: SqlRunner['query'] }) => Promise<T>): Promise<T>;
}

const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`;

export class PgVectorDriveStore implements DriveStore {
  /** `dataSource.manager`를 넘긴다. (EntityManager.transaction / query 사용) */
  constructor(private readonly manager: SqlSource) {}

  transaction<T>(ownerId: string, work: (tx: DriveTx) => Promise<T>): Promise<T> {
    return this.manager.transaction(async (m) => {
      // owner 단위 advisory lock: 트랜잭션 종료 시 자동 해제
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`drive:${ownerId}`]);
      return work(new PgTx(m));
    });
  }
}

class PgTx implements DriveTx {
  constructor(private readonly m: { query: SqlRunner['query'] }) {}

  async findNearestFolder(ownerId: string, vector: number[]): Promise<FolderMatch | null> {
    const rows = await this.m.query(
      `SELECT id, name, 1 - (centroid <=> $2::vector) AS similarity
         FROM drive_folders WHERE owner_id = $1 AND centroid IS NOT NULL AND deleted_at IS NULL
        ORDER BY centroid <=> $2::vector LIMIT 1`,
      [ownerId, toVectorLiteral(vector)],
    );
    return rows[0] ? { id: rows[0].id, name: rows[0].name, similarity: Number(rows[0].similarity) } : null;
  }

  async createFolder(ownerId: string, name: string, vector: number[]): Promise<string> {
    const rows = await this.m.query(
      `INSERT INTO drive_folders (owner_id, name, centroid, item_count)
       VALUES ($1, $2, $3::vector, 1) RETURNING id`,
      [ownerId, name, toVectorLiteral(vector)],
    );
    return rows[0].id;
  }

  async addToFolder(folderId: string, vector: number[]): Promise<void> {
    // pgvector는 벡터×스칼라 연산이 없다. 코사인 거리는 크기와 무관하므로 합계 벡터를 그대로 대표값으로 쓴다.
    await this.m.query(
      `UPDATE drive_folders
          SET centroid = COALESCE(centroid + $2::vector, $2::vector),
              item_count = item_count + 1,
              updated_at = now()
        WHERE id = $1`,
      [folderId, toVectorLiteral(vector)],
    );
  }

  async insertItem(i: NewItem): Promise<string> {
    const rows = await this.m.query(
      `INSERT INTO drive_items
         (owner_id, folder_id, kind, name, mime_type, size_bytes, storage_key, url,
          checksum_sha256, summary, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector) RETURNING id`,
      [
        i.ownerId, i.folderId, i.kind, i.name, i.mimeType, i.sizeBytes, i.storageKey, i.url,
        i.checksumSha256, i.summary, toVectorLiteral(i.embedding),
      ],
    );
    return rows[0].id;
  }

  async folderNameExists(ownerId: string, name: string): Promise<boolean> {
    const rows = await this.m.query(
      'SELECT 1 FROM drive_folders WHERE owner_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1',
      [ownerId, name],
    );
    return rows.length > 0;
  }
}
