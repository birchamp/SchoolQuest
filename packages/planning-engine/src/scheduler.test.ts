import { describe, expect, it } from "vitest";
import { seedPlanningInput, SEED_NOW } from "./seed-input.js";
import { toEpochMinutes, type WorkItem, type WorkSession } from "@schoolquest/domain";
import { generatePlan, selectRecommendedSessions } from "./scheduler.js";
import { isSchedulable, scoreWorkItems } from "./priority.js";
import { buildCapacityWindows } from "./capacity.js";
import type { PlanningInput } from "./types.js";

const PLAN_ID = "plan_test";

function planFor(overrides: Partial<PlanningInput> = {}) {
  return generatePlan(seedPlanningInput(overrides), PLAN_ID);
}

describe("capacity windows", () => {
  it("never offers a window that collides with a class meeting", () => {
    const input = seedPlanningInput();
    const windows = buildCapacityWindows(input);
    // Psychology meets Monday 10:00-11:15; Monday availability starts at 13:00, so no
    // window may begin before the class ends.
    for (const window of windows) {
      const start = new Date(window.start * 60_000);
      if (start.getUTCDay() === 1) expect(start.getUTCHours()).toBeGreaterThanOrEqual(13);
    }
  });

  it("excludes the Tuesday evening work shift", () => {
    const windows = buildCapacityWindows(seedPlanningInput());
    const tuesdayEvening = windows.filter((w) => {
      const d = new Date(w.start * 60_000);
      return d.getUTCDay() === 2 && d.getUTCHours() >= 17;
    });
    expect(tuesdayEvening).toHaveLength(0);
  });

  it("never schedules anything before now", () => {
    const now = toEpochMinutes(SEED_NOW);
    for (const session of planFor().sessions) {
      expect(toEpochMinutes(session.startAt)).toBeGreaterThanOrEqual(now);
    }
  });
});

describe("the seed scenario", () => {
  it("gives the Tuesday library window to psychology source research, not reading", () => {
    const plan = planFor();
    const librarySession = plan.sessions.find((s) => s.workItemId === "wi_psych_sources");

    expect(librarySession).toBeDefined();
    const start = new Date(librarySession!.startAt);
    expect(start.getUTCDay()).toBe(2); // Tuesday
    expect(start.getUTCHours()).toBeGreaterThanOrEqual(13);
    expect(start.getUTCHours()).toBeLessThan(15);
    expect(librarySession!.reasonCodes).toContain("LOCATION_MATCH");
  });

  it("keeps the low-value reading in the plan rather than dropping it", () => {
    const plan = planFor();
    const reading = plan.sessions.filter((s) => s.workItemId === "wi_psych_reading_w2");
    expect(reading.length).toBeGreaterThan(0);
  });

  it("schedules source gathering before outlining", () => {
    const plan = planFor({ horizonDays: 14 });
    const lastSource = Math.max(
      ...plan.sessions
        .filter((s) => s.workItemId === "wi_psych_sources")
        .map((s) => toEpochMinutes(s.endAt)),
    );
    const firstOutline = Math.min(
      ...plan.sessions
        .filter((s) => s.workItemId === "wi_psych_outline")
        .map((s) => toEpochMinutes(s.startAt)),
    );
    expect(Number.isFinite(lastSource)).toBe(true);
    expect(Number.isFinite(firstOutline)).toBe(true);
    expect(firstOutline).toBeGreaterThanOrEqual(lastSource);
  });

  it("gives the major project a session more than seven days before its deadline", () => {
    const plan = planFor();
    const paperWork = plan.sessions.filter((s) =>
      ["wi_psych_sources", "wi_psych_outline", "wi_psych_draft"].includes(s.workItemId),
    );
    expect(paperWork.length).toBeGreaterThan(0);

    const due = toEpochMinutes("2026-10-05T23:59:00.000Z");
    const earliest = Math.min(...paperWork.map((s) => toEpochMinutes(s.startAt)));
    expect(due - earliest).toBeGreaterThan(7 * 24 * 60);
  });
});

