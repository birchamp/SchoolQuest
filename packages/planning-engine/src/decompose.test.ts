import { describe, expect, it } from "vitest";
import { toEpochMinutes, type WorkItem, type WorkStatus, type WorkType } from "@schoolquest/domain";
import { canDecompose, proposeStages } from "./decompose.js";

const FROM = "2026-09-14T09:00:00.000Z";

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_1",
    courseId: "c1",
    parentWorkItemId: null,
    title: "Research Paper",
    description: null,
    workType: "paper" as WorkType,
    availableAt: null,
    dueAt: "2026-10-26T09:00:00.000Z",
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: 600,
    remainingMinutes: 600,
    cognitiveDemand: "high",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "not_started" as WorkStatus,
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

describe("what can be broken down", () => {
  it("takes on anything too big for one sitting", () => {
    expect(canDecompose(item(), 600)).toBe(true);
  });

  it("leaves small work alone — stages would be overhead, not help", () => {
    expect(canDecompose(item(), 45)).toBe(false);
  });

  it("leaves finished and cancelled work alone", () => {
    expect(canDecompose(item({ status: "submitted" }), 600)).toBe(false);
    expect(canDecompose(item({ status: "canceled" }), 600)).toBe(false);
  });
});

describe("proposing stages", () => {
  it("splits the effort exactly, losing nothing to rounding", () => {
    const stages = proposeStages(item(), 600, FROM);
    expect(stages.reduce((sum, s) => sum + s.estimatedMinutes, 0)).toBe(600);
  });

  it("makes the first stage small and early, because starting is the hard part", () => {
    const stages = proposeStages(item(), 600, FROM);
    const first = stages[0]!;
    const last = stages[stages.length - 1]!;
    expect(first.estimatedMinutes).toBeLessThan(last.estimatedMinutes);
    expect(first.cognitiveDemand).toBe("low");
    // Due within the first quarter of the runway, not on the deadline with everything else.
    const start = toEpochMinutes(FROM);
    const due = toEpochMinutes(item().dueAt!);
    expect(toEpochMinutes(first.dueAt!)).toBeLessThan(start + (due - start) * 0.25);
  });

  it("gives every stage its own internal deadline, in order", () => {
    const stages = proposeStages(item(), 600, FROM);
    const dates = stages.map((s) => s.dueAt!);
    expect(dates.every(Boolean)).toBe(true);
    expect([...dates].sort()).toEqual(dates);
    // The last stage lands on the real deadline.
    expect(dates[dates.length - 1]).toBe(item().dueAt);
  });

  it("uses a shape that fits the kind of work", () => {
    expect(proposeStages(item({ workType: "paper" }), 600, FROM).map((s) => s.title)).toContain(
      "Outline the argument",
    );
    expect(
      proposeStages(item({ workType: "presentation" }), 600, FROM).map((s) => s.title),
    ).toContain("Rehearse out loud, twice");
  });

  it("falls back to a generic shape rather than refusing", () => {
    const stages = proposeStages(item({ workType: "other" }), 300, FROM);
    expect(stages.length).toBeGreaterThan(1);
    expect(stages.reduce((sum, s) => sum + s.estimatedMinutes, 0)).toBe(300);
  });

  it("proposes no internal deadlines when the project has none", () => {
    // Inventing dates from a missing one is exactly what the rest of the app refuses to do.
    const stages = proposeStages(item({ dueAt: null }), 600, FROM);
    expect(stages.every((s) => s.dueAt === null)).toBe(true);
    expect(stages.reduce((sum, s) => sum + s.estimatedMinutes, 0)).toBe(600);
  });

  it("never proposes a fragment too short to be a session", () => {
    const stages = proposeStages(item(), 120, FROM);
    expect(Math.min(...stages.map((s) => s.estimatedMinutes))).toBeGreaterThanOrEqual(15);
  });

  it("measures the runway from now, not from the project's own start", () => {
    // A project picked up late must not be handed stages whose deadlines have already gone.
    const late = "2026-10-20T09:00:00.000Z";
    const stages = proposeStages(item(), 600, late);
    expect(stages.every((s) => s.dueAt! >= late)).toBe(true);
  });
});
