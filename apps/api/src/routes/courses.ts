import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { COURSE_COLOR_TOKENS, newId } from "@schoolquest/domain";
import { readCourseList } from "@schoolquest/ai";
import {
  courses,
  extractionClaims,
  gradingCategories,
  meetingPatterns,
  sourceDocuments,
  workItems,
} from "../db/schema.js";
import { assertTermOwner, chunk, getDb, serializeDays, type Db } from "../db/repo.js";
import { deleteWorkItems } from "../db/delete-work.js";
import { assertCourseOwner } from "../db/ownership.js";
import { aiErrorResponse } from "../lib/ai-errors.js";
import { openRouterFor } from "../lib/openrouter.js";
import { timeOfDay } from "../lib/validation.js";
import { NO_PROVIDER_MESSAGE, providerForUser } from "../provider-for-user.js";
import { rateLimitPerUser } from "../rate-limit.js";
import type { AppBindings } from "../env.js";

export const coursesRoute = new Hono<AppBindings>();

const courseBody = z.object({
  name: z.string().min(1),
  code: z.string().nullable().optional(),
  instructor: z.string().nullable().optional(),
  credits: z.number().nullable().optional(),
  colorToken: z.string().optional(),
  targetGrade: z.number().min(0).max(100).nullable().optional(),
  meetingPatterns: z
    .array(
      z.object({
        daysOfWeek: z.array(z.number().int().min(0).max(6)),
        startTime: timeOfDay,
        endTime: timeOfDay,
        location: z.string().nullable().optional(),
      }),
    )
    .optional(),
  gradingCategories: z
    .array(
      z.object({
        name: z.string(),
        weightPercent: z.number().min(0).max(100).nullable(),
        dropLowest: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
});

coursesRoute.post("/terms/:termId/courses", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = courseBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // Hand each course the next identity colour rather than the schema default. Counting
  // existing courses keeps the cycle stable for a term built one course at a time, which
  // is how every term is actually built.
  const existing = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.termId, termId));

  const course = {
    id: newId("course"),
    termId,
    name: parsed.data.name,
    code: parsed.data.code ?? null,
    instructor: parsed.data.instructor ?? null,
    credits: parsed.data.credits ?? null,
    colorToken:
      parsed.data.colorToken ?? COURSE_COLOR_TOKENS[existing.length % COURSE_COLOR_TOKENS.length]!,
    expectedWeeklyMinutes: null,
    targetGrade: parsed.data.targetGrade ?? null,
    gradingConfidence: parsed.data.gradingCategories?.length ? "confirmed" : "unknown",
  };
  await db.insert(courses).values(course);

  if (parsed.data.meetingPatterns?.length) {
    await db.insert(meetingPatterns).values(
      parsed.data.meetingPatterns.map((m) => ({
        id: newId("meetingPattern"),
        courseId: course.id,
        daysOfWeek: serializeDays(m.daysOfWeek),
        startTime: m.startTime,
        endTime: m.endTime,
        location: m.location ?? null,
        effectiveStart: null,
        effectiveEnd: null,
      })),
    );
  }

  if (parsed.data.gradingCategories?.length) {
    await db.insert(gradingCategories).values(
      parsed.data.gradingCategories.map((g) => ({
        id: newId("gradingCategory"),
        courseId: course.id,
        name: g.name,
        weightPercent: g.weightPercent,
        dropRuleJson: g.dropLowest ? JSON.stringify({ dropLowest: g.dropLowest }) : null,
        confidenceStatus: "confirmed",
      })),
    );
  }

  return c.json({ course }, 201);
});

const coursePasteBody = z.object({
  /** The student's course list, pasted as text from a portal or timetable. */
  text: z.string().min(10).max(20_000),
});

/**
 * Creates courses from a pasted course list.
 *
 * The same trade the calendar makes: the student is already looking at this table in another
 * tab, and typing four fields plus a meeting-time form per class is the most tedious screen in
 * the app -- sitting directly between a new user and the first useful thing the app does, since
 * a syllabus has nowhere to attach without a course.
 *
 * Writes straight through rather than offering a preview, because everything it creates is
 * editable on the same screen a moment later, and a confirm step for data the student can see
 * and fix is a step for its own sake. What was dropped is reported, never hidden.
 */
