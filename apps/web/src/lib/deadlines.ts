import type { WorkItem } from "@schoolquest/domain";
import type { DeadlineInput } from "@schoolquest/planning-engine";

/**
 * The board's dated rows, in the shape the week views draw them.
 *
 * One filter, used by every week view, because the promise being made is an *equality*: what
 * the assignments board lists as open and dated is what the calendar shows on its day. Two
 * copies of this rule is two chances for the calendar to quietly hold less than the board,
 * which is the exact complaint this exists to answer -- work on the board, nothing on the
 * calendar -- and it is not a complaint anybody can debug by looking, because the missing row
 * looks like an empty Thursday.
 *
 * The filter matches `AssignmentsTable`'s own with its "show finished" switch off, with one
 * deliberate difference: handed-in work is dropped here and kept there. The board keeps it
 * because something is still owed *on* it -- a result to write down -- and that is a real
 * errand. A calendar of the week's hours is answering a different question, and marking a
 * deadline the student already met would be telling them to do it again.
 */
export function openDeadlines(workItems: readonly WorkItem[]): DeadlineInput[] {
  const out: DeadlineInput[] = [];
  for (const item of workItems) {
    if (!item.dueAt) continue;
    if (item.status === "completed" || item.status === "submitted") continue;
    if (item.status === "canceled") continue;
    out.push({
      workItemId: item.id,
      courseId: item.courseId,
      title: item.title,
      workType: item.workType,
      dueAt: item.dueAt,
    });
  }
  return out;
}