describe("hard constraints", () => {
  it("respects the daily academic maximum", () => {
    const plan = planFor();
    const byDay = new Map<string, number>();
    for (const session of plan.sessions) {
      const date = session.startAt.slice(0, 10);
      byDay.set(date, (byDay.get(date) ?? 0) + session.minutes);
    }
    for (const minutes of byDay.values()) {
      expect(minutes).toBeLessThanOrEqual(240);
    }
  });

  it("produces no overlapping sessions", () => {
    const sessions = [...planFor().sessions].sort((a, b) => a.startAt.localeCompare(b.startAt));
    for (let i = 1; i < sessions.length; i++) {
      expect(toEpochMinutes(sessions[i]!.startAt)).toBeGreaterThanOrEqual(
        toEpochMinutes(sessions[i - 1]!.endAt),
      );
    }
  });

  it("never ends a session after its work item's due date", () => {
    const input = seedPlanningInput();
    const itemsById = new Map(input.workItems.map((w) => [w.id, w]));
    for (const session of generatePlan(input, PLAN_ID).sessions) {
      const due = itemsById.get(session.workItemId)?.dueAt;
      if (!due) continue;
      expect(toEpochMinutes(session.endAt)).toBeLessThanOrEqual(toEpochMinutes(due));
    }
  });

  it("keeps a library-only task out of non-library windows", () => {
    for (const session of planFor().sessions) {
      if (session.workItemId !== "wi_psych_sources") continue;
      const hour = new Date(session.startAt).getUTCHours();
      const day = new Date(session.startAt).getUTCDay();
      expect(day).toBe(2);
      expect(hour).toBeLessThan(15); // The library window closes at 14:30.
    }
  });
});

describe("stability and replanning", () => {
  it("is idempotent for unchanged inputs", () => {
    const a = planFor();
    const b = planFor();
    expect(b.sessions).toEqual(a.sessions);
  });

  it("preserves locked sessions exactly", () => {
    const locked: WorkSession = {
      id: "ws_locked",
      workItemId: "wi_edu_reading_w2",
      planVersionId: "plan_prev",
      startAt: "2026-09-09T14:00:00.000Z",
      endAt: "2026-09-09T15:00:00.000Z",
      status: "planned",
      locked: true,
      acceptedByUser: true,
      actualMinutes: null,
      outcomeCode: null,
    };

    const plan = planFor({ existingSessions: [locked] });
    const kept = plan.sessions.find((s) => s.id === "ws_locked");
    expect(kept).toBeDefined();
    expect(kept!.startAt).toBe(locked.startAt);
    expect(kept!.endAt).toBe(locked.endAt);
    expect(kept!.movementCost).toBe(1);
  });

  it("does not double-book a work item that already has a carried-over session", () => {
    const accepted: WorkSession = {
      id: "ws_accepted",
      workItemId: "wi_psych_reading_w2",
      planVersionId: "plan_prev",
      startAt: "2026-09-08T15:00:00.000Z",
      endAt: "2026-09-08T16:00:00.000Z",
      status: "planned",
      locked: false,
      acceptedByUser: true,
      actualMinutes: null,
      outcomeCode: null,
    };

    const plan = planFor({ existingSessions: [accepted] });
    const readingMinutes = plan.sessions
      .filter((s) => s.workItemId === "wi_psych_reading_w2")
      .reduce((sum, s) => sum + s.minutes, 0);
    // The item needs 60 minutes and the accepted session already covers all of it.
    expect(readingMinutes).toBe(60);
  });

  it("replans a missed day without rewriting the untouched remainder of the week", () => {
    const monday = planFor();
    const mondayIds = new Set(
      monday.sessions
        .filter((s) => s.startAt.slice(0, 10) > "2026-09-09")
        .map((s) => `${s.workItemId}@${s.startAt}`),
    );

    // The student loses Monday: those sessions are gone and their effort returns to the pool.
    const lostMondayItems = new Set(
      monday.sessions.filter((s) => s.startAt.slice(0, 10) === "2026-09-07").map((s) => s.workItemId),
    );
    const replan = generatePlan(
      {
        ...seedPlanningInput({ now: "2026-09-08T08:00:00.000Z" }),
        existingSessions: [],
      },
      "plan_replan",
    );

    const survivors = replan.sessions.filter(
      (s) => s.startAt.slice(0, 10) > "2026-09-09" && mondayIds.has(`${s.workItemId}@${s.startAt}`),
    );
    // Most of the later week should be untouched by losing Monday.
    expect(lostMondayItems.size).toBeGreaterThan(0);
    expect(survivors.length).toBeGreaterThan(0);
  });
});

