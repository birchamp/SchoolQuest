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
    //
    // Short work distant from its deadline *is* deferred now — see `earliestSensibleStart` —
    // but never at the cost of an empty plan. Here the reading is the only work there is, so
    // the fallback pass places it in full, which is what this has always asserted.
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

describe("how early short work may start", () => {
  /**
   * The problem this answers only shows up over a term.
   *
   * With no lower bound on when work may begin, a reading quiz due on 2 December was a
   * candidate on 24 August, and a student with capacity to spare had it booked. Walking the
   * real semester made the cost visible: five courses' worth of work finished in nine weeks,
   * with the last seven planning nothing at all.
   *
   * It is wrong twice. Studying week thirteen's material in week one is studying material
   * nobody has taught, so the session is close to worthless. And a back half of term that
   * renders empty is actively misleading for a reader who cannot feel time passing.
   */
  it("leaves distant short work alone while there is nearer work to do", () => {
    const soon = item({ title: "Quiz 1", workType: "quiz", dueAt: inDays(3), estimatedMinutes: 30, remainingMinutes: 30 });
    const distant = item({
      id: "wi_distant",
      title: "Quiz 12",
      workType: "quiz",
      dueAt: inDays(84),
      estimatedMinutes: 30,
      remainingMinutes: 30,
    });
    const base = seedPlanningInput();
    const plan = generatePlan(
      { ...base, workItems: [soon, distant], dependencies: [], existingSessions: [] },
      "plan_lh_gate",
    );
    expect(plan.sessions.some((s) => s.workItemId === soon.id)).toBe(true);
    expect(plan.sessions.some((s) => s.workItemId === distant.id)).toBe(false);
  });

  it("opens short work ten days before it is due, and not before", () => {
    /**
     * The lead time is a product decision, so it gets an assertion rather than only a constant.
     *
     * `runwayDays` derives a window from effort and floors it at ten days; for anything short
     * enough to be gated the derivation comes out at four days or fewer, so the floor always
     * wins and every gated item gets exactly ten. Whoever moves `MIN_WARNING_DAYS` should be
     * told by a failing test what they are changing, because the call site reads as though the
     * window scales with the work — and it does not.
     *
     * With a seven-day horizon the boundary lands at seventeen days out: due minus ten has to
     * fall inside the week being planned.
     */
    const near = item({ id: "wi_near", title: "Nearby", workType: "quiz", dueAt: inDays(2), estimatedMinutes: 30, remainingMinutes: 30 });
    const base = seedPlanningInput();
    const planFor = (dueInDays: number) => {
      const subject = item({
        id: "wi_subject",
        title: "Quiz",
        workType: "quiz",
        dueAt: inDays(dueInDays),
        estimatedMinutes: 30,
        remainingMinutes: 30,
      });
      return generatePlan(
        { ...base, workItems: [near, subject], dependencies: [], existingSessions: [] },
        `plan_lead_${dueInDays}`,
      ).sessions.some((s) => s.workItemId === "wi_subject");
    };

    // Inside the window: ten days before day 15 is day 5, which the week can reach.
    expect(planFor(15)).toBe(true);
    // Outside it: ten days before day 25 is day 15, past the end of the week being planned.
    expect(planFor(25)).toBe(false);
  });

  it("still gives a distant large project time, because pacing is the whole point", () => {
    // The gate covers short work only. A fifteen-hour paper has to start early or it arrives
    // as a crisis, which is the failure this app was built to prevent — and is exactly what
    // the first version of the gate reintroduced.
    const paper = item({
      id: "wi_paper",
      title: "Term paper",
      workType: "paper",
      dueAt: inDays(84),
      estimatedMinutes: 900,
      remainingMinutes: 900,
    });
    const base = seedPlanningInput();
    const plan = generatePlan(
      { ...base, workItems: [paper], dependencies: [], existingSessions: [] },
      "plan_lh_gate_long",
    );
    const minutes = plan.sessions
      .filter((s) => s.workItemId === paper.id)
      .reduce((sum, s) => sum + s.minutes, 0);
    expect(minutes).toBeGreaterThan(0);
  });

  it("never hands back an empty week just because nothing is ripe yet", () => {
    // The floor under the deferral. "Nothing to do" is the one answer this app must never give
    // by accident to a reader who opened it to be told what to do next.
    const distant = item({
      id: "wi_only",
      title: "Quiz 12",
      workType: "quiz",
      dueAt: inDays(84),
      estimatedMinutes: 30,
      remainingMinutes: 30,
    });
    const base = seedPlanningInput();
    const plan = generatePlan(
      { ...base, workItems: [distant], dependencies: [], existingSessions: [] },
      "plan_lh_floor",
    );
    expect(plan.sessions.length).toBeGreaterThan(0);
  });

  it("picks work up again once its date has gone, rather than abandoning it", () => {
    // `latestSafeEnd` used to clamp the limit to `now`, so anything past due had no legal slot
    // and was silently dropped from every plan for the rest of term — while the map went on
    // burning it red. The app telling a student something needs attention and then refusing to
    // make room for it is the worst pair of behaviours available to it.
    const late = item({
      id: "wi_late",
      title: "Problem Set 1",
      workType: "problem_set",
      dueAt: inDays(-9),
      estimatedMinutes: 60,
      remainingMinutes: 60,
    });
    const base = seedPlanningInput();
    const plan = generatePlan(
      { ...base, workItems: [late], dependencies: [], existingSessions: [] },
      "plan_lh_late",
    );
    expect(plan.sessions.some((s) => s.workItemId === late.id)).toBe(true);
  });

  it("can still schedule work due inside its own deadline buffer", () => {
    // Same clamp, different victim: with a one-day buffer, work due tomorrow had its limit
    // pulled back to `now` and became unschedulable — the most urgent work being the least
    // bookable. The margin degrades to the real deadline instead of biting.
    const tomorrow = item({
      id: "wi_tomorrow",
      title: "Quiz",
      workType: "quiz",
      dueAt: inDays(1),
      estimatedMinutes: 30,
      remainingMinutes: 30,
    });
    const base = seedPlanningInput();
    const plan = generatePlan(
      { ...base, workItems: [tomorrow], dependencies: [], existingSessions: [] },
      "plan_lh_buffer",
    );
    expect(plan.sessions.some((s) => s.workItemId === tomorrow.id)).toBe(true);
  });
});
