import { and, eq, inArray } from "drizzle-orm";
import {
  commitments,
  courses,
  extractionClaims,
  gradingCategories,
  sourceDocuments,
  terms,
  workItems,
  workSessions,
} from "./schema.js";
import type { Db } from "./repo.js";

/**
 * "Does this row belong to the signed-in user?", one join per kind of row.
 *
 * Every route that takes an id from the URL has to walk from that row up to `terms.user_id`
 * before it touches anything, or an id from another account is readable -- or writable -- by
 * anyone who guesses it. The walks were written inline in each handler, the same three-table join
 * a dozen times over, which is how one of them ends up missing. They live here so a route asks a
 * named question instead of re-deriving the answer.
 *
 * Each returns null (or false) for both "no such row" and "someone else's row", so a route can
 * only ever answer 404 and never confirms that a stranger's id exists.
 *
 * `assertTermOwner` stays in repo.ts, where the snapshot loader that every term route uses lives.
 */

/** Confirms a course belongs to this user before anything reads or writes under it. */
export async function assertCourseOwner(db: Db, courseId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: courses.id })
    .from(courses)
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(courses.id, courseId), eq(terms.userId, userId)));
  return Boolean(row);
}

/** A work item, walking item -> course -> term -> user. */
export async function loadOwnedWorkItem(db: Db, workItemId: string, userId: string) {
  const [row] = await db
    .select({ item: workItems })
    .from(workItems)
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(workItems.id, workItemId), eq(terms.userId, userId)));
  return row?.item ?? null;
}

/**
 * How many of these work item ids belong to this user. Used where several ids arrive together
 * and every one must be owned, so the caller compares the count with the number it asked about.
 */
export async function countOwnedWorkItems(db: Db, workItemIds: string[], userId: string): Promise<number> {
  const owned = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(inArray(workItems.id, workItemIds), eq(terms.userId, userId)));
  return owned.length;
}

/** A standing commitment, walking commitment -> term -> user. */
export async function loadOwnedCommitment(db: Db, commitmentId: string, userId: string) {
  const [row] = await db
    .select({ commitment: commitments })
    .from(commitments)
    .innerJoin(terms, eq(terms.id, commitments.termId))
    .where(and(eq(commitments.id, commitmentId), eq(terms.userId, userId)));
  return row?.commitment ?? null;
}

/** A source document with its course and term, walking document -> course -> term -> user. */
export async function loadOwnedDocument(db: Db, documentId: string, userId: string) {
  const [row] = await db
    .select({ document: sourceDocuments, course: courses, term: terms })
    .from(sourceDocuments)
    .innerJoin(courses, eq(courses.id, sourceDocuments.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(sourceDocuments.id, documentId), eq(terms.userId, userId)));
  return row ?? null;
}

/** One extraction claim, walking claim -> document -> course -> term -> user. */
export async function loadOwnedClaim(db: Db, claimId: string, userId: string) {
  const [row] = await db
    .select({ claim: extractionClaims })
    .from(extractionClaims)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, extractionClaims.sourceDocumentId))
    .innerJoin(courses, eq(courses.id, sourceDocuments.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(extractionClaims.id, claimId), eq(terms.userId, userId)));
  return row?.claim ?? null;
}

/**
 * A work session with its item and term, walking session -> work item -> course -> term -> user
 * in a single join. Every mutating session route goes through this.
 */
export async function loadOwnedSession(db: Db, sessionId: string, userId: string) {
  const [row] = await db
    .select({ session: workSessions, item: workItems, term: terms })
    .from(workSessions)
    .innerJoin(workItems, eq(workItems.id, workSessions.workItemId))
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(workSessions.id, sessionId), eq(terms.userId, userId)));
  return row ?? null;
}

/**
 * A parent has to be a real item in the same course, or absent.
 *
 * Nothing checked this. `parentWorkItemId` arrived as a plain string and was written straight to
 * the row, so it could name any work item in the database -- including another account's. Two
 * things followed. The smaller one: deleting a project looks for its stages in its own course, so
 * a child parked elsewhere survives as an orphan the scheduler still books. The larger one:
 * `completeParentIfDone` looks a parent up by id and then *writes* to it, so pointing a throwaway
 * assignment at a stranger's midterm and handing it in finished their work and released the study
 * time held for it.
 *
 * Same course rather than merely same owner, because that is the invariant the rest of the code
 * already assumes: `POST /work-items/:id/stages` copies `parent.courseId` down to every stage it
 * creates, and the subtree delete walks one course.
 *
 * Both doors, checked the same way. The first version of this guarded creation alone, which
 * review caught: `PATCH` spreads the same field out of `workItemBody.partial()`, so re-parenting
 * an item you own reopened the identical hole. Half a check on a two-door room is no check.
 */
export async function parentIsInCourse(
  db: Db,
  parentWorkItemId: string | null | undefined,
  courseId: string,
): Promise<boolean> {
  if (!parentWorkItemId) return true;
  const [parent] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, parentWorkItemId), eq(workItems.courseId, courseId)));
  return Boolean(parent);
}

/**
 * A grading category has to belong to the item's course, or be absent. Without this an item could
 * point at any category in the database, another account's included, and grade projections would
 * read a stranger's weights. Same shape, and both doors, as `parentIsInCourse`.
 */
export async function categoryIsInCourse(
  db: Db,
  gradingCategoryId: string | null | undefined,
  courseId: string,
): Promise<boolean> {
  if (!gradingCategoryId) return true;
  const [category] = await db
    .select({ id: gradingCategories.id })
    .from(gradingCategories)
    .where(and(eq(gradingCategories.id, gradingCategoryId), eq(gradingCategories.courseId, courseId)));
  return Boolean(category);
}
