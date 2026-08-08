import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { newId, toEpochMinutes } from "@schoolquest/domain";
import {
  buildSessionBrief,
  computeCourseHealth,
  computeCourseLoad,
  computeProjectProgress,
  computeTermProgress,
  generatePlan,
  selectRecommendedSessions,
  summarizeProjects,
} from "@schoolquest/planning-engine";
import { explainRecommendation, explainRisk, explainTradeoff } from "@schoolquest/theme-language";
import { planVersions, workSessions } from "../db/schema.js";
import {
  assertTermOwner,
  getDb,
  insertInChunks,
  loadEffortTotals,
  loadTermSnapshot,
  toPlanningInput,
} from "../db/repo.js";
import { loadReview } from "./review.js";
import type { AppBindings } from "../env.js";

const generateBody = z.object({
  horizonStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  horizonDays: z.number().int().min(1).max(28).default(7),
  reason: z.string().default("weekly_refresh"),
  /** When false, the plan is rebuilt from scratch, ignoring previously accepted blocks. */
  preserveAcceptedSessions: z.boolean().default(true),
  /**
   * The moment to plan from. **Honoured only in local development**, and ignored outright once
   * a mail provider is configured — the same signal that decides whether magic links are echoed
   * back instead of emailed.
   *
   * It exists because the planning engine takes `now` as a parameter everywhere, by design and
   * at some cost, precisely so a whole term can be simulated — and the API then read the wall
   * clock, which made every one of those sixteen weeks unreachable through the real routes. A
   * full-term run against this Worker returned an empty plan and 126 at-risk items on week one,
   * for no reason except that January 2023 is in the past.
   *
   * So the engine could be walked across a term and the API could not, and the difference was
   * invisible: snapshot loading, session carry-over and persistence are only in the API path,
   * and none of them had ever been exercised at any date but today.
   */
  now: z.string().datetime().optional(),
});

export const plansRoute = new Hono<AppBindings>();

/** Rows per INSERT; keeps bound parameters under D1's per-statement ceiling. */
const SESSION_INSERT_BATCH = 8;

/** Ids per UPDATE ... WHERE id IN (...). One bound parameter each, so it can be wider. */
const SUPERSEDE_BATCH = 50;

/**
 * Generates a new plan version.
 *
 * Every generation writes a new PlanVersion rather than mutating the current one, so a
 * plan change is always inspectable and reversible (docs/05-data-model-and-api.md §7).
 */
