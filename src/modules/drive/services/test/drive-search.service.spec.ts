import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DriveItemKind } from '../../dto/drive-search-response.dto.js';
import { DriveSearchService } from '../drive-search.service.js';
import type { EmbeddingService } from '../embedding.service.js';

describe('DriveSearchService', () => {
  const dataSource = { query: vi.fn() };
  const embedding = { embed: vi.fn() };
  const service = new DriveSearchService(
    dataSource as unknown as DataSource,
    embedding as unknown as EmbeddingService,
  );

  const row = {
    id: 'item-1',
    folder_id: 'folder-1',
    folder_name: '매출 보고',
    kind: DriveItemKind.FILE,
    name: '분기 매출.pdf',
    mime_type: 'application/pdf',
    size_bytes: '2048',
    url: null,
    summary: '분기별 매출',
    similarity: '0.81',
    created_at: new Date('2026-10-01T00:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    embedding.embed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('폴더를 지정하지 않으면 내 항목 전체에서 유사도 순으로 찾는다', async () => {
    dataSource.query.mockResolvedValueOnce([row]);

    const result = await service.search('user-1', { query: '매출' });

    expect(embedding.embed).toHaveBeenCalledWith('매출');
    const [sql, params] = dataSource.query.mock.calls[0]!;
    expect(sql).toContain('i.owner_id = $1');
    expect(sql).not.toContain('folder_id = $4');
    expect(sql).toContain('ORDER BY i.embedding <=> $2::vector');
    expect(sql).toContain('i.deleted_at IS NULL');
    expect(params).toEqual(['user-1', '[0.1,0.2,0.3]', 20]);
    expect(result.items).toEqual([
      {
        id: 'item-1',
        folderId: 'folder-1',
        folderName: '매출 보고',
        kind: DriveItemKind.FILE,
        name: '분기 매출.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        url: null,
        summary: '분기별 매출',
        similarity: 0.81,
        createdAt: row.created_at,
      },
    ]);
  });

  it('폴더를 지정하면 소유를 확인한 뒤 그 폴더와 하위 폴더 안에서만 찾는다', async () => {
    dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
    dataSource.query.mockResolvedValueOnce([]);

    await service.search('user-1', {
      query: '매출',
      folderId: 'folder-1',
      limit: 5,
    });

    expect(dataSource.query.mock.calls[0]![1]).toEqual(['folder-1', 'user-1']);
    const [sql, params] = dataSource.query.mock.calls[1]!;
    expect(sql).toContain('i.deleted_at IS NULL AND i.folder_id IN (');
    expect(sql).toContain('WITH RECURSIVE subtree');
    expect(params).toEqual(['user-1', '[0.1,0.2,0.3]', 5, 'folder-1']);
  });

  it('내 폴더가 아니면 임베딩 API를 호출하지 않고 404를 던진다', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await expect(
      service.search('user-1', { query: '매출', folderId: 'other-folder' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(embedding.embed).not.toHaveBeenCalled();
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  it('임베딩 실패는 503으로 바꾼다', async () => {
    embedding.embed.mockRejectedValueOnce(new Error('embedding API 500'));

    await expect(
      service.search('user-1', { query: '매출' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
