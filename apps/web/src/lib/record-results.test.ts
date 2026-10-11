import { describe, expect, it } from "vitest";
import type { WorkItem } from "@schoolquest/domain";
import { workAwaitingResult } from "./record-results";

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