plansRoute.post("/terms/:termId/plans/generate", async (c) => {
  const termId = c.req.param("termId");
  const db = getDb(c.env.DB);
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = generateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // A client may only move time when this deployment has no way to send mail, which is the
  // definition of local development already used by the login route.
  const timeTravelAllowed = !c.env.RESEND_API_KEY;
  const now =
    timeTravelAllowed && parsed.data.now ? new Date(parsed.data.now).toISOString() : new Date().toISOString();
  const horizonStart = parsed.data.horizonStart ?? now.slice(0, 10);

  const snapshot = await loadTermSnapshot(db, termId, { sessionsFrom: `${horizonStart}T00:00:00Z` });
  const input = toPlanningInput(termId, snapshot, {
    horizonStart,
    horizonDays: parsed.data.horizonDays,
    now,
  });

  if (!parsed.data.preserveAcceptedSessions) input.existingSessions = [];

  const planVersionId = newId("planVersion");
  const plan = generatePlan(input, planVersionId);

  const [latest] = await db
    .select({ versionNumber: planVersions.versionNumber })
    .from(planVersions)
    .where(eq(planVersions.termId, termId))
    .orderBy(desc(planVersions.versionNumber))
    .limit(1);

  await db.insert(planVersions).values({
    id: planVersionId,
    termId,
    versionNumber: (latest?.versionNumber ?? 0) + 1,
    horizonStart: plan.horizonStart,
    horizonEnd: plan.horizonEnd,
    generationReason: parsed.data.reason,
    algorithmVersion: plan.algorithmVersion,
    status: "proposed",
    summaryJson: JSON.stringify({
      capacity: plan.capacity,
      risks: plan.risks,
      unscheduledWorkItemIds: plan.unscheduledWorkItemIds,
      recommendations: plan.recommendations,
      // Time the engine held for meals is part of the plan's reasoning, so it is stored with
      // the plan rather than recomputed on read — the student must be able to see the same
      // day shape the scheduler worked against, not a fresh guess at it.
      meals: plan.meals,
    }),
    createdAt: now,
  });

  // Carried-over sessions keep their original ids; re-inserting them would collide.
  const carriedIds = new Set(snapshot.existingSessions.map((s) => s.id));
  const fresh = plan.sessions.filter((s) => !carriedIds.has(s.id));
  const rows = fresh.map((s) => ({
    id: s.id,
    workItemId: s.workItemId,
    planVersionId,
    startAt: s.startAt,
    endAt: s.endAt,
    status: "planned" as const,
    locked: s.locked,
    acceptedByUser: s.acceptedByUser,
    actualMinutes: null,
    outcomeCode: null,
    reasonCodesJson: JSON.stringify(s.reasonCodes),
    tradeoffCode: s.tradeoffCode,
  }));

  // A full week is easily 20+ sessions; 12 columns each would blow D1's parameter cap.
  await insertInChunks(rows, SESSION_INSERT_BATCH, (batch) =>
    db.insert(workSessions).values(batch),
  );

  // Retire the blocks this plan replaces.
  //
  // Nothing did this before, so every replan left its predecessor's blocks in the table
  // saying "planned" forever. Three generations of one term left 83 live blocks where 26
  // were real. They were counted as time already booked when judging whether a project would
  // fit, and — once the weekly review started reading history — as time the student had let
  // slip. Neither was true: a block replaced by a replan is not a block anyone missed.
  //
  // Only the future is retired. A block whose time has already passed is the record of what
  // was planned for that hour, and superseding today's plan cannot change yesterday.
  const keptIds = new Set(plan.sessions.map((s) => s.id));
  const superseded = snapshot.existingSessions
    .filter((s) => s.status === "planned" && s.startAt >= now && !keptIds.has(s.id))
    .map((s) => s.id);

  await insertInChunks(superseded, SUPERSEDE_BATCH, (batch) =>
    db.update(workSessions).set({ status: "moved" }).where(inArray(workSessions.id, batch)),
  );

  return c.json(serializePlan(plan, snapshot, await loadEffortTotals(db, termId)), 201);
});

