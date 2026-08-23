import { Hono } from "hono";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import {
  commitmentType,
  MINUTES_PER_DAY,
  newId,
  timeOfDay,
  toEpochMinutes,
} from "@schoolquest/domain";
import {
  buildWeeklyReview,
  DEFAULT_LOOKBACK_DAYS,
  slotKeyFor,
  type LostBlock,
  type ReportedInterruption,
  type SlotResolution,
} from "@schoolquest/planning-engine";
import { auditEvents, commitments, courses, interruptions, terms, workItems, workSessions } from "../db/schema.js";
import { assertTermOwner, getDb, serializeDays, type Db } from "../db/repo.js";
import type { AppBindings } from "../env.js";

export const reviewRoute = new Hono<AppBindings>();

/**
 * The weekly look back: which of last week's blocks the week did not honour, and whether any
 * of it is really a standing commitment nobody wrote down.
 *
 * Nothing here scores or remembers failures. The only question ever asked is what is actually
 * on the calendar, because a plan that keeps booking a time the student is never free is a
 * plan built on a wrong map — and every week it stays wrong, the student reads the mismatch
 * as something about themselves.
 */
reviewRoute.get("/terms/:termId/review", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  return c.json(await loadReview(db, termId));
});

/**
 * Blocks whose time has passed while they still said "planned" -- the ones the student may have
 * done but never checked off. This is the catch-up list: the app never assumes a block happened,
 * so before it reflows anything it asks the student to say what actually got done. Only the
 * *silent* ones appear; a block already skipped or completed has been answered for.
 *
 * This is also the only way to mark a forgotten block after the fact -- Today only ever acts on
 * the current recommendation, so without this a block missed yesterday was simply unreachable.
 */
reviewRoute.get("/terms/:termId/catchup", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  // Dev builds may plan from a simulated clock; honour it here too so a walked term reconciles
  // against the same "now" its plan was built against. Ignored once mail is configured.
  const nowParam = c.req.query("now");
  const now = !c.env.RESEND_API_KEY && nowParam ? new Date(nowParam).toISOString() : new Date().toISOString();
  const since = new Date(
    (toEpochMinutes(now) - DEFAULT_LOOKBACK_DAYS * MINUTES_PER_DAY) * 60_000,
  ).toISOString();

  const rows = await db
    .select({
      id: workSessions.id,
      workItemId: workSessions.workItemId,
      startAt: workSessions.startAt,
      endAt: workSessions.endAt,
      status: workSessions.status,
      title: workItems.title,
      courseName: courses.name,
      courseCode: courses.code,
    })
    .from(workSessions)
    .innerJoin(workItems, eq(workItems.id, workSessions.workItemId))
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .where(and(eq(courses.termId, termId), gte(workSessions.startAt, since)));

  const blocks = rows
    .filter((r) => r.endAt <= now && (r.status === "planned" || r.status === "started"))
    .map((r) => ({
      sessionId: r.id,
      workItemId: r.workItemId,
      title: r.title,
      courseName: r.courseName,
      courseCode: r.courseCode,
      startAt: r.startAt,
      endAt: r.endAt,
      minutes: Math.round((Date.parse(r.endAt) - Date.parse(r.startAt)) / 60_000),
    }))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return c.json({ blocks });
});

/** Shared with the plan route, which folds the review into what it already returns. */
export async function loadReview(db: Db, termId: string) {
  const now = new Date().toISOString();
  const since = new Date(
    (toEpochMinutes(now) - DEFAULT_LOOKBACK_DAYS * MINUTES_PER_DAY) * 60_000,
  ).toISOString();

  // Blocks in the lookback that were planned and did not happen. The join is the same
  // ownership walk every session route uses: session -> item -> course -> term.
  const rows = await db
    .select({
      id: workSessions.id,
      workItemId: workSessions.workItemId,
      startAt: workSessions.startAt,
      endAt: workSessions.endAt,
      status: workSessions.status,
      outcomeCode: workSessions.outcomeCode,
    })
    .from(workSessions)
    .innerJoin(workItems, eq(workItems.id, workSessions.workItemId))
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .where(and(eq(courses.termId, termId), gte(workSessions.startAt, since)));

  const lost: LostBlock[] = [];
  for (const row of rows) {
    if (row.endAt > now) continue;
    const skipped = row.status === "skipped" || row.status === "missed";
    // A block whose time simply passed while it still said "planned" is the commonest case
    // by far, and the one nobody ever answered for. It counts.
    const silent = row.status === "planned" || row.status === "started";
    if (!skipped && !silent) continue;
    lost.push({
      sessionId: row.id,
      workItemId: row.workItemId,
      startAt: row.startAt,
      endAt: row.endAt,
      source: skipped ? "reported" : "silent",
    });
  }

  const stored = await db.select().from(interruptions).where(eq(interruptions.termId, termId));

  const reported: ReportedInterruption[] = stored
    .filter((r) => r.kind === "reported" && r.startAt && r.endAt)
    .map((r) => ({
      id: r.id,
      title: r.title ?? "Something came up",
      kind: r.commitmentType ? commitmentType.catch("other").parse(r.commitmentType) : null,
      sessionId: r.workSessionId,
      startAt: r.startAt!,
      endAt: r.endAt!,
      recurring: r.recurring,
    }));

  // Only the newest answer per slot matters, and "promoted" is final.
  const bySlot = new Map<string, SlotResolution>();
  for (const row of stored) {
    if (row.kind !== "resolution" || !row.resolution) continue;
    const existing = bySlot.get(row.slotKey);
    const next: SlotResolution = {
      slotKey: row.slotKey,
      resolution: row.resolution as SlotResolution["resolution"],
      occurrences: row.occurrences,
    };
    if (!existing || existing.resolution !== "promoted") bySlot.set(row.slotKey, next);
  }

  return buildWeeklyReview({ lost, reported, resolutions: [...bySlot.values()], now });
}