describe("explanations and risk", () => {
  it("attaches at least one reason code to every recommendation", () => {
    const plan = planFor();
    expect(plan.recommendations.length).toBeGreaterThan(0);
    for (const rec of plan.recommendations) {
      expect(rec.reasonCodes.length).toBeGreaterThan(0);
    }
  });

  it("reports work it could not fit rather than silently dropping it", () => {
    // Squeeze the week down to a single short window; most work cannot fit.
    const input = seedPlanningInput({
      availabilityRules: [
        {
          id: "avl_tiny",
          termId: "trm_fall",
          dayOfWeek: 3,
          startTime: "13:00",
          endTime: "14:00",
          energyLevel: "medium",
          location: "anywhere",
          hardness: "soft",
        },
      ],
    });
    const plan = generatePlan(input, PLAN_ID);
    expect(plan.unscheduledWorkItemIds.length).toBeGreaterThan(0);
    expect(plan.risks.some((r) => r.level === "at_risk" || r.level === "watch")).toBe(true);
  });

  it("flags unknown effort as a risk instead of inventing a confident estimate", () => {
    const input = seedPlanningInput();
    const vague: WorkItem = {
      ...input.workItems.find((w) => w.id === "wi_edu_reading_w2")!,
      id: "wi_vague",
      title: "Unspecified assignment",
      estimatedMinutes: null,
      remainingMinutes: null,
    };
    const plan = generatePlan({ ...input, workItems: [...input.workItems, vague] }, PLAN_ID);
    expect(plan.risks.some((r) => r.code === "EFFORT_UNKNOWN" && r.workItemId === "wi_vague")).toBe(
      true,
    );
  });

  it("flags work with no known due date, rather than scheduling it silently", () => {
    const input = seedPlanningInput();
    const undated: WorkItem = {
      ...input.workItems.find((w) => w.id === "wi_edu_reading_w2")!,
      id: "wi_undated",
      title: "Group Presentation",
      dueAt: null,
      status: "unconfirmed",
      sourceConfidence: "unknown",
    };
    const plan = generatePlan({ ...input, workItems: [...input.workItems, undated] }, PLAN_ID);

    // It is still planned — the work exists — but the unknown is visible.
    expect(plan.sessions.some((s) => s.workItemId === "wi_undated")).toBe(true);
    expect(
      plan.risks.some((r) => r.code === "DUE_DATE_UNKNOWN" && r.workItemId === "wi_undated"),
    ).toBe(true);
  });

  it("does not schedule a parent project directly, only its milestones", () => {
    const plan = planFor({ horizonDays: 14 });
    expect(plan.sessions.some((s) => s.workItemId === "wi_psych_paper")).toBe(false);
    expect(plan.sessions.some((s) => s.workItemId === "wi_psych_sources")).toBe(true);
  });
});

