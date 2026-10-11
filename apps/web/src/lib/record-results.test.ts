import { describe, expect, it } from "vitest";
import type { WorkItem } from "@schoolquest/domain";
import { parseScoreEntry, workAwaitingResult } from "./record-results";

function item(overrides: Partial<WorkItem> & Pick<WorkItem, "id">): WorkItem {
  return {
    courseId: "crs_1",
    parentWorkItemId: null,
    title: overrides.id,
    description: null,
    workType: "quiz",
    availableAt: null,
    dueAt: "2026-09-20T23:59:00.000Z",
    pointsPossible: 20,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: null,
    remainingMinutes: null,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "completed",
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

const now = Date.parse("2026-10-01T12:00:00.000Z");

describe("workAwaitingResult", () => {
  it("leaves out work that already has a result, so a score cannot be overwritten from here", () => {
    const items = [item({ id: "wi_scored" }), item({ id: "wi_open" })];
    const ids = workAwaitingResult(items, "crs_1", new Set(["wi_scored"]), now).map((w) => w.id);
    expect(ids).toEqual(["wi_open"]);
  });

  it("offers only finished, past-due work in this course", () => {
    const items = [
      item({ id: "wi_done" }),
      item({ id: "wi_handed_in", status: "submitted" }),
      item({ id: "wi_unstarted", status: "not_started" }),
      item({ id: "wi_future", dueAt: "2026-10-05T23:59:00.000Z" }),
      item({ id: "wi_undated", dueAt: null }),
      item({ id: "wi_elsewhere", courseId: "crs_2" }),
    ];
    const ids = workAwaitingResult(items, "crs_1", new Set(), now).map((w) => w.id);
    expect(ids).toEqual(["wi_done", "wi_handed_in"]);
  });
});

describe("parseScoreEntry", () => {
  it("falls back to the item's total only when the total box is empty", () => {
    expect(parseScoreEntry({ earned: "8", outOf: "" }, 10)).toEqual({ pointsEarned: 8, pointsPossible: 10 });
    expect(parseScoreEntry({ earned: "18", outOf: "20" }, 10)).toEqual({ pointsEarned: 18, pointsPossible: 20 });
    // A typed 0 is an error, not a request for the fallback.
    expect(parseScoreEntry({ earned: "8", outOf: "0" }, 10)).toBeNull();
  });

  it("never reads an empty score box as a zero", () => {
    expect(parseScoreEntry({ earned: "", outOf: "10" }, 10)).toBeNull();
    expect(parseScoreEntry({ earned: "  ", outOf: "" }, 10)).toBeNull();
    expect(parseScoreEntry(undefined, 10)).toBeNull();
    expect(parseScoreEntry({ earned: "0", outOf: "" }, 10)).toEqual({ pointsEarned: 0, pointsPossible: 10 });
  });

  it("needs a total from somewhere", () => {
    expect(parseScoreEntry({ earned: "8", outOf: "" }, null)).toBeNull();
    expect(parseScoreEntry({ earned: "abc", outOf: "10" }, 10)).toBeNull();
  });
});
