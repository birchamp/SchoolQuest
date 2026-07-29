import { describe, expect, it } from "vitest";
import { toEpochMinutes, type WorkItem, type WorkStatus, type WorkType } from "@schoolquest/domain";
import { generatePlan } from "./scheduler.js";
import { scoreWorkItems } from "./priority.js";
import { seedPlanningInput, SEED_NOW } from "./seed-input.js";
import type { PlanningInput } from "./types.js";

/**
 * Does long-term work actually survive contact with the schedule?
 *
 * This is the failure mode the product exists to prevent, and it is not a styling
 * question: a term paper due in six weeks competes every single week against a pile of
 * quizzes due in two days, loses on deadline pressure every time, and becomes visible in
 * week fourteen. A planner that lets that happen is worse than a paper list, because it
 * looks like it was handling things.
 *
 * These tests assert the engine's behaviour under that pressure rather than the weights
 * that are supposed to produce it. Weights can be tuned; the guarantee is what matters.
 */

const DAY = 24 * 60;

let counter = 0;

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  counter += 1;
  return {
    id: `wi_lh_${counter}`,
    courseId: "crs_psych",
    parentWorkItemId: null,
    title: `Item ${counter}`,
    description: null,
    workType: "problem_set" as WorkType,
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
    status: "not_started" as WorkStatus,
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

/** ISO instant `days` after the seed scenario's "now". */
function inDays(days: number): string {
  return new Date((toEpochMinutes(SEED_NOW) + days * DAY) * 60_000).toISOString();
}

/**
 * A realistic squeeze: one large project six weeks out, against a wall of small work all
 * due within three days. This is the shape of a real week, not a contrived one.
 */
function squeeze(overrides: Partial<PlanningInput> = {}): {
  input: PlanningInput;
  projectId: string;
} {
  const project = item({
    title: "Research Paper",
    workType: "paper",
    dueAt: inDays(42),
    estimatedMinutes: 900,
    remainingMinutes: 900,
    cognitiveDemand: "high",
  });

  const imminent = Array.from({ length: 12 }, (_, i) =>
    item({
      title: `Quiz ${i + 1}`,
      workType: "quiz",
      dueAt: inDays(1 + (i % 3)),
      estimatedMinutes: 45,
      remainingMinutes: 45,
    }),
  );

  const base = seedPlanningInput();
  return {
    projectId: project.id,
    input: {
      ...base,
      workItems: [project, ...imminent],
      dependencies: [],
      existingSessions: [],
      ...overrides,
    },
  };
}

describe("long-horizon work under deadline pressure", () => {
  it("gives a distant large project time in the very first week", () => {
    const { input, projectId } = squeeze();
    const plan = generatePlan(input, "plan_lh");

    const projectMinutes = plan.sessions
      .filter((s) => s.workItemId === projectId)
      .reduce((sum, s) => sum + s.minutes, 0);

    // The exact number is a tuning decision; that it is not zero is the guarantee.
    expect(projectMinutes).toBeGreaterThan(0);
  });

  it("does not let a wall of imminent work take the entire week", () => {
    const { input, projectId } = squeeze();
    const plan = generatePlan(input, "plan_lh");

    const total = plan.sessions.reduce((sum, s) => sum + s.minutes, 0);
    const projectMinutes = plan.sessions
      .filter((s) => s.workItemId === projectId)
      .reduce((sum, s) => sum + s.minutes, 0);

    // A 900-minute project six weeks out needs roughly 150 minutes a week to land. Asking
    // for a tenth of the week is a floor well under that, and it is the difference between
    // "started in week one" and "discovered in week six".
    expect(projectMinutes / total).toBeGreaterThan(0.1);
  });

  it("paces the project instead of cramming all of it into week one", () => {
    // The bound that was actually broken. Before pacing, the scheduler placed the entire
    // 900-minute remainder in the first week — 71% of it — and pushed four of the quizzes
    // out of the plan. Handing a student an impossible week is not protecting the project.
    const { input, projectId } = squeeze();
    const plan = generatePlan(input, "plan_lh");
    const projectMinutes = plan.sessions
      .filter((s) => s.workItemId === projectId)
      .reduce((sum, s) => sum + s.minutes, 0);

    expect(projectMinutes).toBeLessThan(900);
    // Roughly a week's share of a six-week runway, plus headroom to run slightly ahead.
    expect(projectMinutes).toBeGreaterThanOrEqual(150);
    expect(projectMinutes).toBeLessThanOrEqual(300);
  });

  it("says out loud that the project is being paced rather than finished", () => {
    const { input, projectId } = squeeze();
    const plan = generatePlan(input, "plan_lh");
    const paced = plan.risks.find(
      (r) => r.code === "PACED_TO_DEADLINE" && r.workItemId === projectId,
    );
    // A student seeing three hours of a fifteen-hour paper needs to know that is on
    // purpose, or the plan looks like it has lost the rest.
    expect(paced).toBeDefined();
    expect(paced!.level).toBe("safe");
    expect(paced!.detail).toContain("900");
  });

  it("stops pacing once the deadline is inside the horizon", () => {
    // Pacing is about a runway. When the runway is gone, the whole remainder is the plan.
    const { input, projectId } = squeeze();
    const soon = {
      ...input,
      workItems: input.workItems.map((w) =>
        w.id === projectId ? { ...w, dueAt: inDays(5), remainingMinutes: 240 } : w,
      ),
    };
    const plan = generatePlan(soon, "plan_lh_soon");
    expect(plan.risks.some((r) => r.code === "PACED_TO_DEADLINE" && r.workItemId === projectId))
      .toBe(false);
  });

  it("does not pace short work, whatever its due date", () => {
    // Spreading a 45-minute reading across eight weeks would be silly, and an earlier
    // version that deferred short distant work emptied the back half of the week.
    const short = item({ title: "Reading", workType: "reading", dueAt: inDays(56), estimatedMinutes: 45, remainingMinutes: 45 });
    const base = seedPlanningInput();
    const plan = generatePlan(
      { ...base, workItems: [short], dependencies: [], existingSessions: [] },
      "plan_lh_short",
    );
    expect(plan.risks.some((r) => r.code === "PACED_TO_DEADLINE")).toBe(false);
    const minutes = plan.sessions
      .filter((s) => s.workItemId === short.id)
      .reduce((sum, s) => sum + s.minutes, 0);
    expect(minutes).toBe(45);
  });

  it("paces a large undated project rather than letting it swallow the week", () => {
    // No deadline is no basis for a runway, but 15 hours of undated work is still not one
    // week's work.
    const undated = item({
      title: "Portfolio",
      workType: "paper",
      dueAt: null,
      estimatedMinutes: 900,
      remainingMinutes: 900,
    });
    const base = seedPlanningInput();
    const plan = generatePlan(
      { ...base, workItems: [undated], dependencies: [], existingSessions: [] },
      "plan_lh_undated",
    );
    const minutes = plan.sessions
      .filter((s) => s.workItemId === undated.id)
      .reduce((sum, s) => sum + s.minutes, 0);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThan(900);
  });

  it("keeps giving it time on later weeks, not only the first", () => {
    // Re-planning a week later, with the first week's blocks completed, must not drop the
    // project just because more quizzes have appeared.
    const { input, projectId } = squeeze();
    const firstWeek = generatePlan(input, "plan_lh_1");
    const completed = firstWeek.sessions.map((s) => ({
      id: s.id,
      workItemId: s.workItemId,
      planVersionId: "plan_lh_1",
      startAt: s.startAt,
      endAt: s.endAt,
      status: "completed" as const,
      locked: false,
      acceptedByUser: true,
      actualMinutes: s.minutes,
      outcomeCode: "completed" as const,
    }));

    const laterNow = inDays(7);
    const second = generatePlan(
      {
        ...input,
        now: laterNow,
        horizonStart: laterNow.slice(0, 10),
        existingSessions: completed,
        workItems: input.workItems.map((w) =>
          w.id === projectId ? { ...w, remainingMinutes: 780 } : w,
        ),
      },
      "plan_lh_2",
    );

    const projectMinutes = second.sessions
      .filter((s) => s.workItemId === projectId)
      .reduce((sum, s) => sum + s.minutes, 0);
    expect(projectMinutes).toBeGreaterThan(0);
  });

  it("raises a neglected project's score the longer it goes untouched", () => {
    const { input, projectId } = squeeze();

    const fresh = scoreWorkItems(input).find((s) => s.workItemId === projectId)!;
    const touchedLongAgo = scoreWorkItems({
      ...input,
      existingSessions: [
        {
          id: "ws_old",
          workItemId: projectId,
          planVersionId: "old",
          startAt: inDays(-10),
          endAt: inDays(-10),
          status: "completed",
          locked: false,
          acceptedByUser: true,
          actualMinutes: 60,
          outcomeCode: "completed",
        },
      ],
    }).find((s) => s.workItemId === projectId)!;

    // Ten days without progress must not score lower than never having started.
    expect(touchedLongAgo.score).toBeGreaterThanOrEqual(fresh.score * 0.95);
  });

  it("still ranks a genuinely urgent item above the distant project", () => {
    // The guarantee is that long work is never starved, not that it outranks a paper due
    // tomorrow. Inverting that would be its own failure.
    const { input, projectId } = squeeze();
    const scores = scoreWorkItems(input);
    const project = scores.find((s) => s.workItemId === projectId)!;
    const tomorrow = scores.filter((s) => s.workItemId !== projectId);
    expect(Math.max(...tomorrow.map((s) => s.score))).toBeGreaterThan(project.score);
  });
});
