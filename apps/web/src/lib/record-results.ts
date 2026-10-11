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
