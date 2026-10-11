import type { WorkItem } from "@schoolquest/domain";

/**
 * The work in one course that is finished, past its deadline, and still has no result: what the
 * dashboard offers to record.
 *
 * Work that already has a result is left out. Listing it too offered a Pass/Fail button that
 * replaced a real score, and kept every saved row on the list after it was saved (issue #9).
 */
export function workAwaitingResult(
  workItems: readonly WorkItem[],
  courseId: string,
  gradedIds: ReadonlySet<string>,
  nowMs: number,
): WorkItem[] {
  return workItems.filter(
    (w) =>
      w.courseId === courseId &&
      !gradedIds.has(w.id) &&
      (w.status === "completed" || w.status === "submitted") &&
      w.dueAt !== null &&
      Date.parse(w.dueAt) <= nowMs,
  );
}

/**
 * Reads the two halves of a score box -- what was scored, and what it was out of -- the same way
 * in every view that has one.
 *
 * An *empty* total falls back to what the syllabus said the thing was out of, which is usually
 * right and always editable. Only empty: `||` would also swallow a typed "0", and silently
 * grading 42/100 when the student wrote 42/0 is worse than the error. An empty score is never a
 * zero: `Number("")` is 0, which is how the dashboard used to save 0/10 for a box left blank.
 * Returns null when the entry is not a usable score.
 */
export function parseScoreEntry(
  entry: { earned: string; outOf: string } | undefined,
  itemPointsPossible: number | null,
): { pointsEarned: number; pointsPossible: number } | null {
  const earnedTyped = (entry?.earned ?? "").trim();
  const outOfTyped = (entry?.outOf ?? "").trim();
  if (earnedTyped === "") return null;
  const pointsEarned = Number(earnedTyped);
  const pointsPossible = outOfTyped === "" ? (itemPointsPossible ?? NaN) : Number(outOfTyped);
  if (!Number.isFinite(pointsEarned) || pointsEarned < 0) return null;
  if (!Number.isFinite(pointsPossible) || pointsPossible <= 0) return null;
  return { pointsEarned, pointsPossible };
}

/**
 * Whether the assignments table shows a row while finished work is hidden.
 *
 * Open work, always. Handed-in work while it waits on a result: it is the one finished state
 * with something still owed on it, and hiding it is how a score never gets written down. And
 * work recorded as a Fail, which the course gauge sends the student here to look at -- hidden,
 * the gauge's "Look at the failed work" landed on a list without it. Canceled work cannot sink
 * a course, so a Fail on it raises nothing and it stays hidden like other canceled work.
 */
export function onDefaultList(
  w: WorkItem,
  gradedIds: ReadonlySet<string>,
  failedIds: ReadonlySet<string>,
): boolean {
  if (w.status === "submitted" && !gradedIds.has(w.id)) return true;
  if (failedIds.has(w.id) && w.status !== "canceled") return true;
  return w.status !== "completed" && w.status !== "submitted" && w.status !== "canceled";
}

/**
 * What a course with no percentage says about its grades. A course whose only results are
 * Pass/Fail has been graded -- just not in points -- and reading "no grades yet" straight after
 * recording a Pass looks like the save was lost.
 */
export function noPercentReading(passFailCount: number): string {
  return passFailCount > 0
    ? `no scored grades yet · ${passFailCount} Pass/Fail`
    : "no grades yet";
}

/** Pass/Fail results a course standing holds, across its grading categories. */
export function standingPassFailCount(standing: { categories?: { passFailCount: number }[] } | undefined): number {
  return (standing?.categories ?? []).reduce((sum, c) => sum + (c.passFailCount ?? 0), 0);
}