/** Returns the most recent plan version, generating one on first use. */
plansRoute.get("/terms/:termId/plans/current", async (c) => {
  const termId = c.req.param("termId");
  const db = getDb(c.env.DB);
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const [current] = await db
    .select()
    .from(planVersions)
    .where(eq(planVersions.termId, termId))
    .orderBy(desc(planVersions.versionNumber))
    .limit(1);

  if (!current) return c.json({ planVersion: null, sessions: [] });

  const sessions = (
    await db.select().from(workSessions).where(eq(workSessions.planVersionId, current.id))
  )
    // Released blocks belonged to work that is already finished. They stay in the table
    // as history but are no longer part of the plan, so the week map and the forecast
    // must not go on drawing them.
    .filter((s) => s.status !== "released");

  const snapshot = await loadTermSnapshot(db, termId);
  const summary = JSON.parse(current.summaryJson) as Record<string, unknown>;

  // Recommendations are recomputed here rather than read out of the plan summary. A plan
  // version is written once and then read for up to a week, so the baked-in list was still
  // naming Monday's blocks on Thursday — and went on naming work the student had already
  // finished. Only sessions still open are eligible, and the same today-else-next-day rule
  // the scheduler uses picks among them.
  const itemsById = new Map(snapshot.workItems.map((w) => [w.id, w]));
  const open = sessions.filter((s) => s.status === "planned" || s.status === "started");
  const recommendations = selectRecommendedSessions(
    open,
    toEpochMinutes(new Date().toISOString()),
  ).map(
    (session, index) => {
      const item = itemsById.get(session.workItemId);
      const reasonCodes = JSON.parse(session.reasonCodesJson) as string[];
      const title = item?.title ?? "Study session";
      return {
        rank: index,
        sessionId: session.id,
        workItemId: session.workItemId,
        title,
        courseId: item?.courseId ?? "",
        durationMinutes: Math.max(
          0,
          Math.round((Date.parse(session.endAt) - Date.parse(session.startAt)) / 60_000),
        ),
        startAt: session.startAt,
        reasonCodes,
        tradeoffCode: session.tradeoffCode,
        explanation: explainRecommendation(title, reasonCodes),
        tradeoff: explainTradeoff(session.tradeoffCode),
      };
    },
  );

  // Where the big things stand. Built from the term's whole session history rather than the
  // current horizon: a long project's story is months of blocks, and "am I going to make it"
  // is a meaningless question inside a seven-day window.
  const effort = await loadEffortTotals(db, termId);
  const minutesOf = (s: { startAt: string; endAt: string; actualMinutes: number | null }) =>
    s.actualMinutes ?? Math.max(0, Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000));
  const projectRows = computeProjectProgress({
    workItems: snapshot.workItems,
    completed: snapshot.existingSessions
      .filter((s) => s.status === "completed" || s.status === "partial")
      .map((s) => ({ workItemId: s.workItemId, endAt: s.endAt, minutes: minutesOf(s) })),
    booked: snapshot.existingSessions
      .filter((s) => s.status === "planned" || s.status === "started")
      .map((s) => ({ workItemId: s.workItemId, minutes: minutesOf(s) })),
    now: new Date().toISOString(),
    // Health claims are measured against the student's real weekly study time, not against
    // how much this horizon happens to hold.
    weeklyCapacityMinutes: isCapacity(summary["capacity"]) ? summary["capacity"].availableMinutes : 0,
  });
  // One pool of time, divided across every course. The division is the decision: a student
  // who cannot see that History already holds four of this week's twelve hours cannot make an
  // informed choice about Biology.
  const courseLoad = computeCourseLoad({
    courseIds: snapshot.courses.map((course) => course.id),
    workItems: snapshot.workItems,
    // This week's blocks, not the term's — the share being divided is the current plan.
    booked: open.map((s) => ({ workItemId: s.workItemId, minutes: minutesOf(s) })),
    completed: snapshot.existingSessions
      .filter((s) => s.status === "completed" || s.status === "partial")
      .map((s) => ({ workItemId: s.workItemId, endAt: s.endAt, minutes: minutesOf(s) })),
    capacityMinutes: isCapacity(summary["capacity"]) ? summary["capacity"].availableMinutes : 0,
    now: new Date().toISOString(),
  });

  // Which class needs me? Folded together here rather than on the client because it draws on
  // five separate derivations, and a client assembling them itself would be free to disagree
  // with the screens each one already feeds.
  const health = computeCourseHealth({
    courses: snapshot.courses,
    workItems: snapshot.workItems,
    grades: snapshot.grades,
    gradingCategories: snapshot.gradingCategories,
    standings: snapshot.standings,
    load: courseLoad.courses,
    projects: projectRows,
    now: new Date().toISOString(),
  });

  const projects = {
    rows: projectRows,
    summary: summarizeProjects(projectRows, {
      investedMinutes: effort.effortMinutes,
      sessionsCompleted: effort.sessionsCompleted,
    }),
  };

  return c.json({
    planVersion: {
      id: current.id,
      versionNumber: current.versionNumber,
      horizonStart: current.horizonStart,
      horizonEnd: current.horizonEnd,
      status: current.status,
      createdAt: current.createdAt,
    },
    ...summary,
    recommendations,
    // The week read as prepared session notes rather than a grid (see
    // docs/07-session-prep-design.md). Milestones are drawn from every work item in the
    // term, not just this horizon — the whole point is seeing the exam that is three weeks
    // out — while the day shape and the contingencies are about the seven days on screen.
    brief: buildSessionBrief({
      sessions: sessions.map((s) => ({
        id: s.id,
        workItemId: s.workItemId,
        startAt: s.startAt,
        minutes: Math.max(
          0,
          Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000),
        ),
      })),
      workItems: snapshot.workItems,
      now: new Date().toISOString(),
      horizonStart: current.horizonStart,
      horizonDays: 7,
      ...(isCapacity(summary["capacity"])
        ? {
            slackMinutes: Math.max(
              0,
              summary["capacity"].availableMinutes - summary["capacity"].usedMinutes,
            ),
          }
        : {}),
    }),
    projects,
    courseLoad,
    health,
    // What the weeks that already happened have to say about the week being planned. Asked
    // here rather than on its own screen because the answer changes the plan, and a question
    // the student has to go looking for is a question nobody answers.
    review: await loadReview(db, termId),
    sessions: sessions.map((s) => ({
      ...s,
      reasonCodes: JSON.parse(s.reasonCodesJson) as string[],
    })),
    courses: snapshot.courses,
    workItems: snapshot.workItems,
    standings: snapshot.standings,
    // The rest of the week: classes, shifts, and the hours the student said they are free.
    // Study blocks alone cannot answer "where does my time actually go" — a calendar showing
    // only what the planner booked leaves the other five-sixths of the week blank, which
    // reads as free time the student does not have.
    meetingPatterns: snapshot.meetingPatterns,
    commitments: snapshot.commitments,
    availabilityRules: snapshot.availabilityRules,
    progress: {
      ...computeTermProgress(
        snapshot.courses.map((course) => course.id),
        snapshot.workItems,
      ),
      ...effort,
    },
  });
});

