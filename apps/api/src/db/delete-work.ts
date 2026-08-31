import { inArray } from "drizzle-orm";
import { dependencies, gradeResults, workItems, workSessions } from "./schema.js";
import { ID_IN_CLAUSE_CHUNK, type Db } from "./repo.js";

/**
 * Removing a piece of work for good, rather than taking it out of the plan.
 *
 * Cancelling is the right move for "we are not doing chapter 7": the term really contained that
 * assignment, and the record of what it was worth and what was already done against it is worth
 * keeping. Deleting is for work that never existed -- a line the extractor invented out of a
 * syllabus table, the same midterm read twice under two names, a row typed into the wrong course.
 * Keeping those forever as `canceled` is how the list becomes something a student stops reading.
 *
 * A project takes its stages with it. The stages are not separate work; they are how the project
 * was broken up, and leaving them behind orphans rows whose parent is gone -- the scheduler would
 * go on booking hours for the halves of a paper the student just said was never assigned.
 */

/**
 * Every id in the subtree under `rootId`, the root first.
 *
 * Walked level by level rather than recursively so that a parent chain that somehow points at
 * itself -- a bad import, a hand-edited row -- terminates instead of looping forever. `seen`
 * carries that guarantee: an id already collected is never expanded twice.
 */
export function collectSubtreeIds(
  rootId: string,
  items: { id: string; parentWorkItemId: string | null }[],
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const item of items) {
    if (!item.parentWorkItemId) continue;
    const siblings = childrenOf.get(item.parentWorkItemId);
    if (siblings) siblings.push(item.id);
    else childrenOf.set(item.parentWorkItemId, [item.id]);
  }

  const seen = new Set<string>([rootId]);
  const out: string[] = [rootId];
  for (let i = 0; i < out.length; i += 1) {
    for (const child of childrenOf.get(out[i]!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
    }
  }
  return out;
}

/**
 * Ids per statement, and the batches themselves.
 *
 * Split out so the parameter budget can be checked without a database: every statement below
 * binds one id per row of its batch, so one batch must stay inside `ID_IN_CLAUSE_CHUNK`.
 */
/**
 * Deletes work items and everything hanging off them: their blocks, their results, and any
 * dependency naming them at either end.
 *
 * The rows are cleared explicitly rather than left to the schema's `on delete cascade`, for the
 * same reason `deleteCourseAcademics` does: D1 does not enforce foreign keys unless the pragma is
 * on, and dependencies do not carry a foreign key at all -- their two columns are plain ids. A
 * dependency left pointing at a deleted item is a scheduler input that blocks work forever on a
 * predecessor that can never finish.
 */
export function idBatches(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_IN_CLAUSE_CHUNK) {
    batches.push(ids.slice(i, i + ID_IN_CLAUSE_CHUNK));
  }
  return batches;
}

export async function deleteWorkItems(db: Db, ids: string[]): Promise<void> {
  for (const batch of idBatches(ids)) {
    await db.delete(gradeResults).where(inArray(gradeResults.workItemId, batch));
    await db.delete(workSessions).where(inArray(workSessions.workItemId, batch));
    // Two statements rather than one `or(inArray(pred), inArray(succ))`, which binds every id
    // twice and so doubles the parameter count for the same batch. Found in review: at the old
    // batch size of 100 a project of 51 stages already exceeded D1's ceiling, and it failed
    // *after* the grade and session deletes had committed -- leaving the work item in place with
    // its history stripped, which is worse than either finishing or failing.
    await db.delete(dependencies).where(inArray(dependencies.predecessorWorkItemId, batch));
    await db.delete(dependencies).where(inArray(dependencies.successorWorkItemId, batch));
    await db.delete(workItems).where(inArray(workItems.id, batch));
  }
}