const reportBody = z.object({
  title: z.string().min(1).max(120),
  commitmentType: commitmentType.default("other"),
  /** The student's own answer to "every week?", when the interface asked. */
  recurring: z.boolean().nullable().default(null),
});

/**
 * Records what took the time instead of a block, and marks the block skipped in one move.
 *
 * Skipping used to record `did_not_start` and nothing else, which threw away the only piece
 * of information worth having: not that the block did not happen, but what was there instead.
 */
reviewRoute.post("/work-sessions/:id/interrupted", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const parsed = reportBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const [owned] = await db
    .select({ session: workSessions, termId: courses.termId })
    .from(workSessions)
    .innerJoin(workItems, eq(workItems.id, workSessions.workItemId))
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(workSessions.id, id), eq(terms.userId, c.get("userId"))));

  if (!owned) return c.json({ error: "Session not found" }, 404);

  const start = new Date(owned.session.startAt);
  const slotKey = slotKeyFor(
    start.getUTCDay(),
    `${String(start.getUTCHours()).padStart(2, "0")}:${String(start.getUTCMinutes()).padStart(2, "0")}`,
  );

  const row = {
    id: newId("interruption"),
    termId: owned.termId,
    kind: "reported",
    slotKey,
    workSessionId: id,
    title: parsed.data.title,
    commitmentType: parsed.data.commitmentType,
    startAt: owned.session.startAt,
    endAt: owned.session.endAt,
    recurring: parsed.data.recurring,
    resolution: null,
    occurrences: 0,
    promotedCommitmentId: null,
    createdAt: new Date().toISOString(),
  };

  await db.insert(interruptions).values(row);
  await db
    .update(workSessions)
    .set({ status: "skipped", outcomeCode: "did_not_start" })
    .where(eq(workSessions.id, id));

  return c.json({ interruption: row }, 201);
});

const answerBody = z.object({
  slotKey: z.string().min(1),
  /** How many occurrences the student was answering about, so growth reopens the question. */
  occurrences: z.number().int().nonnegative().default(0),
  answer: z.enum(["one_off", "dismissed", "promote"]),
  /** Required for "promote": the standing commitment to write. */
  commitment: z
    .object({
      title: z.string().min(1).max(120),
      commitmentType: commitmentType.default("other"),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
      startTime: timeOfDay,
      endTime: timeOfDay,
    })
    .optional(),
});

/**
 * Answers one of the review's questions.
 *
 * "Promote" is the whole point of the exercise: the thing that keeps happening becomes part
 * of the boilerplate week, so the scheduler stops planning over the top of it. The other two
 * answers close the question without changing the calendar — one because the week was
 * unusual, the other because the student would rather not say.
 */
reviewRoute.post("/terms/:termId/review/answer", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = answerBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  if (parsed.data.answer === "promote" && !parsed.data.commitment) {
    return c.json({ error: "A commitment is required to add this to the week." }, 400);
  }

  const spec = parsed.data.commitment;
  if (spec && spec.endTime <= spec.startTime) {
    return c.json({ error: "A commitment must end after it starts." }, 400);
  }

  let commitment = null;
  if (parsed.data.answer === "promote" && spec) {
    commitment = {
      id: newId("commitment"),
      termId,
      title: spec.title,
      commitmentType: spec.commitmentType,
      daysOfWeek: serializeDays(spec.daysOfWeek),
      startTime: spec.startTime,
      endTime: spec.endTime,
      specificDate: null,
      // Flexible, not fixed: this is time the student told us about after the fact, and the
      // scheduler should keep clear of it without treating it as immovable as a class.
      flexibility: "flexible" as const,
      locked: false,
    };
    await db.insert(commitments).values(commitment);
  }

  const row = {
    id: newId("interruption"),
    termId,
    kind: "resolution",
    slotKey: parsed.data.slotKey,
    workSessionId: null,
    title: spec?.title ?? null,
    commitmentType: spec?.commitmentType ?? null,
    startAt: null,
    endAt: null,
    recurring: parsed.data.answer === "promote" ? true : null,
    resolution: parsed.data.answer === "promote" ? "promoted" : parsed.data.answer,
    occurrences: parsed.data.occurrences,
    promotedCommitmentId: commitment?.id ?? null,
    createdAt: new Date().toISOString(),
  };
  await db.insert(interruptions).values(row);

  await db.insert(auditEvents).values({
    id: newId("auditEvent"),
    userId: c.get("userId"),
    entityType: "interruption",
    entityId: row.id,
    action: `review:${row.resolution}`,
    beforeJson: null,
    afterJson: JSON.stringify({ slotKey: row.slotKey, commitmentId: commitment?.id ?? null }),
    actorType: "user",
    createdAt: row.createdAt,
  });

  return c.json({ ok: true, commitment, review: await loadReview(db, termId) });
});
