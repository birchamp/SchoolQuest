import { describe, expect, it } from "vitest";
import { generatePlan, seedPlanningInput } from "@schoolquest/planning-engine";
import { buildCoachContext } from "./context.js";
import { runCoach, buildCoachSystemPrompt } from "./coach.js";
import { pruneInvalidActions } from "./actions.js";
import type { AiProvider, CompletionRequest } from "./provider.js";

const input = seedPlanningInput();
const plan = generatePlan(input, "plan_test");
const context = buildCoachContext({
  now: input.now,
  timezone: "America/New_York",
  plan,
  workItems: input.workItems,
  courses: input.courses,
  standings: input.courseStandings,
});

/**
 * Returns the guard label for the classifier call and the coach payload for the coach
 * call, so a whole turn can be exercised without a network.
 */
function scriptedProvider(options: { guard?: string; coach?: unknown }) {
  const requests: CompletionRequest[] = [];
  const provider: AiProvider = {
    name: "scripted",
    defaultModel: "scripted",
    async complete(request) {
      requests.push(request);
      const isGuard = request.jsonSchema?.name === "topic_verdict";
      return {
        text: isGuard
          ? JSON.stringify({ label: options.guard ?? "ALLOW" })
          : JSON.stringify(options.coach ?? { message: "ok", facts: [], assumptions: [], actions: [] }),
        model: "scripted",
        usage: { promptTokens: 10, completionTokens: 10 },
      };
    },
  };
  return { provider, requests };
}

describe("plan context", () => {
  it("includes the recommendation, its reason, and real session ids", () => {
    expect(context.text).toContain("RECOMMENDED NEXT ACTIONS");
    const first = plan.recommendations[0]!;
    expect(context.text).toContain(first.sessionId);
    expect(context.text).toContain(first.title);
    // Reasons arrive as sentences from the reason-code table, not raw codes.
    expect(context.text).toMatch(/Why: .*[a-z]{4}/);
  });

  it("shows what is protected later, which is half the product promise", () => {
    expect(context.text).toContain("REST OF THE WEEK");
    expect(context.text).toContain("CAPACITY THIS WEEK");
  });

  it("marks course standing as opportunity, never as judgement", () => {
    expect(context.text).toContain("COURSE STANDING");
    expect(context.text).toMatch(/still ahead|not enough graded/);
    expect(context.text.toLowerCase()).not.toMatch(/you are bad|weak student|failing/);
  });

  it("collects the ids the coach is allowed to reference", () => {
    expect(context.sessionIds.size).toBe(plan.sessions.length);
    expect(context.workItemIds.has("wi_psych_sources")).toBe(true);
  });
});

describe("system prompt", () => {
  it("states both refusal boundaries", () => {
    const prompt = buildCoachSystemPrompt("plain");
    expect(prompt).toMatch(/do not do the coursework/i);
    expect(prompt).toMatch(/unrelated to their academic work/i);
    expect(prompt).toMatch(/redirect/i);
  });

  it("carries the theme through without making instructions depend on it", () => {
    expect(buildCoachSystemPrompt("quest")).toContain('"quest" theme');
    expect(buildCoachSystemPrompt("quest")).toMatch(/understandable without the metaphor/i);
  });

  it("tells the model that plan context is data, not instructions", () => {
    expect(buildCoachSystemPrompt("plain")).toMatch(/injection/i);
  });

  it("gives the quest theme a guide's voice and forbids theatrics", () => {
    const prompt = buildCoachSystemPrompt("quest");
    expect(prompt).toMatch(/the Guide/);
    expect(prompt).toMatch(/never theatrical/i);
    // The metaphor is decoration, so it must never be the only place a fact lives.
    expect(prompt).toMatch(/decorates and never carries\s+meaning/i);
  });

  it("keeps the plain theme free of metaphor in every theme", () => {
    const plain = buildCoachSystemPrompt("plain");
    for (const word of ["questline", "campaign", "encounter", "XP", "sortie", "handler"]) {
      expect(plain).not.toContain(word);
    }
  });

  it("never lets a theme voice loosen a refusal", () => {
    // Every theme must still carry both boundaries and the no-guilt tone rule; a voice
    // block that talked the model out of refusing would be a product-level regression.
    for (const theme of ["plain", "quest", "mission"] as const) {
      const prompt = buildCoachSystemPrompt(theme);
      expect(prompt).toMatch(/do not do the coursework/i);
      expect(prompt).toMatch(/unrelated to their academic work/i);
      expect(prompt).toMatch(/no streak language/i);
    }
  });
});

