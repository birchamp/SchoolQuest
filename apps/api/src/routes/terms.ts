import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  COURSE_COLOR_TOKENS,
  newId,
  planningPreferences,
  workStatus,
  type WorkItem,
} from "@schoolquest/domain";
import {
  applyEffortAnswer,
  buildEffortSurvey,
  canDecompose,
  DEFAULT_EFFORT_MINUTES,
  proposeStages,
} from "@schoolquest/planning-engine";
import {
  auditEvents,
  availabilityRules,
  commitments,
  courses,
  dependencies,
  gradeResults,
  gradingCategories,
  meetingPatterns,
  terms,
  workItems,
} from "../db/schema.js";
import {
  assertTermOwner,
  getDb,
  insertInChunks,
  loadTermSnapshot,
  serializeDays,
} from "../db/repo.js";
import type { AppBindings } from "../env.js";

export const termsRoute = new Hono<AppBindings>();

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const termBody = z.object({
  name: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  planningPreferences: planningPreferences.partial().optional(),
});

termsRoute.get("/terms", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(terms).where(eq(terms.userId, c.get("userId")));
  return c.json({
    terms: rows.map((t) => ({
      ...t,
      planningPreferences: planningPreferences.parse(JSON.parse(t.planningPreferencesJson || "{}")),
    })),
  });
});

termsRoute.post("/terms", async (c) => {
  const parsed = termBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  // FR-1: a term cannot end before it starts.
  if (parsed.data.endDate < parsed.data.startDate) {
    return c.json({ error: "A term cannot end before it starts." }, 400);
  }

  const db = getDb(c.env.DB);
  const term = {
    id: newId("term"),
    userId: c.get("userId"),
    name: parsed.data.name,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    status: "active",
    planningPreferencesJson: JSON.stringify(
      planningPreferences.parse(parsed.data.planningPreferences ?? {}),
    ),
  };

  await db.insert(terms).values(term);
  return c.json({ term }, 201);
});

termsRoute.patch("/terms/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = termBody.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const patch: Record<string, unknown> = {};
  if (parsed.data.name) patch["name"] = parsed.data.name;
  if (parsed.data.startDate) patch["startDate"] = parsed.data.startDate;
  if (parsed.data.endDate) patch["endDate"] = parsed.data.endDate;
  if (parsed.data.planningPreferences) {
    const [existing] = await db.select().from(terms).where(eq(terms.id, id));
    patch["planningPreferencesJson"] = JSON.stringify(
      planningPreferences.parse({
        ...JSON.parse(existing!.planningPreferencesJson || "{}"),
        ...parsed.data.planningPreferences,
      }),
    );
  }

  const [updated] = await db.update(terms).set(patch).where(eq(terms.id, id)).returning();
  return c.json({ term: updated });
});

termsRoute.post("/terms/:id/archive", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }
  await db.update(terms).set({ status: "archived" }).where(eq(terms.id, id));
  return c.json({ ok: true });
});

/** Everything the client needs to render a term in one round trip. */
termsRoute.get("/terms/:id/snapshot", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }
  return c.json(await loadTermSnapshot(db, id));
});

// --- How long things take ----------------------------------------------------

/**
 * `entityType` for the record that a question was handed to the instructor.
 *
 * Kept in `audit_events` rather than a table of its own because that is exactly what it is:
 * an event, with a date, that happened once. "I asked my professor on 3 September" is history,
 * not state, and the screen only needs the latest one per question.
 */
const EFFORT_ASK_ENTITY = "effort_question";

/** The questions still worth asking, with anything already handed off marked as such. */
termsRoute.get("/terms/:id/effort-survey", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const userId = c.get("userId");
  if (!(await assertTermOwner(db, id, userId))) return c.json({ error: "Term not found" }, 404);

  const snapshot = await loadTermSnapshot(db, id);
  const survey = buildEffortSurvey({
    workItems: snapshot.workItems,
    courses: snapshot.courses,
    gradingCategories: snapshot.gradingCategories,
  });

  const asks = (
    await db.select().from(auditEvents).where(eq(auditEvents.userId, userId))
  ).filter((event) => event.entityType === EFFORT_ASK_ENTITY);
  // Latest event per question wins, so asking and then un-asking reads correctly.
  const askedAt = new Map<string, string>();
  for (const event of asks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (event.action === "asked_instructor") askedAt.set(event.entityId, event.createdAt);
    else askedAt.delete(event.entityId);
  }

  return c.json({
    ...survey,
    questions: survey.questions.map((q) => ({ ...q, askedInstructorAt: askedAt.get(q.id) ?? null })),
  });
});

