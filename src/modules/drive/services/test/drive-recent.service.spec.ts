import type { DataSource } from 'typeorm';
import { DriveItemKind } from '../../dto/drive-search-response.dto.js';
import { DriveRecentService } from '../drive-recent.service.js';

describe('DriveRecentService', () => {
  const dataSource = { query: vi.fn() };
  const service = new DriveRecentService(dataSource as unknown as DataSource);
  const at = new Date('2026-10-01T00:00:00Z');

  beforeEach(() => vi.clearAllMocks());

  it('휴지통을 뺀 내 항목을 최근 순으로 폴더 이름과 함께 돌려준다', async () => {
    dataSource.query.mockResolvedValueOnce([
      {
        id: 'i1',
        folder_id: 'f1',
        folder_name: '매출',
        kind: DriveItemKind.FILE,
        name: '보고서.pdf',
        mime_type: 'application/pdf',
        size_bytes: '2048',
        url: null,
        summary: null,
        starred_at: null,
        created_at: at,
      },
    ]);

    const result = await service.list('user-1', 5);

    const [sql, params] = dataSource.query.mock.calls[0]!;
    expect(sql).toContain('i.owner_id = $1 AND i.deleted_at IS NULL');
    expect(sql).toContain('ORDER BY i.created_at DESC');
    expect(params).toEqual(['user-1', 5]);
    expect(result.items).toEqual([
      {
        id: 'i1',
        folderId: 'f1',
        folderName: '매출',
        kind: DriveItemKind.FILE,
        name: '보고서.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        url: null,
        summary: null,
        starredAt: null,
        createdAt: at,
      },
    ]);
  });

  it('limit을 생략하면 기본값 20을 쓴다', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await service.list('user-1');

    expect(dataSource.query.mock.calls[0]![1]).toEqual(['user-1', 20]);
  });
});
