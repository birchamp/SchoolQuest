import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { COURSE_COLOR_TOKENS, newId, planningPreferences } from "@schoolquest/domain";
import {
  availabilityRules,
  commitments,
  courses,
  dependencies,
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
