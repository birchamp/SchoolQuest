import { Hono } from "hono";
import { and, eq, gte, inArray, lt, ne, notInArray, or, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { addDays, fromEpochMinutes, newId, outcomeCode, zoneCalendar } from "@schoolquest/domain";
import { auditEvents, commitments, courses, meetingPatterns, workItems, workSessions } from "../db/schema.js";
import { getDb, type Db } from "../db/repo.js";
import { completeParentIfDone, releaseFutureSessions } from "../db/finish-work.js";
import { findMoveConflict, type MoveSurroundings } from "../db/move-check.js";
import { remainingAfterOutcome } from "../db/remaining-effort.js";
import { isOpenOnDay } from "../db/lost-day.js";
import { assertTermOwner } from "../db/repo.js";
import { loadOwnedSession } from "../db/ownership.js";
import type { AppBindings } from "../env.js";

export const sessionsRoute = new Hono<AppBindings>();

// Every mutating route below loads its session through `loadOwnedSession` (db/ownership.ts).
// Without it, a session id from another account would be editable by anyone who guessed it.

const completeBody = z.object({
  outcome: outcomeCode,
  actualMinutes: z.number().int().nonnegative().optional(),
  /** Effort the student thinks is still left; overrides the automatic decrement. */
  remainingMinutes: z.number().int().nonnegative().optional(),
});

sessionsRoute.post("/work-sessions/:id/start", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await loadOwnedSession(db, id, c.get("userId")))) {
    return c.json({ error: "Session not found" }, 404);
  }

  const updated = await db
    .update(workSessions)
    .set({ status: "started" })
    .where(eq(workSessions.id, id))
    .returning();

  return c.json({ session: updated[0] });
});

/**
 * Records the outcome of a session and updates remaining effort.
 *
 * The remaining-effort update uses the reported time, not the planned time — this is the
 * learning signal that makes future estimates better (docs/04-planning-engine-spec.md §9).
 */
sessionsRoute.post("/work-sessions/:id/complete", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const parsed = completeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const owned = await loadOwnedSession(db, id, c.get("userId"));
  if (!owned) return c.json({ error: "Session not found" }, 404);
  const { session, item } = owned;

  const plannedMinutes =
    (Date.parse(session.endAt) - Date.parse(session.startAt)) / 60_000;
  const actualMinutes = parsed.data.actualMinutes ?? plannedMinutes;

  const status =
    parsed.data.outcome === "completed"
      ? "completed"
      : parsed.data.outcome === "did_not_start"
        ? "missed"
        : "partial";

  await db
    .update(workSessions)
    .set({ status, actualMinutes, outcomeCode: parsed.data.outcome })
    .where(eq(workSessions.id, id));

  const remaining = remainingAfterOutcome({
    outcome: parsed.data.outcome,
    reported: parsed.data.remainingMinutes,
    remainingMinutes: item.remainingMinutes,
    estimatedMinutes: item.estimatedMinutes,
    actualMinutes,
    plannedMinutes,
  });

  const itemStatus =
    remaining === 0
      ? "completed"
      : item.status === "not_started"
        ? "in_progress"
        : item.status;

  await db
    .update(workItems)
    .set({ remainingMinutes: remaining, status: itemStatus })
    .where(eq(workItems.id, item.id));

  // Finishing the last stage finishes the project. Without this a decomposed paper would
  // sit at "5 of 5 stages cleared" and still report itself unfinished forever — the parent
  // has no blocks of its own to complete, because the scheduler plans through the stages.
  if (itemStatus === "completed") {
    await completeParentIfDone(db, item);
  }

  // Finishing the work frees every block still held for it. Without this the interface
  // told the truth and lied in the same breath: it announced an assignment complete while
  // the forecast directly below went on listing three more sessions of it, and the claim
  // that the week redraws itself around what is left was visibly false.
  let releasedSessions = 0;
  if (itemStatus === "completed") {
    releasedSessions = await releaseFutureSessions(db, item.id, { excludeSessionId: id });
  }

  await db.insert(auditEvents).values({
    id: newId("auditEvent"),
    userId: c.get("userId"),
    entityType: "work_session",
    entityId: id,
    action: `outcome:${parsed.data.outcome}`,
    beforeJson: JSON.stringify({ status: session.status }),
    afterJson: JSON.stringify({ status, actualMinutes }),
    actorType: "user",
    createdAt: new Date().toISOString(),
  });

  // Reported so the interface can acknowledge the finish immediately instead of waiting
  // on a replan. It is only ever the item's real `pointsPossible`, and only on the call
  // that actually finished the item — completing a second session of already-finished
  // work banks nothing, because nothing new was earned.
  const completedNow = itemStatus === "completed" && item.status !== "completed";
  return c.json({
    ok: true,
    status,
    workItemStatus: itemStatus,
    pointsBanked: completedNow ? item.pointsPossible : null,
    releasedSessions,
  });
});

