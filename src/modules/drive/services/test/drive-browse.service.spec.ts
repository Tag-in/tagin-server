import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DriveItemKind } from '../../dto/drive-search-response.dto.js';
import { DriveBrowseService } from '../drive-browse.service.js';

describe('DriveBrowseService', () => {
  const dataSource = { query: vi.fn() };
  const service = new DriveBrowseService(dataSource as unknown as DataSource);

  const at = new Date('2026-10-01T00:00:00Z');
  const folderRow = (id: string, name: string, parentId: string | null) => ({
    id,
    name,
    parent_id: parentId,
    item_count: 2,
    created_at: at,
    updated_at: at,
  });

  beforeEach(() => vi.clearAllMocks());

  it('내 폴더 전체를 휴지통을 빼고 이름 순으로 돌려준다', async () => {
    dataSource.query.mockResolvedValueOnce([
      folderRow('f1', '매출', null),
      folderRow('f2', '분기', 'f1'),
    ]);

    const result = await service.listFolders('user-1');

    const [sql, params] = dataSource.query.mock.calls[0]!;
    expect(sql).toContain('owner_id = $1 AND deleted_at IS NULL');
    expect(params).toEqual(['user-1']);
    expect(result.folders).toEqual([
      {
        id: 'f1',
        name: '매출',
        parentId: null,
        itemCount: 2,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'f2',
        name: '분기',
        parentId: 'f1',
        itemCount: 2,
        createdAt: at,
        updatedAt: at,
      },
    ]);
  });

  it('폴더 내용과 최상위부터의 경로를 돌려준다', async () => {
    dataSource.query
      .mockResolvedValueOnce([
        { ...folderRow('f1', '매출', null), depth: 1 },
        { ...folderRow('f2', '분기', 'f1'), depth: 0 },
      ])
      .mockResolvedValueOnce([folderRow('f3', '1분기', 'f2')])
      .mockResolvedValueOnce([
        {
          id: 'i1',
          folder_id: 'f2',
          kind: DriveItemKind.FILE,
          name: '보고서.pdf',
          mime_type: 'application/pdf',
          size_bytes: '2048',
          url: null,
          summary: '분기 매출',
          created_at: at,
        },
      ]);

    const result = await service.getContents('user-1', 'f2');

    expect(dataSource.query.mock.calls[0]![1]).toEqual(['f2', 'user-1']);
    expect(dataSource.query.mock.calls[1]![1]).toEqual(['user-1', 'f2']);
    expect(dataSource.query.mock.calls[2]![0]).toContain('deleted_at IS NULL');
    expect(result.folder.id).toBe('f2');
    expect(result.path).toEqual([
      { id: 'f1', name: '매출' },
      { id: 'f2', name: '분기' },
    ]);
    expect(result.folders.map((f) => f.id)).toEqual(['f3']);
    expect(result.items).toEqual([
      {
        id: 'i1',
        folderId: 'f2',
        kind: DriveItemKind.FILE,
        name: '보고서.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        url: null,
        summary: '분기 매출',
        createdAt: at,
      },
    ]);
  });

  it('내 폴더가 아니거나 휴지통에 있으면 404를 던진다', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await expect(service.getContents('user-1', 'f9')).rejects.toThrow(
      NotFoundException,
    );
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });
});
