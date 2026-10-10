import type { OutcomeCode } from "@schoolquest/domain";

/** Outcomes in which the student said, in so many words, that the work is not finished. */
const UNFINISHED: ReadonlySet<OutcomeCode> = new Set([
  "partially_completed",
  "needs_another_session",
  "blocked_missing_info",
]);

/**
 * Effort still owed on a piece of work after a session's outcome is recorded.
 *
 * `null` means "nothing is known", as it does on the work item, and is left for the planner's
 * defaults to fill.
 *
 * The rule that mattered: **an unfinished outcome never finishes the work.** The old arithmetic
 * was estimate minus minutes worked, and the minutes worked are usually the whole planned block,
 * which is usually the whole estimate. So "Needs more time" on a sixty-minute assignment booked
 * as one sixty-minute block computed zero remaining, the route read zero as done, marked the
 * assignment completed and released every block still held for it. The student asked for more
 * time and the app took away all of it, then reported the work finished. Found by the scheduling
 * journey (`tools/e2e/scheduling.mjs`).
 *
 * When the estimate has run out but the student says it is not done, the estimate was wrong, and
 * the honest guess at what is left is one more block like the one just worked.
 */
export function remainingAfterOutcome(input: {
  outcome: OutcomeCode;
  /** What the student said is left, when they said; it overrides everything else. */
  reported?: number;
  remainingMinutes: number | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  plannedMinutes: number;
}): number | null {
  if (input.reported !== undefined) return input.reported;
  if (input.outcome === "completed") return 0;
  // Nothing happened; effort is unchanged.
  if (input.outcome === "did_not_start") return input.remainingMinutes;

  // Seeded from the estimate when no remaining figure exists yet. Most items never have one
  // until they are touched, and the old guard skipped them entirely -- so a partial session's
  // minutes counted for nothing and the item still demanded its full estimate, which is the
  // opposite of the learning signal this exists to record (docs/04 §9).
  const base = input.remainingMinutes ?? input.estimatedMinutes;
  if (base === null) return input.remainingMinutes;
  const left = Math.max(0, base - input.actualMinutes);
  if (left === 0 && UNFINISHED.has(input.outcome)) {
    return Math.max(1, Math.round(input.plannedMinutes));
  }
  return left;
}