const moveBody = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
});

/**
 * What a block placed by hand has to be checked against: the term's classes, its fixed
 * commitments, and whichever of its other blocks `occupied` selects. The two routes that place a
 * block disagree only on that last part. A plain move must clear every live block; "do it now"
 * clears only the blocks the replan that follows will leave where they are.
 */
async function loadMoveSurroundings(
  db: Db,
  term: { id: string; startDate: string; endDate: string },
  timeZone: string,
  occupied: SQL,
): Promise<MoveSurroundings> {
  const termCourses = await db
    .select({ id: courses.id, name: courses.name })
    .from(courses)
    .where(eq(courses.termId, term.id));
  const courseIds = termCourses.map((x) => x.id);
  const courseNames = new Map(termCourses.map((x) => [x.id, x.name]));
  const [sessions, meetings, fixed] = await Promise.all([
    courseIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: workSessions.id, startAt: workSessions.startAt, endAt: workSessions.endAt, title: workItems.title })
          .from(workSessions)
          .innerJoin(workItems, eq(workItems.id, workSessions.workItemId))
          .where(and(inArray(workItems.courseId, courseIds), occupied)),
    courseIds.length === 0
      ? Promise.resolve([])
      : db.select().from(meetingPatterns).where(inArray(meetingPatterns.courseId, courseIds)),
    db.select().from(commitments).where(eq(commitments.termId, term.id)),
  ]);
  return {
    sessions,
    meetings: meetings.map((m) => ({
      daysOfWeek: m.daysOfWeek,
      startTime: m.startTime,
      endTime: m.endTime,
      courseName: courseNames.get(m.courseId) ?? "a class",
    })),
    commitments: fixed,
    termStartDate: term.startDate,
    termEndDate: term.endDate,
    timeZone,
  };
}

sessionsRoute.post("/work-sessions/:id/move", async (c) => {
  const db = getDb(c.env.DB);
  const parsed = moveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  // Parsed, not compared as strings: both fields accept an offset, and "10:00+02:00"
  // sorts after "09:00Z" lexicographically while being an hour before it.
  if (Date.parse(parsed.data.endAt) <= Date.parse(parsed.data.startAt)) {
    return c.json({ error: "A session must end after it starts." }, 400);
  }
  const owned = await loadOwnedSession(db, c.req.param("id"), c.get("userId"));
  if (!owned) return c.json({ error: "Session not found" }, 404);

  // The same checks the scheduler applies when it places a block, applied at the one door
  // where a person places one. Before this the route wrote whatever it was given, and the
  // week on screen could show a block inside a class until the next replan noticed.
  const around = await loadMoveSurroundings(
    db,
    owned.term,
    c.get("timeZone"),
    and(inArray(workSessions.status, ["planned", "started"]), ne(workSessions.id, owned.session.id))!,
  );
  const conflict = findMoveConflict(parsed.data, around);
  if (conflict) return c.json({ error: conflict }, 409);

  const updated = await db
    .update(workSessions)
    .set({
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      // Moving a block is an explicit choice, so it survives the next replan.
      acceptedByUser: true,
    })
    .where(eq(workSessions.id, c.req.param("id")))
    .returning();

  if (updated.length === 0) return c.json({ error: "Session not found" }, 404);
  return c.json({ session: updated[0] });
});

const doNowBody = z.object({
  startAt: z.string().datetime({ offset: true }),
  /** The block currently in the slot, which the replan that follows rebooks. */
  displacing: z.string().optional(),
});

/**
 * "Do this now": a later block takes the current slot, keeping its own length.
 *
 * The Coming up list showed the week's later work with no way to pull any of it forward; a
 * student who wanted to start tomorrow's reading now had to leave Today for the week map and
 * drag. The block it displaces is retired exactly as a replan retires a block it has replaced
 * (`writePlan`, status "moved"): it was not declined, so it is not skipped, and the replan the
 * client runs next books it again and shows where it went. The chosen block is marked accepted
 * so that replan keeps it where the student put it.
 *
 * Only blocks the replan will leave in place are checked for overlap: started, locked, or
 * accepted. Ordinary planned blocks are left out on purpose, since the replan rebuilds them
 * around the new one (see `carryOverSessions` in the planning engine).
 */
