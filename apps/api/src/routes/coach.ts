import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { fromEpochMinutes, newId, themeName, toEpochMinutes, zoneCalendar } from "@schoolquest/domain";
import {
  AiProviderError,
  buildCoachContext,
  createOpenRouterProvider,
  runCoach,
} from "@schoolquest/ai";
import { generatePlan } from "@schoolquest/planning-engine";
import { coachMessages, users } from "../db/schema.js";
import { assertTermOwner, getDb, loadTermSnapshot, toPlanningInput } from "../db/repo.js";
import { loadReview } from "./review.js";
import { studentZone } from "../student-zone.js";
import { NO_COACH_PROVIDER_MESSAGE, providerForUser } from "../provider-for-user.js";
import { rateLimitPerUser } from "../rate-limit.js";
import type { AppBindings } from "../env.js";

const messageBody = z.object({
  termId: z.string(),
  message: z.string().min(1).max(2000),
  theme: themeName.optional(),
});

export const coachRoute = new Hono<AppBindings>();

/**
 * One coach turn.
 *
 * The plan is regenerated in-memory rather than read from the last saved version, so the
 * coach always answers against the student's real current state. It is a pure function
 * over data we already hold, so this costs no extra model call.
 */
coachRoute.post("/coach/messages", rateLimitPerUser("coach"), async (c) => {
  const parsed = messageBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const userId = c.get("userId");
  const db = getDb(c.env.DB);
  if (!(await assertTermOwner(db, parsed.data.termId, userId))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const resolved = await providerForUser(db, c.env, userId);
  if (!resolved.apiKey) return c.json({ error: NO_COACH_PROVIDER_MESSAGE }, 503);

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const theme = parsed.data.theme ?? (user?.theme as "quest" | "mission" | "plain") ?? "plain";

  const now = new Date().toISOString();
  const timeZone = await studentZone(db, userId);
  const calendar = zoneCalendar(timeZone);
  const horizonStart = calendar.dateOf(toEpochMinutes(now));
  const snapshot = await loadTermSnapshot(db, parsed.data.termId, {
    sessionsFrom: fromEpochMinutes(calendar.dayStart(horizonStart)),
  });
  const plan = generatePlan(
    toPlanningInput(parsed.data.termId, snapshot, { horizonStart, horizonDays: 7, now, timeZone }),
    "plan_preview",
  );

  const context = buildCoachContext({
    now,
    timezone: timeZone,
    plan,
    workItems: snapshot.workItems,
    courses: snapshot.courses,
    standings: snapshot.standings,
    // The coach is the natural place to ask "why does Thursday never work?", and it cannot
    // answer that from a plan alone — the evidence is entirely in the weeks behind it.
    review: await loadReview(db, parsed.data.termId, now, timeZone),
  });

  // Recent turns give continuity; the plan context carries the actual state.
  const history = (
    await db
      .select()
      .from(coachMessages)
      .where(eq(coachMessages.userId, userId))
      .orderBy(desc(coachMessages.createdAt))
      .limit(6)
  )
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const provider = createOpenRouterProvider({
    apiKey: resolved.apiKey,
    defaultModel: resolved.coachModel,
    appUrl: c.env.APP_URL,
    appName: c.env.APP_NAME,
    ...(c.env.OPENROUTER_BASE_URL ? { baseUrl: c.env.OPENROUTER_BASE_URL } : {}),
  });

  let result;
  try {
    result = await runCoach(provider, {
      message: parsed.data.message,
      context,
      theme,
      history,
      guardModel: resolved.guardModel,
    });
  } catch (error) {
    if (error instanceof AiProviderError) {
      // A provider outage is not the student's fault and not a bug in their plan. Say so
      // plainly, and point back at the plan, which still works without the coach.
      console.error("[coach] provider error", error.message);
      return c.json(
        {
          error:
            "The coach is unreachable right now. Your plan is unaffected — Today and the week view still work.",
          retryable: error.retryable,
        },
        502,
      );
    }
    throw error;
  }

  // Persisting the guard verdict is what makes the gate tunable against real traffic.
  await db.insert(coachMessages).values([
    {
      id: newId("coachMessage"),
      userId,
      role: "user",
      content: parsed.data.message,
      guardVerdict: result.guard.verdict,
      actionsJson: "[]",
      createdAt: now,
    },
    {
      id: newId("coachMessage"),
      userId,
      role: "assistant",
      content: result.reply.message,
      guardVerdict: result.guard.verdict,
      actionsJson: JSON.stringify(result.reply.actions),
      createdAt: new Date(Date.now() + 1).toISOString(),
    },
  ]);

  return c.json({
    ...result.reply,
    guardVerdict: result.guard.verdict,
    refused: result.guard.verdict !== "ALLOW",
  });
});

coachRoute.get("/coach/messages", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(coachMessages)
    .where(eq(coachMessages.userId, c.get("userId")))
    .orderBy(desc(coachMessages.createdAt))
    .limit(50);

  return c.json({
    messages: rows.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      actions: JSON.parse(m.actionsJson) as unknown[],
      refused: m.guardVerdict !== null && m.guardVerdict !== "ALLOW",
      createdAt: m.createdAt,
    })),
  });
});
