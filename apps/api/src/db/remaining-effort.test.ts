import { describe, expect, it } from "vitest";
import { remainingAfterOutcome } from "./remaining-effort.js";

const base = { remainingMinutes: 60, estimatedMinutes: 60, actualMinutes: 60, plannedMinutes: 60 };

describe("remainingAfterOutcome", () => {
  it('never finishes work the student said needs more time', () => {
    // The live failure: a 60-minute assignment, one 60-minute block, "Needs more time".
    expect(remainingAfterOutcome({ ...base, outcome: "needs_another_session" })).toBe(60);
    expect(remainingAfterOutcome({ ...base, outcome: "partially_completed" })).toBe(60);
    expect(remainingAfterOutcome({ ...base, outcome: "blocked_missing_info" })).toBe(60);
  });

  it("asks for one more block like the last when the estimate has run out", () => {
    expect(
      remainingAfterOutcome({ ...base, outcome: "needs_another_session", remainingMinutes: 30, plannedMinutes: 45, actualMinutes: 45 }),
    ).toBe(45);
  });

  it("still counts the minutes worked against what is left", () => {
    expect(remainingAfterOutcome({ ...base, outcome: "needs_another_session", remainingMinutes: 120 })).toBe(60);
    expect(remainingAfterOutcome({ ...base, outcome: "partially_completed", remainingMinutes: null, estimatedMinutes: 90, actualMinutes: 30 })).toBe(60);
  });

  it("finishes on completed, keeps everything on did-not-start, and defers to what the student said", () => {
    expect(remainingAfterOutcome({ ...base, outcome: "completed" })).toBe(0);
    expect(remainingAfterOutcome({ ...base, outcome: "did_not_start", remainingMinutes: 40 })).toBe(40);
    expect(remainingAfterOutcome({ ...base, outcome: "needs_another_session", reported: 0 })).toBe(0);
  });

  it("leaves an item with no figure at all to the planner's defaults", () => {
    expect(
      remainingAfterOutcome({ ...base, outcome: "needs_another_session", remainingMinutes: null, estimatedMinutes: null }),
    ).toBeNull();
  });
});