coursesRoute.post("/terms/:termId/courses/paste", rateLimitPerUser("coursePaste"), async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const resolved = await providerForUser(db, c.env, c.get("userId"));
  if (!resolved.apiKey) return c.json({ error: NO_PROVIDER_MESSAGE }, 503);

  const parsed = coursePasteBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const provider = openRouterFor(c.env, resolved.apiKey, resolved.extractionModel);

  let result;
  try {
    result = await readCourseList(provider, { text: parsed.data.text });
  } catch (error) {
    const answer = aiErrorResponse(c, error, {
      unreachable: "The reader is unreachable right now. Nothing was changed - try again.",
    });
    if (answer) return answer;
    throw error;
  }

  const existing = await db
    .select({ id: courses.id, name: courses.name, code: courses.code })
    .from(courses)
    .where(eq(courses.termId, termId));

  // Pasting twice is a normal thing to do -- after adding a class, or because the first paste
  // missed one. Without this it silently doubles every course already there.
  const identity = (code: string | null, name: string) =>
    `${(code ?? "").trim().toLowerCase()}|${name.trim().toLowerCase()}`;
  const already = new Map(existing.map((c2) => [identity(c2.code, c2.name), c2]));

  const created: (typeof courses.$inferSelect)[] = [];
  const skipped: { name: string; code: string | null; reason: string }[] = [];

  for (const read of result.accepted) {
    const name = read.name.trim() || (read.code ?? "").trim();
    const code = read.code?.trim() || null;

    if (already.has(identity(code, name))) {
      skipped.push({ name, code, reason: "It is already on this term." });
      continue;
    }

    const course = {
      id: newId("course"),
      termId,
      name,
      code,
      instructor: read.instructor?.trim() || null,
      credits: read.credits ?? null,
      colorToken:
        COURSE_COLOR_TOKENS[(existing.length + created.length) % COURSE_COLOR_TOKENS.length]!,
      expectedWeeklyMinutes: null,
      targetGrade: null,
      // Nothing here says how the course is graded; that still comes from the syllabus.
      gradingConfidence: "unknown" as const,
    };
    await db.insert(courses).values(course);
    already.set(identity(code, name), { id: course.id, name, code });

    if (read.meetings.length > 0) {
      await db.insert(meetingPatterns).values(
        read.meetings.map((m) => ({
          id: newId("meetingPattern"),
          courseId: course.id,
          daysOfWeek: serializeDays(m.daysOfWeek),
          startTime: m.startTime,
          endTime: m.endTime,
          location: m.location ?? null,
          effectiveStart: null,
          effectiveEnd: null,
        })),
      );
    }

    created.push(course as typeof courses.$inferSelect);
  }

  return c.json({
    created,
    /** Already present, so nothing happened. Not an error, but worth saying. */
    skipped,
    /** Rows the reader would not vouch for, with why. */
    rejected: result.rejected.map((r) => ({
      name: r.course.name,
      code: r.course.code,
      reason: r.reason,
    })),
    unreadableLines: result.unreadableLines,
    /** Courses kept whose meeting times did not survive checking. */
    warnings: result.warnings,
    /** Named so the screen can say which classes still need times typed in. */
    withoutMeetings: created
      .filter((course) => {
        const read = result.accepted.find((r) => (r.name.trim() || r.code) === course.name);
        return !read || read.meetings.length === 0;
      })
      .map((course) => course.name),
  });
});

/**
 * Setting a course's class times after the course exists.
 *
 * Meeting patterns could only be supplied in the same request that created the course, or by
 * confirming an extraction. A class that moves room or hour mid-term — or one the student
 * added by hand and only later found the timetable for — had no way in, so the calendar and
 * the scheduler both went on believing the student was free during a lecture.
 *
 * Replaces the set rather than appending: a timetable is a statement of the whole pattern,
 * and merging would leave last term's Tuesday behind with no way to remove it.
 */
const meetingsBody = z.object({
  patterns: z.array(
    z.object({
      daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
      startTime: timeOfDay,
      endTime: timeOfDay,
      location: z.string().nullable().optional(),
    }),
  ),
});

const gradingBody = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        /** Null is a real answer: "this category exists but I do not know its weight yet." */
        weightPercent: z.number().min(0).max(100).nullable(),
      }),
    )
    .max(24),
});

/**
 * Replaces a course's grading scheme.
 *
 * The weights could be set once, at course creation, and never again -- so when a syllabus
 * left a category unweighted and the student later asked the instructor "what are exams
 * worth", the answer had nowhere to land. This is that landing place. Replace-whole rather
 * than patch-one, matching meeting-patterns: the student is looking at the whole scheme and
 * correcting it, and a set that no longer sums oddly is the honest record.
 *
 * `gradingConfidence` flips to "confirmed" once any weight is stated, because a student who
 * has typed a number has told us more than the extractor ever knew.
 */
