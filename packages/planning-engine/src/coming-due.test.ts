import { describe, expect, it } from "vitest";
import { planningPreferences, type WorkItem } from "@schoolquest/domain";
import { generatePlan } from "./scheduler.js";
import type { PlanningInput } from "./types.js";

/**
 * Work that is coming due gets time, when there is time to give it.
 *
 * Each case here was found by `tools/e2e/scheduling.mjs` on an ordinary week -- four classes,
 * free afternoons, plenty of room -- where the planner still reported "no window fits this before
 * its deadline" about work it could easily have placed. A false at-risk alarm about a nearly
 * empty week is two failures at once: the work gets no time, and the warning teaches the student
 * to ignore warnings.
 */

const NOW = "2026-10-10T08:00:00.000Z"; // A Saturday, before the day's free time opens.

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    courseId: "crs_a",
    parentWorkItemId: null,
    title: overrides.id,
    description: null,
    workType: "other",
    availableAt: null,
    dueAt: null,
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: 60,
    remainingMinutes: 60,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "not_started",
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

function input(workItems: WorkItem[]): PlanningInput {
  return {
    termId: "term",
    horizonStart: NOW.slice(0, 10),
    horizonDays: 7,
    now: NOW,
    preferences: planningPreferences.parse({ mealWindows: [] }),
    courses: [],
    gradingCategories: [],
    meetingPatterns: [],
    commitments: [],
    // Free ten to six, every day.
    availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      id: `av_${d}`,
      termId: "term",
      dayOfWeek: d,
      startTime: "10:00",
      endTime: "18:00",
      energyLevel: "medium",
      location: "anywhere",
      hardness: "soft",
    })),
    workItems,
    dependencies: [],
    existingSessions: [],
  };
}

const bookedFor = (plan: ReturnType<typeof generatePlan>, id: string) =>
  plan.sessions.filter((s) => s.workItemId === id).reduce((sum, s) => sum + s.minutes, 0);

describe("work coming due", () => {
  it("uses the real deadline when keeping the buffer would leave no free time at all", () => {
    // Due at nine tomorrow; the one-day buffer says "finish by nine today", which is before
    // today's free time starts. Today from ten to six is still before the real deadline.
    const reading = item({ id: "reading", workType: "reading", dueAt: "2026-10-11T09:00:00.000Z", estimatedMinutes: 45, remainingMinutes: 45 });
    const plan = generatePlan(input([reading]), "p");

    expect(bookedFor(plan, "reading")).toBe(45);
    const session = plan.sessions.find((s) => s.workItemId === "reading")!;
    expect(session.endAt <= reading.dueAt!).toBe(true);
    // Said, not hidden: the block sits closer to the deadline than the student asked for.
    expect(session.tradeoffCode).toBe("WORK_PUSHED_CLOSER_TO_DEADLINE");
    expect(plan.risks.filter((r) => r.workItemId === "reading" && r.level === "at_risk")).toEqual([]);
  });

  it("still keeps the buffer when there is room to keep it", () => {
    const essay = item({ id: "essay", dueAt: "2026-10-13T23:59:00.000Z" });
    const plan = generatePlan(input([essay]), "p");
    const session = plan.sessions.find((s) => s.workItemId === "essay")!;
    expect(session.endAt < "2026-10-12T23:59:00.000Z").toBe(true);
    expect(session.tradeoffCode).toBeNull();
  });

  it("books work shorter than the minimum session at its own length", () => {
    const post = item({ id: "post", workType: "discussion", dueAt: "2026-10-12T23:59:00.000Z", estimatedMinutes: 15, remainingMinutes: 15 });
    const plan = generatePlan(input([post]), "p");
    expect(bookedFor(plan, "post")).toBe(15);
    expect(plan.unscheduledWorkItemIds).not.toContain("post");
  });

  it("books the last few minutes left after a partial session", () => {
    const tail = item({ id: "tail", dueAt: "2026-10-12T23:59:00.000Z", estimatedMinutes: 60, remainingMinutes: 10 });
    const plan = generatePlan(input([tail]), "p");
    expect(bookedFor(plan, "tail")).toBe(10);
  });

  it("still never shreds larger work below the minimum session", () => {
    const big = item({ id: "big", dueAt: "2026-10-14T23:59:00.000Z", estimatedMinutes: 100, remainingMinutes: 100 });
    const plan = generatePlan(input([big]), "p");
    expect(bookedFor(plan, "big")).toBe(100);
    for (const s of plan.sessions) expect(s.minutes).toBeGreaterThanOrEqual(20);
  });
});