describe("priority model", () => {
  it("ranks the library-gated prerequisite above the low-value reading", () => {
    const scores = scoreWorkItems(seedPlanningInput());
    const sources = scores.findIndex((s) => s.workItemId === "wi_psych_sources");
    const reading = scores.findIndex((s) => s.workItemId === "wi_psych_reading_w2");
    expect(sources).toBeGreaterThanOrEqual(0);
    expect(reading).toBeGreaterThanOrEqual(0);
    expect(sources).toBeLessThan(reading);
  });

  it("damps the score of work whose due date is not confirmed", () => {
    const input = seedPlanningInput();
    const confirmed = scoreWorkItems(input).find((s) => s.workItemId === "wi_psych_quiz_w2")!;

    const unconfirmed = scoreWorkItems({
      ...input,
      workItems: input.workItems.map((w) =>
        w.id === "wi_psych_quiz_w2" ? { ...w, sourceConfidence: "low_inference" as const } : w,
      ),
    }).find((s) => s.workItemId === "wi_psych_quiz_w2")!;

    expect(unconfirmed.score).toBeLessThan(confirmed.score);
    expect(unconfirmed.reasonCodes).toContain("UNCERTAIN_INPUT_CONSERVATIVE");
  });

  it("honors an explicit student priority", () => {
    const input = seedPlanningInput();
    const before = scoreWorkItems(input).find((s) => s.workItemId === "wi_edu_reading_w2")!;
    const after = scoreWorkItems({
      ...input,
      workItems: input.workItems.map((w) =>
        w.id === "wi_edu_reading_w2" ? { ...w, userPriority: 2 } : w,
      ),
    }).find((s) => s.workItemId === "wi_edu_reading_w2")!;

    expect(after.score).toBeGreaterThan(before.score);
    expect(after.reasonCodes).toContain("USER_PRIORITIZED");
  });
});

describe("selecting today's next actions", () => {
  const plan = planFor();

  it("moves with the calendar instead of freezing on the generation day", () => {
    // A plan version is written once and read all week. Asking on a later day has to
    // return that day's blocks, not the ones that were next when the plan was built.
    const day1 = selectRecommendedSessions(plan.sessions, toEpochMinutes(SEED_NOW));
    const later = selectRecommendedSessions(
      plan.sessions,
      toEpochMinutes(SEED_NOW) + 3 * 24 * 60,
    );

    expect(day1.length).toBeGreaterThan(0);
    expect(later.length).toBeGreaterThan(0);
    expect(later.map((s) => s.id)).not.toEqual(day1.map((s) => s.id));
    for (const session of later) {
      expect(toEpochMinutes(session.startAt)).toBeGreaterThan(toEpochMinutes(SEED_NOW));
    }
  });

  it("never offers a session the caller has already filtered out", () => {
    const [first] = selectRecommendedSessions(plan.sessions, toEpochMinutes(SEED_NOW));
    const remaining = plan.sessions.filter((s) => s.id !== first!.id);
    const next = selectRecommendedSessions(remaining, toEpochMinutes(SEED_NOW));
    expect(next.map((s) => s.id)).not.toContain(first!.id);
  });

  it("falls back to the next scheduled day rather than coming back empty", () => {
    // Every session sits in the future, so "today" holds nothing and the fallback must
    // produce a coherent day instead of an empty Today screen.
    const wellBefore = toEpochMinutes(SEED_NOW) - 30 * 24 * 60;
    const chosen = selectRecommendedSessions(plan.sessions, wellBefore);
    expect(chosen.length).toBeGreaterThan(0);
    const dates = new Set(chosen.map((s) => s.startAt.slice(0, 10)));
    expect(dates.size).toBe(1);
  });

  it("returns nothing when there is genuinely nothing left", () => {
    expect(selectRecommendedSessions([], toEpochMinutes(SEED_NOW))).toEqual([]);
  });
});

