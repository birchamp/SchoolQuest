import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { newId, workStatus, type WorkItem } from "@schoolquest/domain";
import { canDecompose, proposeStages, totalEffort } from "@schoolquest/planning-engine";
import { dependencies, workItems } from "../db/schema.js";
import { getDb, insertInChunks } from "../db/repo.js";
import { collectSubtreeIds, deleteWorkItems } from "../db/delete-work.js";
import { completeParentIfDone, releaseFutureSessions } from "../db/finish-work.js";
import {
  assertCourseOwner,
  categoryIsInCourse,
  countOwnedWorkItems,
  loadOwnedWorkItem,
  parentIsInCourse,
} from "../db/ownership.js";
import { isoInstant } from "../iso-instant.js";
import type { AppBindings } from "../env.js";

/** Work items: create, edit, delete, dependencies, and breaking a project into stages. */
export const workItemsRoute = new Hono<AppBindings>();

const workItemBody = z.object({
  courseId: z.string(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  workType: z.string(),
  dueAt: isoInstant.nullable().optional(),
  availableAt: isoInstant.nullable().optional(),
  pointsPossible: z.number().nonnegative().nullable().optional(),
  gradingCategoryId: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  cognitiveDemand: z.enum(["low", "medium", "high"]).default("medium"),
  locationRequirement: z
    .enum(["anywhere", "desk", "library", "lab", "campus", "quiet"])
    .default("anywhere"),
  parentWorkItemId: z.string().nullable().optional(),
  userPriority: z.number().int().min(-2).max(2).default(0),
  /**
   * Nothing could set this. A student could finish a session, which marks the item done as a
   * side effect, but could not simply say "I handed this in" — and the item's status is what
   * the dashboard reads to know a result is owed. Unknown keys are stripped by Zod, so the
   * omission showed up not as a rejection but as a PATCH that silently did nothing.
   */
  status: workStatus.optional(),
});

workItemsRoute.post("/work-items", async (c) => {
  const parsed = workItemBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const db = getDb(c.env.DB);
  if (!(await assertCourseOwner(db, parsed.data.courseId, c.get("userId")))) {
    return c.json({ error: "Course not found" }, 404);
  }

  if (!(await parentIsInCourse(db, parsed.data.parentWorkItemId, parsed.data.courseId))) {
    return c.json({ error: "Parent work item not found in this course" }, 404);
  }

  if (!(await categoryIsInCourse(db, parsed.data.gradingCategoryId, parsed.data.courseId))) {
    return c.json({ error: "Grading category not found in this course" }, 404);
  }

  const item = {
    id: newId("workItem"),
    courseId: parsed.data.courseId,
    parentWorkItemId: parsed.data.parentWorkItemId ?? null,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    workType: parsed.data.workType,
    availableAt: parsed.data.availableAt ?? null,
    dueAt: parsed.data.dueAt ?? null,
    pointsPossible: parsed.data.pointsPossible ?? null,
    gradingCategoryId: parsed.data.gradingCategoryId ?? null,
    categorySharePercent: null,
    estimatedMinutes: parsed.data.estimatedMinutes ?? null,
    // Remaining effort starts equal to the estimate and is updated by session outcomes.
    remainingMinutes: parsed.data.estimatedMinutes ?? null,
    cognitiveDemand: parsed.data.cognitiveDemand,
    divisibility: "divisible",
    locationRequirement: parsed.data.locationRequirement,
    status: "not_started",
    sourceConfidence: "confirmed",
    userPriority: parsed.data.userPriority,
  };

  await db.insert(workItems).values(item);
  return c.json({ workItem: item }, 201);
});

workItemsRoute.patch("/work-items/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const existing = await loadOwnedWorkItem(db, id, c.get("userId"));
  if (!existing) return c.json({ error: "Work item not found" }, 404);

  const parsed = workItemBody.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // The same check creation makes, because this is the same field and the same consequence.
  // An item may not become its own parent either: that is a cycle, and the subtree walk and the
  // completion rule both have to reason about it forever after.
  if (parsed.data.parentWorkItemId !== undefined) {
    if (parsed.data.parentWorkItemId === id) {
      return c.json({ error: "A work item cannot be its own parent." }, 400);
    }
    if (!(await parentIsInCourse(db, parsed.data.parentWorkItemId, existing.courseId))) {
      return c.json({ error: "Parent work item not found in this course" }, 404);
    }
  }
  // Checked only when it changes: an edit that leaves the category alone is not about it.
  if (
    parsed.data.gradingCategoryId !== undefined &&
    parsed.data.gradingCategoryId !== existing.gradingCategoryId &&
    !(await categoryIsInCourse(db, parsed.data.gradingCategoryId, existing.courseId))
  ) {
    return c.json({ error: "Grading category not found in this course" }, 404);
  }

  const patch: Record<string, unknown> = { ...parsed.data };
  delete patch["courseId"]; // Moving an item between courses is not a PATCH.
  // A user edit is always confirmed, overriding whatever the extractor inferred.
  if (parsed.data.dueAt !== undefined) patch["sourceConfidence"] = "confirmed";

  /**
   * Finishing work here frees the blocks still held for it, exactly as finishing a session
   * does.
   *
   * Saying "I handed this in" and completing a study block are two doors onto the same
   * fact, and only one of them used to close. Through this one the item went quiet while
   * the week went on holding three more sessions of it: the plan announced the assignment
   * done and the forecast below it went on booking time, which is the same contradiction
   * `POST /work-sessions/:id/complete` already carries a paragraph about.
   *
   * Only time still ahead. Releasing means "this time is yours again", which is a claim
   * about the future -- yesterday cannot be given back, and the weekly review reads those
   * past blocks as the record of what the hours actually did.
   */
  const finished = parsed.data.status === "completed" || parsed.data.status === "submitted";
  // A corrected estimate governs again. `requiredMinutes` prefers remainingMinutes, so on
  // any item the survey or a session has touched, editing the estimate would otherwise
  // change a number nobody reads and the plan would not move -- an edit that saves and does
  // nothing. Clearing remaining hands control back to the figure the student just gave;
  // partial sessions after this decrement from it as usual. Finished work is left alone.
  const wasOpen =
    existing.status !== "completed" &&
    existing.status !== "submitted" &&
    existing.status !== "canceled";
  if (
    parsed.data.estimatedMinutes !== undefined &&
    parsed.data.estimatedMinutes !== existing.estimatedMinutes &&
    wasOpen &&
    !finished
  ) {
    patch["remainingMinutes"] = null;
  }
  const wasFinished =
    existing.status === "completed" || existing.status === "submitted";
  // Reopening restores the effort estimate. Handing in zeroes remainingMinutes, and a
  // status change alone must not leave that zero behind: an item put back with zero
  // remaining looks finished to the scheduler forever, so a mis-click on "Handed in"
  // would be a one-way door. Null hands the estimate back to `estimatedMinutes`.
  if (!finished && wasFinished && parsed.data.status !== undefined) {
    patch["remainingMinutes"] = null;
  }
  let releasedSessions = 0;
  if (finished && existing.status !== parsed.data.status) {
    patch["remainingMinutes"] = 0;
    releasedSessions = await releaseFutureSessions(db, id);
  }

  // Drizzle throws on an empty SET, so a body of only unrecognised keys — which Zod strips
  // rather than rejecting — came back as a 500 rather than as the no-op it is.
  if (Object.keys(patch).length === 0) {
    return c.json({ workItem: existing });
  }

  const [updated] = await db.update(workItems).set(patch).where(eq(workItems.id, id)).returning();

  // Handing in the last live stage finishes the project, through this door exactly as
  // through the session door. Only one of the two did this, so a paper handed in stage by
  // stage from the table sat at "5 of 5 stages cleared" and still called itself unfinished.
  if (finished) {
    await completeParentIfDone(db, existing);
  }
  return c.json({ workItem: updated, releasedSessions });
});

