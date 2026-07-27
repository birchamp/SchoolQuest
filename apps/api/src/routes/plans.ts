import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@schoolquest/domain";
import { generatePlan } from "@schoolquest/planning-engine";
import { explainRecommendation, explainRisk, explainTradeoff } from "@schoolquest/theme-language";
import { planVersions, workSessions } from "../db/schema.js";
import {
  assertTermOwner,
  getDb,
  insertInChunks,
  loadTermSnapshot,
  toPlanningInput,
} from "../db/repo.js";
import type { AppBindings } from "../env.js";

const generateBody = z.object({
  horizonStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  horizonDays: z.number().int().min(1).max(28).default(7),
  reason: z.string().default("weekly_refresh"),
  /** When false, the plan is rebuilt from scratch, ignoring previously accepted blocks. */
  preserveAcceptedSessions: z.boolean().default(true),
});

export const plansRoute = new Hono<AppBindings>();

/** Rows per INSERT; keeps bound parameters under D1's per-statement ceiling. */
const SESSION_INSERT_BATCH = 8;

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

  const now = new Date().toISOString();
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

  return c.json(serializePlan(plan, snapshot), 201);
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

  const sessions = await db
    .select()
    .from(workSessions)
    .where(eq(workSessions.planVersionId, current.id));

  const snapshot = await loadTermSnapshot(db, termId);
  const summary = JSON.parse(current.summaryJson) as Record<string, unknown>;

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
    sessions: sessions.map((s) => ({
      ...s,
      reasonCodes: JSON.parse(s.reasonCodesJson) as string[],
    })),
    courses: snapshot.courses,
    workItems: snapshot.workItems,
    standings: snapshot.standings,
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

/** Attaches the human-readable explanation to every recommendation and risk. */
function serializePlan(
  plan: ReturnType<typeof generatePlan>,
  snapshot: Awaited<ReturnType<typeof loadTermSnapshot>>,
) {
  return {
    planVersionId: plan.planVersionId,
    horizonStart: plan.horizonStart,
    horizonEnd: plan.horizonEnd,
    capacity: plan.capacity,
    sessions: plan.sessions,
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
  };
}
