import { Hono } from "hono";
import { and, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";
import { newId, outcomeCode } from "@schoolquest/domain";
import { auditEvents, courses, terms, workItems, workSessions } from "../db/schema.js";
import { getDb, type Db } from "../db/repo.js";
import type { AppBindings } from "../env.js";

export const sessionsRoute = new Hono<AppBindings>();

/**
 * Loads a session only if it belongs to this user, walking
 * session -> work item -> course -> term -> user in a single join.
 *
 * Every mutating route below goes through this. Without it, a session id from another
 * account would be editable by anyone who guessed it.
 */
async function loadOwnedSession(db: Db, sessionId: string, userId: string) {
  const [row] = await db
    .select({ session: workSessions, item: workItems })
    .from(workSessions)
    .innerJoin(workItems, eq(workItems.id, workSessions.workItemId))
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(workSessions.id, sessionId), eq(terms.userId, userId)));

  return row ?? null;
}

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

  let remaining: number | null = item.remainingMinutes;
  if (parsed.data.remainingMinutes !== undefined) {
    remaining = parsed.data.remainingMinutes;
  } else if (parsed.data.outcome === "completed") {
    remaining = 0;
  } else if (parsed.data.outcome === "did_not_start") {
    remaining = item.remainingMinutes; // Nothing happened; effort is unchanged.
  } else if (remaining !== null) {
    remaining = Math.max(0, remaining - actualMinutes);
  }

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
  if (itemStatus === "completed" && item.parentWorkItemId) {
    const siblings = await db
      .select({ id: workItems.id, status: workItems.status })
      .from(workItems)
      .where(eq(workItems.parentWorkItemId, item.parentWorkItemId));
    const allDone = siblings.every(
      (s) => s.id === item.id || s.status === "completed" || s.status === "submitted",
    );
    if (allDone) {
      await db
        .update(workItems)
        .set({ status: "completed", remainingMinutes: 0 })
        .where(eq(workItems.id, item.parentWorkItemId));
    }
  }

  // Finishing the work frees every block still held for it. Without this the interface
  // told the truth and lied in the same breath: it announced an assignment complete while
  // the forecast directly below went on listing three more sessions of it, and the claim
  // that the week redraws itself around what is left was visibly false.
  let releasedSessions = 0;
  if (itemStatus === "completed") {
    const released = await db
      .update(workSessions)
      .set({ status: "released" })
      .where(
        and(
          eq(workSessions.workItemId, item.id),
          eq(workSessions.status, "planned"),
          ne(workSessions.id, id),
          // Only time that is still ahead. Releasing means "this time is yours again", which
          // is a statement about the future — yesterday cannot be given back. Without the
          // bound, finishing a paper today rewrote every block the plan had held for it in
          // weeks gone by, and the record of what those hours actually did was gone. The
          // weekly review reads exactly that record, and a Tuesday afternoon that had plainly
          // not been used disappeared out of it the moment an unrelated item was ticked off.
          gt(workSessions.startAt, new Date().toISOString()),
        ),
      )
      .returning({ id: workSessions.id });
    releasedSessions = released.length;
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

sessionsRoute.post("/work-sessions/:id/move", async (c) => {
  const db = getDb(c.env.DB);
  const parsed = moveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  if (parsed.data.endAt <= parsed.data.startAt) {
    return c.json({ error: "A session must end after it starts." }, 400);
  }
  if (!(await loadOwnedSession(db, c.req.param("id"), c.get("userId")))) {
    return c.json({ error: "Session not found" }, 404);
  }

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

sessionsRoute.post("/work-sessions/:id/lock", async (c) => {
  const db = getDb(c.env.DB);
  if (!(await loadOwnedSession(db, c.req.param("id"), c.get("userId")))) {
    return c.json({ error: "Session not found" }, 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as { locked?: boolean };
  const locked = body.locked !== false;

  const updated = await db
    .update(workSessions)
    .set({ locked, acceptedByUser: locked || undefined })
    .where(eq(workSessions.id, c.req.param("id")))
    .returning();

  if (updated.length === 0) return c.json({ error: "Session not found" }, 404);
  return c.json({ session: updated[0] });
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