describe("recommendation variety", () => {
  it("never offers the same work item as its own alternative", () => {
    const plan = planFor();
    const ids = plan.recommendations.map((r) => r.workItemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns a single entry when the day holds only one task, split into blocks", () => {
    const now = toEpochMinutes(SEED_NOW);
    const blocks = [0, 90, 180].map((offset, i) => ({
      id: `ws_${i}`,
      workItemId: "wi_only",
      startAt: new Date((now + 60 + offset) * 60_000).toISOString(),
    }));
    // Three blocks, one assignment: Today should say so rather than pad the list.
    expect(selectRecommendedSessions(blocks, now)).toHaveLength(1);
  });
});

describe("an oversubscribed week", () => {
  /**
   * Two hours a week against the seed semester's full course load. Nothing like enough, which
   * is the point: this is where the planner has to choose, and what it chooses is the product.
   */
  const squeezed = (): PlanningInput =>
    seedPlanningInput({
      availabilityRules: [
        {
          id: "avl_squeeze",
          termId: "trm_fall",
          dayOfWeek: 3,
          startTime: "13:00",
          endTime: "15:00",
          energyLevel: "medium",
          location: "anywhere",
          hardness: "soft",
        },
      ],
    });

  it("gives every course with open work a block before any course gets a second", () => {
    /**
     * The greedy pass is priority-ordered and takes an item's whole weekly allocation before
     * moving on. With room that is right — finishing beats half-finishing. With two hours it
     * meant one problem set could take the entire week and every other course went dark, which
     * measured out at a median of three courses of five across a whole simulated term.
     *
     * A student drowning in five courses needs to see that none of them has stopped.
     */
    const input = squeezed();
    const plan = generatePlan(input, PLAN_ID);

    const schedulable = new Set(input.workItems.filter(isSchedulable).map((w) => w.courseId));
    const touched = new Set(plan.sessions.map((s) => s.courseId));

    expect(schedulable.size).toBeGreaterThan(1);
    for (const courseId of schedulable) expect([...touched], courseId).toContain(courseId);
  });

  it("still spends most of the squeezed week on the work that matters most", () => {
    // Spreading is a floor, not a policy. After every course has its one block, the rest of the
    // week goes back to priority order — otherwise "fair" would just mean "flat".
    const plan = generatePlan(squeezed(), PLAN_ID);
    const byCourse = new Map<string, number>();
    for (const s of plan.sessions) {
      byCourse.set(s.courseId, (byCourse.get(s.courseId) ?? 0) + s.minutes);
    }
    const minutes = [...byCourse.values()].sort((a, b) => b - a);
    expect(minutes[0]).toBeGreaterThan(minutes[minutes.length - 1]!);
  });

  it("leaves a week that fits alone", () => {
    /**
     * The first-touch pass runs only when demand exceeds what is left of the week — and the seed
     * week does not fit, at 2235 minutes of work against 1790 of capacity, which is worth
     * knowing: the default scenario every other test in this file uses is already an
     * oversubscribed one.
     *
     * So slack has to be built. With the whole day free every day, everything gets its full
     * allocation and nothing is left over. That is the property the guard protects, and it is
     * also the arithmetic check on the new pass: a first-touch block that failed to decrement
     * the item's remaining minutes would show up here as work scheduled twice or not at all.
     */
    const roomy = seedPlanningInput({
      availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        id: `avl_roomy_${dayOfWeek}`,
        termId: "trm_fall",
        dayOfWeek,
        startTime: "08:00",
        endTime: "20:00",
        energyLevel: "medium" as const,
        location: "anywhere" as const,
        hardness: "soft" as const,
      })),
      preferences: {
        ...seedPlanningInput().preferences,
        maxDailyAcademicMinutes: 600,
      },
    });
    const plan = generatePlan(roomy, PLAN_ID);

    // Only work whose predecessor has not finished inside the horizon is left over — the
    // dependency floor, not capacity.
    expect(plan.unscheduledWorkItemIds).toEqual(["wi_edu_observe", "wi_psych_revise"]);

    const booked = new Map<string, number>();
    for (const s of plan.sessions) {
      booked.set(s.workItemId, (booked.get(s.workItemId) ?? 0) + s.minutes);
    }
    for (const [workItemId, minutes] of booked) {
      const item = roomy.workItems.find((w) => w.id === workItemId)!;
      const required = item.remainingMinutes ?? item.estimatedMinutes;
      if (required === null) continue;
      // Long projects are paced against their runway and get a share by design, so only work
      // short enough to sit inside one week is expected whole. Nothing may exceed its
      // requirement — double-counting a first-touch block would show up exactly there.
      expect(minutes, item.title).toBeLessThanOrEqual(required);
      if (required <= 120) expect(minutes, item.title).toBe(required);
    }
  });
});
