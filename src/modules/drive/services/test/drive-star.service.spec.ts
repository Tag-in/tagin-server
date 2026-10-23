import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DriveStarService } from '../drive-star.service.js';

describe('DriveStarService', () => {
  const query = vi.fn();
  const dataSource = {
    query,
    transaction: vi.fn((run: (em: { query: typeof query }) => unknown) =>
      run({ query }),
    ),
  };
  const service = new DriveStarService(dataSource as unknown as DataSource);
  const at = new Date('2026-10-01T00:00:00Z');

  beforeEach(() => vi.clearAllMocks());

  it('항목과 폴더에 중요 표시를 하고 개수를 돌려준다', async () => {
    query
      .mockResolvedValueOnce([{ id: 'i1' }, { id: 'i2' }])
      .mockResolvedValueOnce([{ id: 'f1' }]);

    const result = await service.setStarred(
      'user-1',
      { itemIds: ['i1', 'i2'], folderIds: ['f1'] },
      true,
    );

    expect(result).toEqual({ itemCount: 2, folderCount: 1 });
    const [itemSql, itemParams] = query.mock.calls[0]!;
    expect(itemSql).toContain('UPDATE drive_items SET starred_at');
    expect(itemSql).toContain('deleted_at IS NULL');
    expect(itemParams).toEqual([['i1', 'i2'], 'user-1', true]);
    expect(query.mock.calls[1]![0]).toContain(
      'UPDATE drive_folders SET starred_at',
    );
    expect(query.mock.calls[1]![1]).toEqual([['f1'], 'user-1', true]);
  });

  it('해제하면 starred_at을 null로 돌린다 (파라미터 false)', async () => {
    query.mockResolvedValueOnce([{ id: 'i1' }]);

    await service.setStarred('user-1', { itemIds: ['i1'] }, false);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![1]).toEqual([['i1'], 'user-1', false]);
  });

  it('없는 항목이 있으면 404를 던진다 (트랜잭션이 롤백된다)', async () => {
    query.mockResolvedValueOnce([{ id: 'i1' }]);

    await expect(
      service.setStarred('user-1', { itemIds: ['i1', 'i9'] }, true),
    ).rejects.toThrow(NotFoundException);
  });

  it('대상을 지정하지 않으면 400이고 DB를 건드리지 않는다', () => {
    expect(() => service.setStarred('user-1', {}, true)).toThrow(
      BadRequestException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('중요 표시한 폴더와 항목을 휴지통을 빼고 돌려준다', async () => {
    query
      .mockResolvedValueOnce([
        {
          id: 'f1',
          name: '매출',
          parent_id: null,
          item_count: 1,
          starred_at: at,
          created_at: at,
          updated_at: at,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'i1',
          folder_id: 'f1',
          folder_name: '매출',
          kind: 'LINK',
          name: '참고 링크',
          mime_type: null,
          size_bytes: null,
          url: 'https://example.com',
          summary: null,
          starred_at: at,
          created_at: at,
        },
      ]);

    const result = await service.list('user-1');

    expect(query.mock.calls[0]![0]).toContain(
      'starred_at IS NOT NULL AND deleted_at IS NULL',
    );
    expect(query.mock.calls[1]![0]).toContain(
      'i.starred_at IS NOT NULL AND i.deleted_at IS NULL',
    );
    expect(result.folders).toEqual([
      {
        id: 'f1',
        name: '매출',
        parentId: null,
        itemCount: 1,
        starredAt: at,
        createdAt: at,
        updatedAt: at,
      },
    ]);
    expect(result.items[0]).toMatchObject({
      id: 'i1',
      folderName: '매출',
      url: 'https://example.com',
      starredAt: at,
    });
  });
});
