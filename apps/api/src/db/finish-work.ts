import { and, eq, gt, inArray, ne } from "drizzle-orm";
import { workItems, workSessions } from "./schema.js";
import type { Db } from "./repo.js";

/**
 * What finishing a piece of work implies, in one place.
 *
 * There are two doors onto "this work is done" — completing a study session and saying
 * "handed in" on the item itself — and they drifted twice. First only one of them released
 * the blocks still held for the work; then only one of them completed a parent project when
 * its last stage finished, so a paper handed in stage by stage through the table sat at
 * "5 of 5 stages cleared" and still called itself unfinished. Two implementations of one
 * fact will always drift. This is the one implementation.
 */

/**
 * Frees every block still held for an item, and only in the future.
 *
 * Releasing means "this time is yours again", which is a claim about what has not happened
 * yet — yesterday cannot be given back, and the weekly review reads past blocks as the
 * record of what those hours actually did.
 */
export async function releaseFutureSessions(
  db: Db,
  workItemId: string,
  options: { excludeSessionId?: string } = {},
): Promise<number> {
  const conditions = [
    eq(workSessions.workItemId, workItemId),
    eq(workSessions.status, "planned"),
    gt(workSessions.startAt, new Date().toISOString()),
  ];
  if (options.excludeSessionId) conditions.push(ne(workSessions.id, options.excludeSessionId));

  const released = await db
    .update(workSessions)
    .set({ status: "released" })
    .where(and(...conditions))
    .returning({ id: workSessions.id });
  return released.length;
}

/**
 * Completes a parent project when its last live stage finishes.
 *
 * The parent has no blocks of its own — the scheduler plans through the stages — so nothing
 * else would ever close it. Two rules, each defending a real case:
 *
 *  - Canceled and optional stages do not block. "We are not doing the peer-review round"
 *    must not leave the paper officially unfinished forever after every real stage is in.
 *  - At least one stage must actually be finished. A project whose stages were all canceled
 *    was abandoned, not completed, and marking it done would bank credit for it.
 *  - The parent itself must be open. A project the student canceled stays canceled, whatever
 *    happens to its stages afterwards -- see `shouldCompleteParent`.
 *
 * Returns true when the parent was completed by this call.
 */
const finished = (status: string) => status === "completed" || status === "submitted";
/** Neither done nor waiting to be done: it will not happen, and it does not block the parent. */
const inert = (status: string) => status === "canceled" || status === "optional";

/**
 * The decision, as a function of statuses, so the three callers can be reasoned about without a
 * database.
 *
 * The parent has to be *open*. Checking only for "not already finished" quietly reopened work the
 * student had put away: a canceled project with one finished stage and one open one became
 * `completed` the moment that open stage went away -- by being handed in, or, once deleting was
 * possible, by being deleted as a row that should never have existed. Either way the app
 * announced a project done that the student had explicitly said they were not doing, and no
 * screen shows why it came back.
 */
export function shouldCompleteParent(
  parent: { status: string },
  siblings: { status: string }[],
): boolean {
  // An abandoned project is not a finished one: every stage canceled must not bank credit.
  if (!siblings.some((s) => finished(s.status))) return false;
  if (!siblings.every((s) => finished(s.status) || inert(s.status))) return false;
  return !finished(parent.status) && !inert(parent.status);
}

export async function completeParentIfDone(
  db: Db,
  item: { id: string; courseId: string; parentWorkItemId: string | null },
): Promise<boolean> {
  if (!item.parentWorkItemId) return false;

  const siblings = await db
    .select({ id: workItems.id, status: workItems.status })
    .from(workItems)
    .where(eq(workItems.parentWorkItemId, item.parentWorkItemId));

  // Scoped to the child's own course, so this can never reach an item belonging to someone else.
  // Creation now refuses a parent outside the course, and that is the fix; this is the second
  // lock, because what stands behind it is a blind write -- a status set and blocks released on
  // whatever row the id names. A stale link from before that check existed must fail closed.
  const [parent] = await db
    .select({ id: workItems.id, status: workItems.status })
    .from(workItems)
    .where(and(eq(workItems.id, item.parentWorkItemId), eq(workItems.courseId, item.courseId)));
  if (!parent || !shouldCompleteParent(parent, siblings)) return false;

  await db
    .update(workItems)
    .set({ status: "completed", remainingMinutes: 0 })
    .where(eq(workItems.id, parent.id));
  // The parent's own released blocks, if a replan ever gave it any directly.
  await db
    .update(workSessions)
    .set({ status: "released" })
    .where(
      and(
        inArray(workSessions.workItemId, [parent.id]),
        eq(workSessions.status, "planned"),
        gt(workSessions.startAt, new Date().toISOString()),
      ),
    );
  return true;
}
