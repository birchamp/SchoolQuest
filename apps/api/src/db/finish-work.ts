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
 *
 * Returns true when the parent was completed by this call.
 */
export async function completeParentIfDone(
  db: Db,
  item: { id: string; parentWorkItemId: string | null },
): Promise<boolean> {
  if (!item.parentWorkItemId) return false;

  const siblings = await db
    .select({ id: workItems.id, status: workItems.status })
    .from(workItems)
    .where(eq(workItems.parentWorkItemId, item.parentWorkItemId));

  const finished = (status: string) => status === "completed" || status === "submitted";
  const inert = (status: string) => status === "canceled" || status === "optional";

  const noneOpen = siblings.every((s) => finished(s.status) || inert(s.status));
  const anyFinished = siblings.some((s) => finished(s.status));
  if (!noneOpen || !anyFinished) return false;

  const [parent] = await db
    .select({ id: workItems.id, status: workItems.status })
    .from(workItems)
    .where(eq(workItems.id, item.parentWorkItemId));
  if (!parent || finished(parent.status)) return false;

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
