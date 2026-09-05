/**
 * What a replan changed, stated as blocks that stayed, moved, appeared or went.
 *
 * `plan_versions` is append-only precisely so that a change can be inspected (docs/04 §13), and
 * nothing ever inspected it: every regenerate retired the old blocks, wrote the new ones, and
 * re-rendered the week as if it had always looked that way. A student who lost a Tuesday could
 * see the new week but not what it cost, which is the half of "replan calmly" that reassures.
 *
 * Pure and schema-free. The Worker hands it the live blocks the new plan replaces and the blocks
 * the new plan holds; nothing is stored, and the previous version's rows are what they always
 * were. Matching is by work item: a block for the same work item at a different time has moved,
 * one with no counterpart has been added or dropped, and a block carried across unchanged (same
 * id, same time) was kept.
 */

export interface DiffableSession {
  id: string;
  workItemId: string;
  startAt: string;
  endAt: string;
}

export interface PlanDiffBlock {
  sessionId: string;
  workItemId: string;
  startAt: string;
  endAt: string;
}

export interface PlanDiffMove {
  workItemId: string;
  from: PlanDiffBlock;
  to: PlanDiffBlock;
}

export interface PlanDiff {
  /** Blocks present in both plans at the same time. */
  kept: PlanDiffBlock[];
  moved: PlanDiffMove[];
  /** In the new plan with no counterpart in the old one. */
  added: PlanDiffBlock[];
  /** In the old plan with no counterpart in the new one. */
  dropped: PlanDiffBlock[];
  /** True when every block stayed exactly where it was. */
  unchanged: boolean;
}

const byStart = (a: DiffableSession, b: DiffableSession) =>
  a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id);

const block = (s: DiffableSession): PlanDiffBlock => ({
  sessionId: s.id,
  workItemId: s.workItemId,
  startAt: s.startAt,
  endAt: s.endAt,
});

export function diffPlans(
  previous: readonly DiffableSession[],
  next: readonly DiffableSession[],
): PlanDiff {
  const kept: PlanDiffBlock[] = [];
  const moved: PlanDiffMove[] = [];
  const added: PlanDiffBlock[] = [];
  const dropped: PlanDiffBlock[] = [];

  // Pass 1: identical blocks (carried across by id, same minutes) are kept and leave the pool.
  const nextById = new Map(next.map((s) => [s.id, s]));
  const oldPool: DiffableSession[] = [];
  const newTaken = new Set<string>();
  for (const old of [...previous].sort(byStart)) {
    const same = nextById.get(old.id);
    if (same && same.startAt === old.startAt && same.endAt === old.endAt) {
      kept.push(block(old));
      newTaken.add(same.id);
    } else {
      oldPool.push(old);
    }
  }
  const newPool = [...next].filter((s) => !newTaken.has(s.id)).sort(byStart);

  // Pass 2: pair the rest by work item, in start order, so the first old block of an item is
  // compared with the first new block of that item. A pair at the same minutes is kept too --
  // a re-issued id for an unchanged block is not a change the student needs to hear about.
  const newByItem = new Map<string, DiffableSession[]>();
  for (const s of newPool) {
    const list = newByItem.get(s.workItemId) ?? [];
    list.push(s);
    newByItem.set(s.workItemId, list);
  }
  for (const old of oldPool) {
    const candidates = newByItem.get(old.workItemId);
    const match = candidates?.shift();
    if (!match) {
      dropped.push(block(old));
    } else if (match.startAt === old.startAt && match.endAt === old.endAt) {
      kept.push(block(match));
    } else {
      moved.push({ workItemId: old.workItemId, from: block(old), to: block(match) });
    }
  }
  for (const rest of newByItem.values()) for (const s of rest) added.push(block(s));

  kept.sort((a, b) => a.startAt.localeCompare(b.startAt));
  moved.sort((a, b) => a.to.startAt.localeCompare(b.to.startAt));
  added.sort((a, b) => a.startAt.localeCompare(b.startAt));
  dropped.sort((a, b) => a.startAt.localeCompare(b.startAt));

  return {
    kept,
    moved,
    added,
    dropped,
    unchanged: moved.length === 0 && added.length === 0 && dropped.length === 0,
  };
}
