import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from '../../users/services/users.service.js';
import type { DriveStorageResponseDto } from '../dto/drive-storage.dto.js';

interface UsageRow {
  // pg는 bigint 합을 문자열로 돌려준다.
  live_bytes: string;
  trash_bytes: string;
  item_count: number;
}

/**
 * 저장공간 사용량. users.storage_used_bytes는 아직 업로드·삭제에서 갱신하지 않으므로(용량 정책 미확정)
 * drive_items의 size_bytes를 그때그때 합산한다.
 */
@Injectable()
export class DriveStorageService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
  ) {}

  async getUsage(userId: string): Promise<DriveStorageResponseDto> {
    const [user, [usage]] = await Promise.all([
      this.users.findById(userId),
      this.dataSource.query<UsageRow[]>(
        `SELECT COALESCE(sum(size_bytes) FILTER (WHERE deleted_at IS NULL), 0)::text AS live_bytes,
                COALESCE(sum(size_bytes) FILTER (WHERE deleted_at IS NOT NULL), 0)::text AS trash_bytes,
                count(*) FILTER (WHERE deleted_at IS NULL)::int AS item_count
           FROM drive_items WHERE owner_id = $1`,
        [userId],
      ),
    ]);
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    const trashBytes = Number(usage.trash_bytes);
    return {
      usedBytes: Number(usage.live_bytes) + trashBytes,
      trashBytes,
      limitBytes: user.storageLimitBytes,
      itemCount: usage.item_count,
    };
  }
}
