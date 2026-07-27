import { describe, expect, it, vi } from "vitest";
import { guardMessage, prefilter, type GuardVerdict } from "./guardrail.js";
import type { AiProvider } from "./provider.js";

/** A provider that always returns the label it was constructed with. */
function stubProvider(label: GuardVerdict): AiProvider & { calls: number } {
  const provider = {
    calls: 0,
    name: "stub",
    defaultModel: "stub",
    async complete() {
      provider.calls++;
      return {
        text: JSON.stringify({ label }),
        model: "stub",
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    },
  };
  return provider;
}

describe("prefilter: planning questions are allowed without a model call", () => {
  const allowed = [
    "What should I work on now?",
    "what should i do first today",
    "I only have 25 minutes, what fits?",
    "I missed yesterday. Fix my week.",
    "Why is this more important than my reading?",
    "Break this assignment into smaller steps",
    "What happens if I move this to Friday?",
    "when is my psych paper due",
    "I'm falling behind, help me catch up",
    "how long will the outline take",
    "reschedule my week, my shift changed",
  ];

  for (const message of allowed) {
    it(`allows: "${message}"`, () => {
      expect(prefilter(message)?.verdict).toBe("ALLOW");
    });
  }
});

describe("prefilter: requests to do the coursework are refused", () => {
  const refused = [
    "Write my essay on cognitive development",
    "write me a paragraph about Piaget",
    "solve these problems for me",
    "do my homework",
    "what's the answer to question 3",
    "check my answers please",
    "summarize this reading",
    "explain the chapter to me",
    "proofread my paper",
    "write the code for my lab",
  ];

  for (const message of refused) {
    it(`refuses: "${message}"`, () => {
      const decision = prefilter(message);
      expect(decision?.verdict).toBe("DO_MY_WORK");
      expect(decision?.refusal).toBeTruthy();
    });
  }

  it("refuses to write the essay even when the message mentions a deadline", () => {
    // Planning vocabulary must not be a loophole for a do-the-work request.
    expect(prefilter("write my essay, it's due Friday")?.verdict).toBe("DO_MY_WORK");
  });
});

describe("prefilter: distress is handled before anything else", () => {
  it("routes self-harm language to the distress branch, not a study redirect", () => {
    const decision = prefilter("I want to kill myself, and I also have a paper due");
    expect(decision?.verdict).toBe("DISTRESS");
    expect(decision?.refusal).toContain("988");
  });

  it("does not answer distress with prioritization advice", () => {
    const decision = prefilter("honestly I want to die");
    expect(decision?.verdict).toBe("DISTRESS");
    expect(decision?.refusal?.toLowerCase()).not.toContain("prioriti");
  });
});

describe("classifier: ambiguous messages go to the model", () => {
  it("asks the model when the prefilter has no opinion", async () => {
    const provider = stubProvider("OFF_TOPIC");
    const decision = await guardMessage("who won the world series", provider);

    expect(provider.calls).toBe(1);
    expect(decision.verdict).toBe("OFF_TOPIC");
    expect(decision.source).toBe("classifier");
    expect(decision.refusal).toBeTruthy();
  });

  it("does not call the model when the prefilter already decided", async () => {
    const provider = stubProvider("ALLOW");
    await guardMessage("What should I work on now?", provider);
    expect(provider.calls).toBe(0);
  });

  it("turns a DO_MY_WORK verdict into a refusal that offers planning instead", async () => {
    const provider = stubProvider("DO_MY_WORK");
    const decision = await guardMessage("help me with question two", provider);
    expect(decision.verdict).toBe("DO_MY_WORK");
    expect(decision.refusal).toMatch(/plan|step|when|break/i);
  });

  it("fails open when the provider is unavailable, and records that it did", async () => {
    const broken: AiProvider = {
      name: "broken",
      defaultModel: "broken",
      complete: vi.fn().mockRejectedValue(new Error("network down")),
    };
    const decision = await guardMessage("something ambiguous entirely", broken);
    expect(decision.verdict).toBe("ALLOW");
    expect(decision.source).toBe("classifier_failed_open");
  });
});

describe("refusal copy", () => {
  it("always points back at prioritizing work", async () => {
    const provider = stubProvider("OFF_TOPIC");
    const decision = await guardMessage("tell me a joke", provider);
    expect(decision.refusal).toMatch(/work|start|today|next|week|plan/i);
  });

  it("is deterministic for the same message but varies across messages", () => {
    const a = prefilter("write my essay about attachment theory")!.refusal;
    const b = prefilter("write my essay about attachment theory")!.refusal;
    expect(a).toBe(b);

    const variants = new Set(
      [
        "do my homework",
        "solve these problems for me",
        "check my answers please",
        "write me a paragraph about Piaget",
        "summarize this reading",
      ].map((m) => prefilter(m)!.refusal),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it("does not moralize or shame", () => {
    const refusals = ["do my homework", "write my paper for me"].map((m) => prefilter(m)!.refusal!);
    for (const refusal of refusals) {
      expect(refusal.toLowerCase()).not.toMatch(/cheat|dishonest|integrity|should be ashamed|lazy/);
    }
  });
});