const effortAnswersBody = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        /** Minutes per item, or null for "I don't know — I'll ask". */
        minutes: z.number().int().positive().max(24 * 60).nullable(),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * Applies the student's answers about how long their work takes.
 *
 * One answer writes a whole family, which is the entire point: thirteen quizzes settled by one
 * choice rather than thirteen. The survey is rebuilt from current data on every call rather
 * than trusting ids sent by the client, so an answer can only ever reach items that the server
 * itself just decided were unestimated — a stale question id from a screen left open overnight
 * resolves to nothing instead of overwriting work that has since been estimated by hand.
 *
 * A null answer is not a failure to answer. It records that the student does not know, which is
 * true for a first-year facing their first lab report, and hands them the sentence to send. The
 * estimate stays assumed, because that is the honest state until somebody actually knows.
 */
termsRoute.post("/terms/:id/effort-answers", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const userId = c.get("userId");
  if (!(await assertTermOwner(db, id, userId))) return c.json({ error: "Term not found" }, 404);

  const parsed = effortAnswersBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const snapshot = await loadTermSnapshot(db, id);
  const survey = buildEffortSurvey({
    workItems: snapshot.workItems,
    courses: snapshot.courses,
    gradingCategories: snapshot.gradingCategories,
  });
  const byId = new Map(survey.questions.map((q) => [q.id, q]));

  const applied: { questionId: string; itemsUpdated: number; minutes: number | null }[] = [];
  const unknown: string[] = [];
  const now = new Date().toISOString();

  for (const answer of parsed.data.answers) {
    const question = byId.get(answer.questionId);
    if (!question) {
      unknown.push(answer.questionId);
      continue;
    }

    if (answer.minutes === null) {
      await db.insert(auditEvents).values({
        id: newId("auditEvent"),
        userId,
        entityType: EFFORT_ASK_ENTITY,
        entityId: question.id,
        action: "asked_instructor",
        beforeJson: null,
        afterJson: JSON.stringify({ question: question.askProfessor, itemCount: question.itemCount }),
        actorType: "user",
        createdAt: now,
      });
      applied.push({ questionId: question.id, itemsUpdated: 0, minutes: null });
      continue;
    }

    const writes = applyEffortAnswer(question, answer.minutes, snapshot.workItems);
    for (const write of writes) {
      await db
        .update(workItems)
        .set({ estimatedMinutes: write.estimatedMinutes, remainingMinutes: write.remainingMinutes })
        .where(eq(workItems.id, write.workItemId));
    }
    applied.push({ questionId: question.id, itemsUpdated: writes.length, minutes: answer.minutes });
  }

  // Rebuilt after the writes so the caller can show the grounding move without a second call.
  const after = await loadTermSnapshot(db, id);
  const remaining = buildEffortSurvey({
    workItems: after.workItems,
    courses: after.courses,
    gradingCategories: after.gradingCategories,
  });

  return c.json({
    applied,
    // Reported rather than dropped: a question id the server does not recognise means the
    // screen is out of date, and silently doing nothing would look like it worked.
    unknownQuestionIds: unknown,
    groundedFraction: remaining.groundedFraction,
    questionsLeft: remaining.questions.length,
  });
});

// --- Courses -----------------------------------------------------------------

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

termsRoute.post("/terms/:termId/courses", async (c) => {
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

// --- Commitments and availability --------------------------------------------

const commitmentBody = z.object({
  title: z.string().min(1),
  commitmentType: z.string(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  startTime: timeOfDay,
  endTime: timeOfDay,
  specificDate: isoDate.nullable().optional(),
  flexibility: z.enum(["fixed", "flexible", "optional"]).default("fixed"),
});

termsRoute.post("/terms/:termId/commitments", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = commitmentBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const commitment = {
    id: newId("commitment"),
    termId,
    title: parsed.data.title,
    commitmentType: parsed.data.commitmentType,
    daysOfWeek: serializeDays(parsed.data.daysOfWeek),
    startTime: parsed.data.startTime,
    endTime: parsed.data.endTime,
    specificDate: parsed.data.specificDate ?? null,
    flexibility: parsed.data.flexibility,
    locked: parsed.data.flexibility === "fixed",
  };
  await db.insert(commitments).values(commitment);
  return c.json({ commitment }, 201);
});

const availabilityBody = z.object({
  rules: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: timeOfDay,
      endTime: timeOfDay,
      energyLevel: z.enum(["low", "medium", "high"]).default("medium"),
      location: z
        .enum(["anywhere", "desk", "library", "lab", "campus", "quiet"])
        .default("anywhere"),
      hardness: z.enum(["hard", "soft"]).default("soft"),
    }),
  ),
});