/**
 * Removes a piece of work for good, with its stages, its blocks and its result.
 *
 * Distinct from cancelling, which the table offers alongside it. `canceled` is the right answer to
 * "we are not doing chapter 7": the assignment was real, and what it was worth and what was
 * already done against it is part of the term's record. This is the answer to work that was never
 * assigned at all -- a line the extractor read out of a syllabus table that was not one, the same
 * midterm confirmed twice under two names, a row typed into the wrong course. Those cannot be left
 * as cancelled rows: a list that keeps everything anyone ever typed is a list nobody scans.
 *
 * Irreversible, so the UI confirms first and names what goes with it.
 */
workItemsRoute.delete("/work-items/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const existing = await loadOwnedWorkItem(db, id, c.get("userId"));
  if (!existing) return c.json({ error: "Work item not found" }, 404);

  // Stages live in the same course as the project they belong to, so the course is the whole
  // search space -- and it is a few dozen rows, not the term's several hundred.
  const inCourse = await db
    .select({ id: workItems.id, parentWorkItemId: workItems.parentWorkItemId })
    .from(workItems)
    .where(eq(workItems.courseId, existing.courseId));

  const ids = collectSubtreeIds(id, inCourse);
  await deleteWorkItems(db, ids);

  // Deleting a stage can be what finishes its project: a paper whose last open stage turns out
  // never to have been assigned is done, and the same rule closes it here as when a stage is
  // handed in. A project whose every stage was deleted has no stages left to judge it by, and
  // `completeParentIfDone` leaves it open rather than banking credit for nothing.
  await completeParentIfDone(db, existing);

  return c.json({ ok: true, deleted: ids.length });
});

