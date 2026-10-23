import JSZip from 'jszip';
import {
  DriveUploader,
  UploadError,
  type DriveStore,
  type DriveTx,
  type Embedder,
  type NewItem,
} from './upload.js';

/** 키워드 포함 여부로 3차원 벡터를 만드는 가짜 임베더: [재무, 요리, 기타] */
const embedder: Embedder = {
  async embed(text) {
    const t = text.toLowerCase();
    return [/예산|매출|finance/.test(t) ? 1 : 0, /레시피|요리|recipe/.test(t) ? 1 : 0, 0.05];
  },
};

function fakeStore() {
  const folders: { id: string; name: string; centroid: number[] }[] = [];
  const items: NewItem[] = [];
  const cos = (a: number[], b: number[]) => {
    const d = a.reduce((s, x, i) => s + x * b[i]!, 0);
    return d / (Math.hypot(...a) * Math.hypot(...b));
  };
  const tx: DriveTx = {
    async findNearestFolder(_o, v) {
      const best = folders
        .map((f) => ({ id: f.id, name: f.name, similarity: cos(f.centroid, v) }))
        .sort((a, b) => b.similarity - a.similarity)[0];
      return best ?? null;
    },
    async createFolder(_o, name, v) {
      folders.push({ id: `f${folders.length + 1}`, name, centroid: v });
      return `f${folders.length}`;
    },
    async addToFolder() {},
    async insertItem(i) {
      items.push(i);
      return `i${items.length}`;
    },
    async folderNameExists(_o, name) {
      return folders.some((f) => f.name === name);
    },
  };
  const store: DriveStore = { transaction: (_o, work) => work(tx) };
  return { store, folders, items };
}

function setup() {
  const { store, folders, items } = fakeStore();
  const put = vi.fn().mockResolvedValue(undefined);
  const uploader = new DriveUploader({ store, embedder, storage: { put } });
  return { uploader, folders, items, put };
}

const text = (s: string) => Buffer.from(s, 'utf8');

describe('DriveUploader', () => {
  it('첫 업로드는 새 폴더를 만들고, 비슷한 파일은 같은 폴더에 넣는다', async () => {
    const { uploader, folders, put } = setup();

    const a = await uploader.upload({
      kind: 'file', ownerId: 'u1', fileName: '2025_예산.txt', mimeType: 'text/plain',
      buffer: text('2025년 예산과 매출 계획'),
    });
    const b = await uploader.upload({
      kind: 'file', ownerId: 'u1', fileName: '분기 매출.txt', mimeType: 'text/plain',
      buffer: text('분기별 매출 보고'),
    });

    expect(a.folderCreated).toBe(true);
    expect(b.folderCreated).toBe(false);
    expect(b.folderId).toBe(a.folderId);
    expect(folders).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('다른 주제는 새 폴더를 만든다', async () => {
    const { uploader, folders } = setup();
    await uploader.upload({
      kind: 'file', ownerId: 'u1', fileName: 'a.txt', mimeType: 'text/plain', buffer: text('예산 매출'),
    });
    const r = await uploader.upload({
      kind: 'file', ownerId: 'u1', fileName: 'b.txt', mimeType: 'text/plain', buffer: text('김치찌개 레시피 요리'),
    });
    expect(r.folderCreated).toBe(true);
    expect(folders).toHaveLength(2);
  });

  it('PPTX 슬라이드 텍스트를 추출해 분류에 쓴다', async () => {
    const { uploader, items } = setup();
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<p:sld><a:t>요리 레시피 발표</a:t></p:sld>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await uploader.upload({
      kind: 'file', ownerId: 'u1', fileName: 'deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer,
    });
    expect(items[0]!.summary).toContain('레시피');
  });

  it('링크는 스토리지에 올리지 않고 URL만 저장한다', async () => {
    const { uploader, items, put } = setup();
    const r = await uploader.upload({
      kind: 'link', ownerId: 'u1', url: 'https://youtube.com/watch?v=abc',
      title: '김치찌개 레시피 영상',
    });
    expect(put).not.toHaveBeenCalled();
    expect(items[0]).toMatchObject({ kind: 'LINK', storageKey: null, url: 'https://youtube.com/watch?v=abc' });
    expect(r.folderCreated).toBe(true);
  });

  it('http(s)가 아닌 링크와 빈 파일은 거부한다', async () => {
    const { uploader } = setup();
    await expect(
      uploader.upload({ kind: 'link', ownerId: 'u1', url: 'file:///etc/passwd' }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(
      uploader.upload({ kind: 'file', ownerId: 'u1', fileName: 'a.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) }),
    ).rejects.toBeInstanceOf(UploadError);
  });

  it('폴더명이 겹치면 번호를 붙인다', async () => {
    const { uploader, folders } = setup();
    const nameFolder = async () => '자료';
    const u = new DriveUploader({ ...(uploader as any).opts, nameFolder });
    await u.upload({ kind: 'file', ownerId: 'u1', fileName: 'a.txt', mimeType: 'text/plain', buffer: text('예산') });
    await u.upload({ kind: 'file', ownerId: 'u1', fileName: 'b.txt', mimeType: 'text/plain', buffer: text('레시피') });
    expect(folders.map((f) => f.name)).toEqual(['자료', '자료 (2)']);
  });
});