/** Replaces the whole availability grid — it is edited as a single grid in the UI. */
termsRoute.put("/terms/:termId/availability-rules", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = availabilityBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await db.delete(availabilityRules).where(eq(availabilityRules.termId, termId));
  const rows = parsed.data.rules.map((r) => ({
    id: newId("availabilityRule"),
    termId,
    dayOfWeek: r.dayOfWeek,
    startTime: r.startTime,
    endTime: r.endTime,
    energyLevel: r.energyLevel,
    location: r.location,
    hardness: r.hardness,
  }));
  // A full grid can be dozens of rules; chunk to stay under D1's parameter cap.
  await insertInChunks(rows, 10, (batch) => db.insert(availabilityRules).values(batch));

  return c.json({ ok: true, count: parsed.data.rules.length });
});

// --- Work items ---------------------------------------------------------------

const workItemBody = z.object({
  courseId: z.string(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  workType: z.string(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  availableAt: z.string().datetime({ offset: true }).nullable().optional(),
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

/** Confirms a course belongs to this user before writing work items into it. */
async function assertCourseOwner(
  db: ReturnType<typeof getDb>,
  courseId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: courses.id })
    .from(courses)
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(courses.id, courseId), eq(terms.userId, userId)));
  return Boolean(row);
}

termsRoute.post("/work-items", async (c) => {
  const parsed = workItemBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const db = getDb(c.env.DB);
  if (!(await assertCourseOwner(db, parsed.data.courseId, c.get("userId")))) {
    return c.json({ error: "Course not found" }, 404);
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

termsRoute.patch("/work-items/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const [existing] = await db
    .select({ item: workItems })
    .from(workItems)
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(workItems.id, id), eq(terms.userId, c.get("userId"))));
  if (!existing) return c.json({ error: "Work item not found" }, 404);

  const parsed = workItemBody.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const patch: Record<string, unknown> = { ...parsed.data };
  delete patch["courseId"]; // Moving an item between courses is not a PATCH.
  // A user edit is always confirmed, overriding whatever the extractor inferred.
  if (parsed.data.dueAt !== undefined) patch["sourceConfidence"] = "confirmed";

  // Drizzle throws on an empty SET, so a body of only unrecognised keys — which Zod strips
  // rather than rejecting — came back as a 500 rather than as the no-op it is.
  if (Object.keys(patch).length === 0) {
    return c.json({ workItem: existing.item });
  }

  const [updated] = await db.update(workItems).set(patch).where(eq(workItems.id, id)).returning();
  return c.json({ workItem: updated });
});

const dependencyBody = z.object({
  predecessorWorkItemId: z.string(),
  dependencyType: z.enum(["finish_to_start", "informs", "same_session"]).default("finish_to_start"),
});

termsRoute.post("/work-items/:id/dependencies", async (c) => {
  const db = getDb(c.env.DB);
  const successorId = c.req.param("id");
  const parsed = dependencyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // Both ends must belong to this user, or a dependency could leak another account's ids.
  const owned = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(
      and(
        inArray(workItems.id, [successorId, parsed.data.predecessorWorkItemId]),
        eq(terms.userId, c.get("userId")),
      ),
    );
  if (owned.length !== 2) return c.json({ error: "Work item not found" }, 404);

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
termsRoute.get("/work-items/:id/stage-proposal", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const [row] = await db
    .select({ item: workItems })
    .from(workItems)
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(workItems.id, id), eq(terms.userId, c.get("userId"))));
  if (!row) return c.json({ error: "Work item not found" }, 404);

  const item = row.item as unknown as WorkItem;
  const effortMinutes =
    item.estimatedMinutes ??
    (item.remainingMinutes && item.remainingMinutes > 0 ? item.remainingMinutes : null) ??
    DEFAULT_EFFORT_MINUTES[item.workType] ??
    60;

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
    effortIsAssumed: item.estimatedMinutes === null && !(item.remainingMinutes ?? 0),
    stages: proposeStages(item, effortMinutes, new Date().toISOString()),
  });
});