sessionsRoute.post("/work-sessions/:id/do-now", async (c) => {
  const db = getDb(c.env.DB);
  const parsed = doNowBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const userId = c.get("userId");
  const owned = await loadOwnedSession(db, c.req.param("id"), userId);
  if (!owned) return c.json({ error: "Session not found" }, 404);
  if (owned.session.status !== "planned") return c.json({ error: "That block is not open." }, 409);

  const displaced = parsed.data.displacing
    ? await loadOwnedSession(db, parsed.data.displacing, userId)
    : null;
  if (parsed.data.displacing) {
    if (!displaced || displaced.term.id !== owned.term.id) {
      return c.json({ error: "The block in that slot is not in this term." }, 409);
    }
    if (displaced.session.status !== "planned" || displaced.session.locked) {
      return c.json(
        { error: "The block in that slot is underway or locked, so it cannot be moved aside." },
        409,
      );
    }
  }

  const startAt = parsed.data.startAt;
  const length = Date.parse(owned.session.endAt) - Date.parse(owned.session.startAt);
  const endAt = new Date(Date.parse(startAt) + length).toISOString();
  const taken = [owned.session.id, ...(displaced ? [displaced.session.id] : [])];
  const around = await loadMoveSurroundings(
    db,
    owned.term,
    c.get("timeZone"),
    and(
      inArray(workSessions.status, ["planned", "started"]),
      or(
        eq(workSessions.status, "started"),
        eq(workSessions.locked, true),
        eq(workSessions.acceptedByUser, true),
      ),
      notInArray(workSessions.id, taken),
    )!,
  );
  const conflict = findMoveConflict({ startAt, endAt }, around);
  if (conflict) return c.json({ error: conflict }, 409);

  const writes: BatchItem<"sqlite">[] = [];
  if (displaced) {
    writes.push(
      db.update(workSessions).set({ status: "moved" }).where(eq(workSessions.id, displaced.session.id)),
    );
  }
  const [updated] = await db.batch([
    db
      .update(workSessions)
      .set({ startAt, endAt, acceptedByUser: true })
      .where(eq(workSessions.id, owned.session.id))
      .returning(),
    ...writes,
  ]);
  return c.json({ session: updated[0] });
});

const lockBody = z.object({ locked: z.boolean().optional() });

sessionsRoute.post("/work-sessions/:id/lock", async (c) => {
  const db = getDb(c.env.DB);
  if (!(await loadOwnedSession(db, c.req.param("id"), c.get("userId")))) {
    return c.json({ error: "Session not found" }, 404);
  }
  // An empty body still means "lock it"; anything sent has to be the right shape.
  const parsed = lockBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const locked = parsed.data.locked !== false;

  const updated = await db
    .update(workSessions)
    .set({ locked, acceptedByUser: locked || undefined })
    .where(eq(workSessions.id, c.req.param("id")))
    .returning();

  if (updated.length === 0) return c.json({ error: "Session not found" }, 404);
  return c.json({ session: updated[0] });
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * "Today is not going to happen."
 *
 * Losing a day used to mean skipping its blocks one at a time from the hero card, which only
 * ever showed the first of them. This marks every block still open on that day as skipped,
 * exactly as the skip route does per block, and returns how many; the client then replans
 * and shows what moved. Nothing is deleted and nothing about the day's finished blocks
 * changes.
 */
sessionsRoute.post("/terms/:termId/days/:date/lost", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  const date = isoDate.safeParse(c.req.param("date"));
  if (!date.success) return c.json({ error: "The day has to be a date like 2026-09-08." }, 400);
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const courseIds = (
    await db.select({ id: courses.id }).from(courses).where(eq(courses.termId, termId))
  ).map((x) => x.id);
  if (courseIds.length === 0) return c.json({ skipped: 0 });

  // The student's day, from their midnight to the next, as UTC instants.
  const timeZone = c.get("timeZone");
  const calendar = zoneCalendar(timeZone);
  const dayStart = fromEpochMinutes(calendar.dayStart(date.data));
  const dayEnd = fromEpochMinutes(calendar.dayStart(addDays(date.data, 1)));
  const candidates = await db
    .select({ id: workSessions.id, startAt: workSessions.startAt, status: workSessions.status })
    .from(workSessions)
    .innerJoin(workItems, eq(workItems.id, workSessions.workItemId))
    .where(
      and(
        inArray(workItems.courseId, courseIds),
        gte(workSessions.startAt, dayStart),
        lt(workSessions.startAt, dayEnd),
      ),
    );
  const ids = candidates.filter((s) => isOpenOnDay(s, date.data, timeZone)).map((s) => s.id);

  for (let i = 0; i < ids.length; i += 50) {
    await db
      .update(workSessions)
      .set({ status: "skipped", outcomeCode: "did_not_start" })
      .where(inArray(workSessions.id, ids.slice(i, i + 50)));
  }

  return c.json({ skipped: ids.length });
});

sessionsRoute.post("/work-sessions/:id/skip", async (c) => {
  const db = getDb(c.env.DB);
  if (!(await loadOwnedSession(db, c.req.param("id"), c.get("userId")))) {
    return c.json({ error: "Session not found" }, 404);
  }

  const updated = await db
    .update(workSessions)
    .set({ status: "skipped", outcomeCode: "did_not_start" })
    .where(eq(workSessions.id, c.req.param("id")))
    .returning();

  if (updated.length === 0) return c.json({ error: "Session not found" }, 404);
  return c.json({ session: updated[0] });
});
