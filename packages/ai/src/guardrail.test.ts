import { describe, expect, it, vi } from "vitest";
import { guardMessage, prefilter, type GuardVerdict } from "./guardrail.js";
import type { AiProvider } from "./provider.js";

/** A provider that always returns the label it was constructed with, and remembers what it was asked. */
function stubProvider(label: GuardVerdict): AiProvider & { calls: number; systemPrompt: string } {
  const provider = {
    calls: 0,
    /** The classifier instructions of the last call, so a test can assert what the gate was told. */
    systemPrompt: "",
    name: "stub",
    defaultModel: "stub",
    async complete(request: { messages: { role: string; content: string }[] }) {
      provider.calls++;
      provider.systemPrompt =
        request.messages.find((m) => m.role === "system")?.content ?? "";
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

describe("gaps found by end-to-end testing", () => {
  it("refuses 'write my history research paper for me' without a model call", () => {
    // Slipped past the original pattern: "history research" sat between the possessive
    // and "paper", and only articles were allowed there.
    expect(prefilter("write my history research paper for me")?.verdict).toBe("DO_MY_WORK");
    expect(prefilter("write my biology lab report")?.verdict).toBe("DO_MY_WORK");
    expect(prefilter("do this problem set for me")?.verdict).toBe("DO_MY_WORK");
  });

  it("lets a scheduling question that mentions the work go to the classifier", () => {
    // "when should I write my essay" is a planning question. The widened patterns match
    // its noun phrase, so the interrogative opener must route it onward instead of
    // refusing a legitimate question.
    expect(prefilter("When should I write my history paper?")).toBeNull();
    expect(prefilter("How long will my lab report take?")?.verdict).toBe("ALLOW");
  });

  it("still refuses the imperative form with a deadline attached", () => {
    expect(prefilter("write my essay, it's due Friday")?.verdict).toBe("DO_MY_WORK");
  });
});

/**
 * The bug these guard: a student asking what a button does was refused twice over. The
 * classifier read an app question as OFF_TOPIC ("anything else", and "when torn, choose
 * OFF_TOPIC"), and "explain the difference between skip and delete" never reached it at all --
 * `explain the` is one of the do-my-work patterns, so the prefilter refused a question about two
 * buttons as a request to explain a reading.
 *
 * It matters more here than the usual help-text case: four controls decline four different
 * things, and "Not doing it" on work the student meant to postpone drops it from the term while
 * "Delete" cannot be undone at all. The coach is the only place in the product that can answer.
 */
describe("prefilter: questions about the app are answered, not refused", () => {
  const named = [
    "where do I put back something I marked not doing it",
    "what does not doing it do",
    "what does show finished and canceled too do",
    "what does this app do with a skipped block",
  ];

  for (const message of named) {
    it(`allows without a model call: "${message}"`, () => {
      // Each names something only this app has -- a control, or the app itself -- so no
      // classifier is needed to know what is being asked about.
      expect(prefilter(message)?.verdict).toBe("ALLOW");
    });
  }

  const ambiguous = [
    "what does skip mean?",
    "what's the difference between skip and delete?",
    "explain the difference between skip and delete",
    "explain the assignments tab",
    "what does the delete button do",
    "how do I delete an assignment",
    "can I undo a delete",
  ];

  for (const message of ambiguous) {
    it(`sends to the classifier rather than refusing: "${message}"`, () => {
      // The point is what does NOT happen. `explain the` is a do-my-work pattern, so before this
      // path existed the third of these was refused as a request to explain a reading and never
      // reached a model at all.
      expect(prefilter(message)).toBeNull();
    });
  }

  it("does not hand a coursework question a deterministic allow", () => {
    // Two review passes fed this list: the first three borrow an action word, the last two borrow
    // a whole control name. Neither kind may settle the question on its own.
    // Review's finding, and not a contrived one: this is how a computing student talks. Treating
    // "delete" and "skip" as app words outright answered these with instructions for the
    // assignments table.
    for (const message of [
      "How do I delete a node from a binary tree?",
      "What does delete mean in C++?",
      "how do i skip a line in python",
      "How do I put back an item I popped from a stack?",
      "How do I mark done a node in my traversal?",
      "What is a tab character in Python?",
      "What does click mean in JavaScript?",
      "How do I remove a button in React?",
      "how do i delete a tab in my swing app",
    ]) {
      expect(prefilter(message)?.verdict).not.toBe("ALLOW");
    }
  });

  it("lets the classifier refuse coursework that borrows an app word", () => {
    // The prefilter holding its verdict is only half of it; the gate still has to close.
    const provider = stubProvider("DO_MY_WORK");
    return guardMessage("How do I delete a node from a binary tree?", provider).then((decision) => {
      expect(decision.verdict).toBe("DO_MY_WORK");
      expect(decision.refusal).toBeTruthy();
    });
  });

  it("does not become a door for the coursework", () => {
    // No app word at all: every one of these still lands on DO_MY_WORK exactly as before.
    for (const message of [
      "explain the chapter to me",
      "summarize this reading",
      "check my answers",
      "solve these problems for me",
      "explain the reading and tell me what it means",
    ]) {
      expect(prefilter(message)?.verdict).toBe("DO_MY_WORK");
    }
  });

  it("still refuses a do-my-work request that only mentions coursework nouns", () => {
    expect(prefilter("write my essay question response")?.verdict).toBe("DO_MY_WORK");
  });
});

describe("classifier: the app is in scope", () => {
  it("tells the classifier that how-the-app-works is ALLOW, not OFF_TOPIC", async () => {
    // The classifier prompt is the layer that catches phrasings the prefilter has no pattern
    // for ("is there a way to get rid of an assignment I typed in twice?"). Without this line
    // its own instruction -- "when torn between ALLOW and OFF_TOPIC, choose OFF_TOPIC" -- sends
    // every such question to a refusal.
    const provider = stubProvider("ALLOW");
    await guardMessage("is there a way to get rid of an assignment I typed twice", provider);

    expect(provider.calls).toBe(1);
    expect(provider.systemPrompt).toMatch(/about the planning app itself/i);
    expect(provider.systemPrompt).toMatch(/not off-topic; it is ALLOW/i);
  });
});