const stagesBody = z.object({
  stages: z
    .array(
      z.object({
        title: z.string().min(1),
        estimatedMinutes: z.number().int().positive(),
        dueAt: z.string().datetime({ offset: true }).nullable().default(null),
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
termsRoute.post("/work-items/:id/stages", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const parsed = stagesBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const [row] = await db
    .select({ item: workItems })
    .from(workItems)
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(workItems.id, id), eq(terms.userId, c.get("userId"))));
  if (!row) return c.json({ error: "Work item not found" }, 404);

  const existing = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.parentWorkItemId, id));
  if (existing.length > 0) {
    return c.json({ error: "This already has stages." }, 409);
  }

  const parent = row.item;
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

/**
 * Recording what a piece of work actually scored.
 *
 * Nothing could do this before. Grades were in the schema, the seed loaded three of them,
 * and `computeCourseStanding` knew how to weight them — but no route existed to enter one,
 * so in practice every student's standing was permanently unknown. That was survivable while
 * nothing depended on it; it stops being survivable the moment the dashboard tells a student
 * their results are unrecorded, because naming a problem with no way to fix it is worse than
 * staying quiet about it.
 *
 * A result replaces any earlier one for the same item rather than accumulating. A grade is a
 * fact about a piece of work, not an event log, and a corrected mark should read as the
 * correction it is.
 */
const gradeBody = z.object({
  pointsEarned: z.number().nonnegative().nullable(),
  pointsPossible: z.number().positive().nullable(),
  letterGrade: z.string().max(8).nullable().default(null),
  confirmationStatus: z.enum(["confirmed", "extracted_unreviewed", "estimated"]).default("confirmed"),
});

termsRoute.put("/work-items/:id/grade", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const [existing] = await db
    .select({ item: workItems })
    .from(workItems)
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(workItems.id, id), eq(terms.userId, c.get("userId"))));
  if (!existing) return c.json({ error: "Work item not found" }, 404);

  const parsed = gradeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { pointsEarned, pointsPossible } = parsed.data;
  if (pointsEarned !== null && pointsPossible !== null && pointsEarned > pointsPossible) {
    return c.json({ error: "A score cannot be higher than the total it is out of." }, 400);
  }

  // Fall back to the item's own points when the student gives only a score — the syllabus
  // already said what it was out of, and making them retype it invites a mismatch.
  const outOf = pointsPossible ?? existing.item.pointsPossible ?? null;

  await db.delete(gradeResults).where(eq(gradeResults.workItemId, id));
  const [grade] = await db
    .insert(gradeResults)
    .values({
      id: newId("gradeResult"),
      workItemId: id,
      pointsEarned,
      pointsPossible: outOf,
      letterGrade: parsed.data.letterGrade,
      postedAt: new Date().toISOString(),
      confirmationStatus: parsed.data.confirmationStatus,
      sourceDocumentId: null,
      dropped: false,
    })
    .returning();

  // Recording a result means the work is done, whatever the item still said.
  if (existing.item.status !== "completed" && existing.item.status !== "submitted") {
    await db.update(workItems).set({ status: "completed" }).where(eq(workItems.id, id));
  }

  return c.json({ grade }, 201);
});

/**
 * Changing or removing a standing commitment.
 *
 * Commitments could be created and never touched again. A shift that moves to a different
 * evening — which is the single commonest change in a student's term — could only be handled
 * by adding a second one and living with the first, so the planner kept protecting an hour
 * nobody needed and the week quietly lost time to a shift that had ended weeks ago.
 */
const commitmentPatch = commitmentBody.partial();

termsRoute.patch("/commitments/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const [owned] = await db
    .select({ commitment: commitments })
    .from(commitments)
    .innerJoin(terms, eq(terms.id, commitments.termId))
    .where(and(eq(commitments.id, id), eq(terms.userId, c.get("userId"))));
  if (!owned) return c.json({ error: "Commitment not found" }, 404);

  const parsed = commitmentPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch["title"] = parsed.data.title;
  if (parsed.data.commitmentType !== undefined) patch["commitmentType"] = parsed.data.commitmentType;
  if (parsed.data.daysOfWeek !== undefined) patch["daysOfWeek"] = serializeDays(parsed.data.daysOfWeek);
  if (parsed.data.startTime !== undefined) patch["startTime"] = parsed.data.startTime;
  if (parsed.data.endTime !== undefined) patch["endTime"] = parsed.data.endTime;
  if (parsed.data.specificDate !== undefined) patch["specificDate"] = parsed.data.specificDate;
  if (parsed.data.flexibility !== undefined) {
    patch["flexibility"] = parsed.data.flexibility;
    patch["locked"] = parsed.data.flexibility === "fixed";
  }
  if (Object.keys(patch).length === 0) return c.json({ commitment: owned.commitment });

  const start = (patch["startTime"] as string) ?? owned.commitment.startTime;
  const end = (patch["endTime"] as string) ?? owned.commitment.endTime;
  if (end <= start) return c.json({ error: "A commitment must end after it starts." }, 400);

  const [updated] = await db
    .update(commitments)
    .set(patch)
    .where(eq(commitments.id, id))
    .returning();
  return c.json({ commitment: updated });
});

termsRoute.delete("/commitments/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const [owned] = await db
    .select({ id: commitments.id })
    .from(commitments)
    .innerJoin(terms, eq(terms.id, commitments.termId))
    .where(and(eq(commitments.id, id), eq(terms.userId, c.get("userId"))));
  if (!owned) return c.json({ error: "Commitment not found" }, 404);

  await db.delete(commitments).where(eq(commitments.id, id));
  return c.json({ ok: true });
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

termsRoute.put("/courses/:courseId/meeting-patterns", async (c) => {
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