coursesRoute.put("/courses/:courseId/grading", async (c) => {
  const db = getDb(c.env.DB);
  const courseId = c.req.param("courseId");
  if (!(await assertCourseOwner(db, courseId, c.get("userId")))) {
    return c.json({ error: "Course not found" }, 404);
  }

  const parsed = gradingBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const stated = parsed.data.categories.filter((cat) => cat.weightPercent !== null);
  const total = stated.reduce((sum, cat) => sum + (cat.weightPercent ?? 0), 0);
  // A whole scheme that overshoots 100 is a typo, not a plan; reject rather than store a
  // grade basis that can never be right. Under 100 is allowed -- a category may be unstated.
  if (total > 100.5) {
    return c.json({ error: `The weights add up to ${Math.round(total)}%, which is over 100%.` }, 400);
  }

  /**
   * Categories are matched to the stored ones by name and keep their ids. This used to delete
   * every category and insert fresh rows, so after any edit -- one weight changed -- every work
   * item still pointed at an id that no longer existed: its results counted as uncategorized in
   * the standing and its category weight dropped out of prioritising (found in review on #39).
   * A category that is gone takes its items' link with it rather than leaving them dangling.
   * One batch, so a failure leaves the old scheme whole.
   */
  const stored = await db
    .select({ id: gradingCategories.id, name: gradingCategories.name })
    .from(gradingCategories)
    .where(eq(gradingCategories.courseId, courseId));
  const unmatched = new Map<string, string[]>();
  for (const row of stored) {
    const key = row.name.trim().toLowerCase();
    unmatched.set(key, [...(unmatched.get(key) ?? []), row.id]);
  }
  const updates: BatchItem<"sqlite">[] = [];
  const inserts: (typeof gradingCategories.$inferInsert)[] = [];
  for (const cat of parsed.data.categories) {
    const name = cat.name.trim();
    const keep = unmatched.get(name.toLowerCase())?.shift();
    if (keep) {
      updates.push(
        db
          .update(gradingCategories)
          .set({ name, weightPercent: cat.weightPercent, confidenceStatus: "confirmed" })
          .where(eq(gradingCategories.id, keep)),
      );
    } else {
      inserts.push({
        id: newId("gradingCategory"),
        courseId,
        name,
        weightPercent: cat.weightPercent,
        dropRuleJson: null,
        confidenceStatus: "confirmed",
      });
    }
  }
  const removed = [...unmatched.values()].flat();

  await db.batch([
    db
      .update(courses)
      .set({ gradingConfidence: parsed.data.categories.length > 0 ? "confirmed" : "unknown" })
      .where(eq(courses.id, courseId)),
    ...updates,
    ...(removed.length > 0
      ? [
          db
            .update(workItems)
            .set({ gradingCategoryId: null })
            .where(and(eq(workItems.courseId, courseId), inArray(workItems.gradingCategoryId, removed))),
          db.delete(gradingCategories).where(inArray(gradingCategories.id, removed)),
        ]
      : []),
    // Six columns a row, so 16 rows stay under D1's 100 bound parameters a statement.
    ...chunk(inserts, 16).map((rows) => db.insert(gradingCategories).values(rows)),
  ]);

  return c.json({ ok: true, categories: parsed.data.categories.length });
});

coursesRoute.put("/courses/:courseId/meeting-patterns", async (c) => {
  const db = getDb(c.env.DB);
  const courseId = c.req.param("courseId");
  if (!(await assertCourseOwner(db, courseId, c.get("userId")))) {
    return c.json({ error: "Course not found" }, 404);
  }

  const parsed = meetingsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const bad = parsed.data.patterns.find((p) => p.endTime <= p.startTime);
  if (bad) return c.json({ error: "A class must end after it starts." }, 400);

  await db.delete(meetingPatterns).where(eq(meetingPatterns.courseId, courseId));
  if (parsed.data.patterns.length > 0) {
    await db.insert(meetingPatterns).values(
      parsed.data.patterns.map((p) => ({
        id: newId("meetingPattern"),
        courseId,
        daysOfWeek: serializeDays(p.daysOfWeek),
        startTime: p.startTime,
        endTime: p.endTime,
        location: p.location ?? null,
        effectiveStart: null,
        effectiveEnd: null,
      })),
    );
  }
  return c.json({ ok: true, patterns: parsed.data.patterns.length });
});