plansRoute.post("/plans/:planId/accept", async (c) => {
  const db = getDb(c.env.DB);
  const planId = c.req.param("planId");

  const [plan] = await db.select().from(planVersions).where(eq(planVersions.id, planId));
  if (!plan || !(await assertTermOwner(db, plan.termId, c.get("userId")))) {
    return c.json({ error: "Plan not found" }, 404);
  }

  await db.update(planVersions).set({ status: "accepted" }).where(eq(planVersions.id, planId));
  // Accepting the plan raises every block's movement cost on the next replan.
  await db
    .update(workSessions)
    .set({ acceptedByUser: true })
    .where(and(eq(workSessions.planVersionId, planId), eq(workSessions.status, "planned")));

  return c.json({ ok: true });
});

/**
 * The plan summary is stored as JSON, so its shape is only as trustworthy as the version
 * that wrote it. Checking rather than casting means an older summary yields a brief without
 * a slack line instead of `NaN minutes of slack`.
 */
function isCapacity(value: unknown): value is { availableMinutes: number; usedMinutes: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { availableMinutes?: unknown }).availableMinutes === "number" &&
    typeof (value as { usedMinutes?: unknown }).usedMinutes === "number"
  );
}

/** Attaches the human-readable explanation to every recommendation and risk. */
function serializePlan(
  plan: ReturnType<typeof generatePlan>,
  snapshot: Awaited<ReturnType<typeof loadTermSnapshot>>,
  effort: Awaited<ReturnType<typeof loadEffortTotals>>,
) {
  return {
    planVersionId: plan.planVersionId,
    horizonStart: plan.horizonStart,
    horizonEnd: plan.horizonEnd,
    capacity: plan.capacity,
    sessions: plan.sessions,
    meals: plan.meals,
    recommendations: plan.recommendations.map((r) => ({
      ...r,
      explanation: explainRecommendation(r.title, r.reasonCodes),
      tradeoff: explainTradeoff(r.tradeoffCode),
    })),
    risks: plan.risks.map((r) => ({ ...r, explanation: explainRisk(r.code) })),
    unscheduledWorkItemIds: plan.unscheduledWorkItemIds,
    courses: snapshot.courses,
    workItems: snapshot.workItems,
    standings: snapshot.standings,
    // Progress is derived, never stored: it is recomputed from work-item status on every
    // read so it can never drift from the truth the student sees elsewhere. Effort comes
    // from the sessions table rather than the engine, which is only ever handed the
    // sessions inside the current horizon.
    progress: {
      ...computeTermProgress(
        snapshot.courses.map((course) => course.id),
        snapshot.workItems,
      ),
      ...effort,
    },
  };
}
