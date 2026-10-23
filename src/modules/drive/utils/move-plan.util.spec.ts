import { MoveConflictPolicy } from '../dto/move-drive.dto.js';
import { MoveEntryType, MoveStatus } from '../dto/move-drive-response.dto.js';
import { planMoves } from './move-plan.util.js';

const entry = (id: string, name: string, inTarget = false) => ({
  id,
  name,
  inTarget,
});
const plan = (
  entries: ReturnType<typeof entry>[],
  occupied: string[],
  policy: MoveConflictPolicy,
  type = MoveEntryType.ITEM,
) => planMoves(type, entries, new Set(occupied), policy);

describe('planMoves', () => {
  it('이름이 겹치지 않으면 모두 이동한다', () => {
    const { results, moves } = plan(
      [entry('1', 'a.pdf'), entry('2', 'b.pdf')],
      [],
      MoveConflictPolicy.FAIL,
    );

    expect(results.map((r) => r.status)).toEqual([
      MoveStatus.MOVED,
      MoveStatus.MOVED,
    ]);
    expect(moves).toEqual([
      { id: '1', name: 'a.pdf' },
      { id: '2', name: 'b.pdf' },
    ]);
  });

  it('이미 대상에 있는 항목은 UNCHANGED로 두고 이동하지 않는다', () => {
    const { results, moves } = plan(
      [entry('1', 'a.pdf', true)],
      ['a.pdf'],
      MoveConflictPolicy.FAIL,
    );

    expect(results[0].status).toBe(MoveStatus.UNCHANGED);
    expect(moves).toEqual([]);
  });

  it('FAIL: 충돌을 CONFLICT로 표시하고 이동 목록에서 뺀다', () => {
    const { results, moves } = plan(
      [entry('1', 'a.pdf')],
      ['a.pdf'],
      MoveConflictPolicy.FAIL,
    );

    expect(results[0].status).toBe(MoveStatus.CONFLICT);
    expect(moves).toEqual([]);
  });

  it('SKIP: 충돌 항목만 건너뛴다', () => {
    const { results, moves } = plan(
      [entry('1', 'a.pdf'), entry('2', 'b.pdf')],
      ['a.pdf'],
      MoveConflictPolicy.SKIP,
    );

    expect(results.map((r) => r.status)).toEqual([
      MoveStatus.SKIPPED,
      MoveStatus.MOVED,
    ]);
    expect(moves).toEqual([{ id: '2', name: 'b.pdf' }]);
  });

  it('RENAME: 번호를 붙여 이동하고 새 이름을 알려준다', () => {
    const { results, moves } = plan(
      [entry('1', 'a.pdf')],
      ['a.pdf'],
      MoveConflictPolicy.RENAME,
    );

    expect(results[0]).toEqual(
      expect.objectContaining({
        status: MoveStatus.MOVED,
        name: 'a.pdf',
        renamedTo: 'a (1).pdf',
      }),
    );
    expect(moves).toEqual([{ id: '1', name: 'a (1).pdf' }]);
  });

  it('RENAME: 같이 이동하는 같은 이름끼리도 서로 다른 이름을 받는다', () => {
    const { moves } = plan(
      [entry('1', 'a.pdf'), entry('2', 'a.pdf')],
      [],
      MoveConflictPolicy.RENAME,
    );

    expect(moves.map((m) => m.name)).toEqual(['a.pdf', 'a (1).pdf']);
  });

  it('폴더는 점이 있어도 확장자로 보지 않는다', () => {
    const { moves } = plan(
      [entry('1', 'v1.2')],
      ['v1.2'],
      MoveConflictPolicy.RENAME,
      MoveEntryType.FOLDER,
    );

    expect(moves).toEqual([{ id: '1', name: 'v1.2 (1)' }]);
  });
});