/**
 * Wipes a course's academic data back to empty: every assignment, its sessions and recorded
 * grades, its dependencies, its grading scheme, and its class times. The course itself stays --
 * name, code, target grade are the student's, not the syllabus's.
 *
 * This exists for "replace the syllabus and start this class over". Re-reading a syllabus in
 * place replaces only that document's extraction claims; it cannot know that the student wants
 * the old assignments gone too. So the client calls this first, deliberately and after
 * confirming, then reads the new syllabus into a clean course.
 *
 * Children are deleted explicitly rather than by cascade: D1 does not enforce foreign-key
 * cascades unless every connection opts in, and `dependencies` carries no foreign key at all.
 * Ordered children-first so nothing is ever orphaned even if a later delete fails. Ids are
 * chunked because a course with many items would otherwise overflow the SQL variable limit.
 */
/**
 * Deletes a course's academic data -- every work item with its sessions, grades and
 * dependencies, then the grading scheme and class times. Not the course row itself.
 *
 * Children are deleted explicitly rather than by cascade: D1 does not enforce foreign-key
 * cascades unless every connection opts in, and `dependencies` carries no foreign key at all.
 * Children-first so nothing is orphaned if a later delete fails; ids are chunked to stay under
 * the SQL variable limit. Shared by "reset this course" and "delete this course".
 */
async function deleteCourseAcademics(
  db: Db,
  courseId: string,
): Promise<number> {
  const items = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.courseId, courseId));
  const itemIds = items.map((i) => i.id);

  // One implementation of "remove these work items and everything hanging off them", shared with
  // the single-item delete. It had been copied, and the copy carried the bug review found in the
  // original: a batch of 100 ids bound twice by the dependency statement's two `IN` clauses is
  // 200 bound parameters against D1's ceiling of about 100. A course with fifty-odd assignments
  // is ordinary, so this was reachable -- and it failed midway, after the grade and session rows
  // were already gone.
  await deleteWorkItems(db, itemIds);

  await db.delete(gradingCategories).where(eq(gradingCategories.courseId, courseId));
  await db.delete(meetingPatterns).where(eq(meetingPatterns.courseId, courseId));
  return itemIds.length;
}

coursesRoute.post("/courses/:courseId/reset-academics", async (c) => {
  const db = getDb(c.env.DB);
  const courseId = c.req.param("courseId");
  if (!(await assertCourseOwner(db, courseId, c.get("userId")))) {
    return c.json({ error: "Course not found" }, 404);
  }

  const workItemsDeleted = await deleteCourseAcademics(db, courseId);
  // The grading scheme is gone, so the course no longer claims to know its weights.
  await db.update(courses).set({ gradingConfidence: "unknown" }).where(eq(courses.id, courseId));

  return c.json({ ok: true, workItemsDeleted });
});

/** Rename a course or fix its code. The one thing a student who typed it wrong needs. */
const courseEditBody = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().max(40).nullable().optional(),
});
coursesRoute.patch("/courses/:courseId", async (c) => {
  const db = getDb(c.env.DB);
  const courseId = c.req.param("courseId");
  if (!(await assertCourseOwner(db, courseId, c.get("userId")))) {
    return c.json({ error: "Course not found" }, 404);
  }
  const parsed = courseEditBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch["name"] = parsed.data.name.trim();
  if (parsed.data.code !== undefined) {
    // An empty string means "clear the code", which is a legitimate state, not the string "".
    patch["code"] = parsed.data.code === null ? null : parsed.data.code.trim() || null;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(courses).set(patch).where(eq(courses.id, courseId));
  }
  return c.json({ ok: true });
});

/**
 * Delete a course and everything under it: its assignments and their history, its grading
 * scheme and class times, and the syllabi uploaded for it -- stored bytes, extraction claims
 * and rows. Destructive and irreversible, so the UI confirms first. The term, and every other
 * course, are untouched.
 */
coursesRoute.delete("/courses/:courseId", async (c) => {
  const db = getDb(c.env.DB);
  const courseId = c.req.param("courseId");
  if (!(await assertCourseOwner(db, courseId, c.get("userId")))) {
    return c.json({ error: "Course not found" }, 404);
  }

  await deleteCourseAcademics(db, courseId);

  const docs = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.courseId, courseId));
  for (const doc of docs) {
    // Best effort on the bytes: a missing R2 object must not strand the row deletion.
    await c.env.DOCUMENTS.delete(doc.storageKey).catch(() => {});
    await db.delete(extractionClaims).where(eq(extractionClaims.sourceDocumentId, doc.id));
  }
  await db.delete(sourceDocuments).where(eq(sourceDocuments.courseId, courseId));

  await db.delete(courses).where(eq(courses.id, courseId));
  return c.json({ ok: true });
});