describe("runCoach", () => {
  it("answers a planning question using the plan", async () => {
    const { provider, requests } = scriptedProvider({
      coach: {
        message: "Start with psychology sources — it unlocks the outline.",
        facts: ["The paper is worth 250 points."],
        assumptions: [],
        actions: [
          {
            type: "START_SESSION",
            label: "Start 45 minutes",
            payload: { sessionId: plan.recommendations[0]!.sessionId },
          },
        ],
      },
    });

    const result = await runCoach(provider, {
      message: "What should I work on now?",
      context,
      theme: "plain",
    });

    expect(result.usedModel).toBe(true);
    expect(result.reply.actions).toHaveLength(1);
    // The prefilter handled the guard, so only the coach call was made.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages[1]!.content).toContain("PLAN CONTEXT");
  });

  it("refuses a homework request without ever calling the coach model", async () => {
    const { provider, requests } = scriptedProvider({});
    const result = await runCoach(provider, {
      message: "Write my essay on cognitive development",
      context,
      theme: "plain",
    });

    expect(result.usedModel).toBe(false);
    expect(requests).toHaveLength(0); // No model spend at all on a refused turn.
    expect(result.guard.verdict).toBe("DO_MY_WORK");
    // The refusal declines the work and names the planning help it can give instead.
    expect(result.reply.message).toMatch(/\bnot\b/i);
    expect(result.reply.message).toMatch(/step|when|plan|break|time/i);
    // A refusal still offers the planning path forward.
    expect(result.reply.actions.length).toBeGreaterThan(0);
  });

  it("refuses an off-topic question and redirects to the week", async () => {
    const { provider } = scriptedProvider({ guard: "OFF_TOPIC" });
    const result = await runCoach(provider, {
      message: "what is the capital of Peru",
      context,
      theme: "plain",
    });

    expect(result.usedModel).toBe(false);
    expect(result.reply.actions.map((a) => a.type)).toContain("SHOW_WEEK");
  });

  it("offers no cheerful action buttons on a distress message", async () => {
    const { provider } = scriptedProvider({});
    const result = await runCoach(provider, {
      message: "I want to kill myself",
      context,
      theme: "plain",
    });
    expect(result.reply.actions).toHaveLength(0);
    expect(result.reply.message).toContain("988");
  });

  it("drops actions that reference ids the student does not have", async () => {
    const { provider } = scriptedProvider({
      coach: {
        message: "Try this instead.",
        facts: [],
        assumptions: [],
        actions: [
          { type: "START_SESSION", label: "Start", payload: { sessionId: "ws_hallucinated" } },
          {
            type: "START_SESSION",
            label: "Start real one",
            payload: { sessionId: plan.sessions[0]!.id },
          },
        ],
      },
    });

    const result = await runCoach(provider, {
      message: "what should I do now",
      context,
      theme: "plain",
    });
    expect(result.reply.actions).toHaveLength(1);
    expect(result.reply.actions[0]!.label).toBe("Start real one");
  });

  it("falls back to plain text when the model returns unparseable output", async () => {
    const provider: AiProvider = {
      name: "messy",
      defaultModel: "messy",
      async complete() {
        return {
          text: "Start with your psychology sources.",
          model: "messy",
          usage: { promptTokens: 1, completionTokens: 1 },
        };
      },
    };

    const result = await runCoach(provider, {
      message: "what should I do now",
      context,
      theme: "plain",
    });
    expect(result.reply.message).toBe("Start with your psychology sources.");
  });
});

describe("action pruning", () => {
  const known = { sessionIds: new Set(["ws_1"]), workItemIds: new Set(["wi_1"]) };

  it("requires a session id for session actions", () => {
    expect(
      pruneInvalidActions([{ type: "START_SESSION", label: "Start", payload: {} }], known),
    ).toHaveLength(0);
  });

  it("keeps actions that need no target", () => {
    expect(
      pruneInvalidActions([{ type: "SHOW_WEEK", label: "Show week", payload: {} }], known),
    ).toHaveLength(1);
  });
});
