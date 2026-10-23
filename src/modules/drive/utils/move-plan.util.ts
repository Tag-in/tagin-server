import { MoveConflictPolicy } from '../dto/move-drive.dto.js';
import {
  MoveEntryType,
  MoveResultDto,
  MoveStatus,
} from '../dto/move-drive-response.dto.js';
import { resolveUniqueName } from './unique-name.util.js';

export interface MovableEntry {
  id: string;
  name: string;
  /** 이미 대상 폴더에 있는지 */
  inTarget: boolean;
}

/** 실제로 반영할 이동. name은 이동 후 이름(충돌로 바뀌지 않았으면 기존 이름) */
export interface PlannedMove {
  id: string;
  name: string;
}

/**
 * 충돌 정책에 따라 항목별 결과와 반영할 이동을 계산한다.
 * occupied(대상 폴더에 이미 있는 이름)는 배정한 이름을 더하며 갱신되므로, 같이 이동하는 항목끼리의 충돌도 잡는다.
 */
export const planMoves = (
  type: MoveEntryType,
  entries: MovableEntry[],
  occupied: Set<string>,
  policy: MoveConflictPolicy,
): { results: MoveResultDto[]; moves: PlannedMove[] } => {
  const results: MoveResultDto[] = [];
  const moves: PlannedMove[] = [];
  const result = (
    { id, name }: MovableEntry,
    status: MoveStatus,
    renamedTo: string | null = null,
  ) => results.push({ type, id, name, status, renamedTo });

  for (const entry of entries) {
    if (entry.inTarget) {
      result(entry, MoveStatus.UNCHANGED);
    } else if (!occupied.has(entry.name)) {
      occupied.add(entry.name);
      moves.push({ id: entry.id, name: entry.name });
      result(entry, MoveStatus.MOVED);
    } else if (policy === MoveConflictPolicy.SKIP) {
      result(entry, MoveStatus.SKIPPED);
    } else if (policy === MoveConflictPolicy.RENAME) {
      const name = resolveUniqueName(entry.name, occupied, {
        keepExtension: type === MoveEntryType.ITEM,
      });
      occupied.add(name);
      moves.push({ id: entry.id, name });
      result(entry, MoveStatus.MOVED, name);
    } else {
      result(entry, MoveStatus.CONFLICT);
    }
  }
  return { results, moves };
};