const dependencyBody = z.object({
  predecessorWorkItemId: z.string(),
  dependencyType: z.enum(["finish_to_start", "informs", "same_session"]).default("finish_to_start"),
});

workItemsRoute.post("/work-items/:id/dependencies", async (c) => {
  const db = getDb(c.env.DB);
  const successorId = c.req.param("id");
  const parsed = dependencyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // Both ends must belong to this user, or a dependency could leak another account's ids.
  const owned = await countOwnedWorkItems(
    db,
    [successorId, parsed.data.predecessorWorkItemId],
    c.get("userId"),
  );
  if (owned !== 2) return c.json({ error: "Work item not found" }, 404);

  const dependency = {
    id: newId("dependency"),
    predecessorWorkItemId: parsed.data.predecessorWorkItemId,
    successorWorkItemId: successorId,
    dependencyType: parsed.data.dependencyType,
  };
  await db.insert(dependencies).values(dependency);
  return c.json({ dependency }, 201);
});

// --- Breaking a project into stages -------------------------------------------

/**
 * Proposes stages for a large work item. Writes nothing.
 *
 * Separate from the confirm step on purpose: the same discipline the syllabus extraction
 * follows. The app may suggest a structure, but nothing enters the student's plan until
 * they have looked at it — a plan that fills itself with work the student did not agree to
 * is not theirs any more.
 */
workItemsRoute.get("/work-items/:id/stage-proposal", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const row = await loadOwnedWorkItem(db, id, c.get("userId"));
  if (!row) return c.json({ error: "Work item not found" }, 404);

  const item = row as unknown as WorkItem;
  const effort = totalEffort(item);
  const effortMinutes = effort.minutes;

  const existing = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.parentWorkItemId, id));

  if (existing.length > 0) {
    return c.json({ canDecompose: false, reason: "already_has_stages", stages: [], effortMinutes });
  }
  if (!canDecompose(item, effortMinutes)) {
    return c.json({ canDecompose: false, reason: "too_small", stages: [], effortMinutes });
  }

  return c.json({
    canDecompose: true,
    reason: null,
    effortMinutes,
    // True when the effort came from a per-type default rather than anyone's estimate, so
    // the review screen can say the stage sizes rest on an assumption.
    effortIsAssumed: effort.assumed,
    stages: proposeStages(item, effortMinutes, new Date().toISOString()),
  });
});

const stagesBody = z.object({
  stages: z
    .array(
      z.object({
        title: z.string().min(1),
        estimatedMinutes: z.number().int().positive(),
        dueAt: isoInstant.nullable().default(null),
        cognitiveDemand: z.enum(["low", "medium", "high"]).default("medium"),
      }),
    )
    .min(1)
    .max(12),
});

/**
 * Creates the stages the student accepted.
 *
 * The parent keeps its own dates and grading links but stops being scheduled directly — the
 * scheduler plans a project through its stages once they exist. Its remaining effort is
 * zeroed for that reason, not because any work was done: leaving it would double-count the
 * project against itself.
 */
workItemsRoute.post("/work-items/:id/stages", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const parsed = stagesBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const row = await loadOwnedWorkItem(db, id, c.get("userId"));
  if (!row) return c.json({ error: "Work item not found" }, 404);

  const existing = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.parentWorkItemId, id));
  if (existing.length > 0) {
    return c.json({ error: "This already has stages." }, 409);
  }

  const parent = row;
  const created = parsed.data.stages.map((stage) => ({
    id: newId("workItem"),
    courseId: parent.courseId,
    parentWorkItemId: id,
    title: stage.title,
    description: null,
    workType: "milestone" as const,
    availableAt: null,
    dueAt: stage.dueAt,
    // Points and grading category stay on the parent: a stage is a way of doing the work,
    // not a separately graded thing, and copying the weight down would inflate the course.
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: stage.estimatedMinutes,
    remainingMinutes: stage.estimatedMinutes,
    cognitiveDemand: stage.cognitiveDemand,
    divisibility: "divisible" as const,
    locationRequirement: parent.locationRequirement,
    status: "not_started" as const,
    // The student reviewed and accepted these, which is exactly what confirmed means.
    sourceConfidence: "confirmed" as const,
    userPriority: 0,
  }));

  await insertInChunks(created, 6, (batch) => db.insert(workItems).values(batch));
  await db.update(workItems).set({ remainingMinutes: 0 }).where(eq(workItems.id, id));

  return c.json({ stages: created }, 201);
});
