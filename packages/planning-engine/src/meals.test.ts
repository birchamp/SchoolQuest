import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEAL_WINDOWS,
  dateToEpochMinutes,
  formatTimeOfDay,
  type Commitment,
  type AvailabilityRule,
} from "@schoolquest/domain";
import { buildCapacity } from "./capacity.js";
import { planMealBreaks, mealNotes, reservedIntervals } from "./meals.js";
import { generatePlan } from "./scheduler.js";
import { seedPlanningInput } from "./seed-input.js";
import type { PlanningInput } from "./types.js";

/** 2026-09-07 is a Monday, matching the seed fixture's horizon. */
const MONDAY = "2026-09-07";

function clockOf(epochMinutes: number, date = MONDAY): string {
  return formatTimeOfDay(epochMinutes - dateToEpochMinutes(date));
}

function rule(overrides: Partial<AvailabilityRule> & { dayOfWeek: number }): AvailabilityRule {
  return {
    id: `avl_${overrides.dayOfWeek}_${overrides.startTime ?? "x"}`,
    termId: "trm_t",
    startTime: "09:00",
    endTime: "21:00",
    energyLevel: "medium",
    location: "anywhere",
    hardness: "soft",
    ...overrides,
  };
}

function commitment(overrides: Partial<Commitment> & { id: string }): Commitment {
  return {
    termId: "trm_t",
    title: "Thing",
    commitmentType: "other",
    daysOfWeek: [1],
    startTime: "12:00",
    endTime: "13:00",
    specificDate: null,
    flexibility: "fixed",
    locked: false,
    ...overrides,
  };
}

/** A single Monday, wide open, so each rule under test is the only thing in play. */
function oneDay(overrides: Partial<PlanningInput> = {}): PlanningInput {
  return {
    termId: "trm_t",
    horizonStart: MONDAY,
    horizonDays: 1,
    now: `${MONDAY}T06:00:00.000Z`,
    preferences: {
      maxDailyAcademicMinutes: 600,
      preferredSessionMinutes: 45,
      minSessionMinutes: 20,
      maxSessionMinutes: 120,
      breakMinutes: 10,
      mealWindows: DEFAULT_MEAL_WINDOWS,
      protectedDaysOfWeek: [],
      deadlineBufferDays: 1,
    },
    courses: [],
    gradingCategories: [],
    meetingPatterns: [],
    commitments: [],
    availabilityRules: [rule({ dayOfWeek: 1 })],
    workItems: [],
    dependencies: [],
    existingSessions: [],
    ...overrides,
  };
}

describe("meal anticipation", () => {
  it("holds the customary hour open when nothing else covers it", () => {
    const { meals } = buildCapacity(oneDay());
    const lunch = meals.find((m) => m.key === "lunch");
    expect(lunch?.status).toBe("reserved");
    expect(clockOf(lunch!.start!)).toBe("12:15");
    expect(lunch!.minutes).toBe(40);
  });

  it("leaves the student's own meal commitment alone", () => {
    const { meals } = buildCapacity(
      oneDay({
        commitments: [
          commitment({ id: "cmt_lunch", title: "Lunch", commitmentType: "meal", startTime: "11:30", endTime: "12:00" }),
        ],
      }),
    );
    const lunch = meals.find((m) => m.key === "lunch");
    expect(lunch?.status).toBe("planned");
    expect(lunch?.start).toBeNull();
  });

  it("treats an optional meal commitment as not covering the window", () => {
    // Optional commitments are never subtracted from capacity, so they cannot be the thing
    // holding the time either — otherwise the window is neither reserved nor free.
    const { meals } = buildCapacity(
      oneDay({
        commitments: [
          commitment({
            id: "cmt_maybe",
            title: "Lunch, maybe",
            commitmentType: "meal",
            startTime: "12:00",
            endTime: "12:45",
            flexibility: "optional",
          }),
        ],
      }),
    );
    expect(meals.find((m) => m.key === "lunch")?.status).toBe("reserved");
  });

  it("slides the meal to the nearest free time when the anchor is busy", () => {
    const { meals } = buildCapacity(
      oneDay({
        commitments: [
          commitment({ id: "cmt_lab", title: "Lab", startTime: "11:00", endTime: "13:00" }),
        ],
      }),
    );
    const lunch = meals.find((m) => m.key === "lunch");
    expect(lunch?.status).toBe("reserved");
    expect(clockOf(lunch!.start!)).toBe("13:00");
  });

  it("holds what time there is when the window is tighter than a full meal", () => {
    const { meals } = buildCapacity(
      oneDay({
        commitments: [
          commitment({ id: "cmt_a", title: "Class", startTime: "11:00", endTime: "12:00" }),
          commitment({ id: "cmt_b", title: "Class", startTime: "12:25", endTime: "14:00" }),
        ],
      }),
    );
    const lunch = meals.find((m) => m.key === "lunch");
    expect(lunch?.status).toBe("squeezed");
    expect(lunch?.minutes).toBe(25);
  });

  it("reports a day with no gap instead of inventing one", () => {
    const { meals } = buildCapacity(
      oneDay({
        commitments: [
          commitment({ id: "cmt_solid", title: "Shift", startTime: "10:00", endTime: "15:00" }),
        ],
      }),
    );
    const lunch = meals.find((m) => m.key === "lunch");
    expect(lunch?.status).toBe("no_gap");
    expect(lunch?.start).toBeNull();
    expect(mealNotes(meals).some((n) => n.kind === "no_gap")).toBe(true);
  });

  it("says nothing about a meal outside the student's availability", () => {
    // Availability starts at 09:00, so breakfast is none of the planner's business.
    const { meals } = buildCapacity(oneDay());
    expect(meals.some((m) => m.key === "breakfast")).toBe(false);
  });

  it("takes meal time out of general availability, not a purpose-built window", () => {
    // The regression that made this rule: a forty-minute lunch was taken out of the front
    // of the only library window in the week, and the library-only task lost its runway.
    const input = oneDay({
      availabilityRules: [
        rule({ dayOfWeek: 1, startTime: "09:00", endTime: "21:00" }),
        rule({ dayOfWeek: 1, startTime: "12:00", endTime: "13:30", location: "library" }),
      ],
    });
    const lunch = planMealBreaks(input, []).find((m) => m.key === "lunch");
    expect(lunch?.status).toBe("reserved");
    // 12:00–13:30 belongs to the library, so the meal sits in the general time before it,
    // ending exactly where that window opens.
    expect(clockOf(lunch!.start!)).toBe("11:20");
    expect(clockOf(lunch!.end!)).toBe("12:00");
  });

  it("keeps the library-only task in the library window", () => {
    const plan = generatePlan(seedPlanningInput(), "pv_meal");
    for (const session of plan.sessions) {
      if (session.workItemId !== "wi_psych_sources") continue;
      expect(new Date(session.startAt).getUTCDay()).toBe(2);
    }
  });

  it("removes reserved meal time from the capacity windows", () => {
    const { windows, meals } = buildCapacity(oneDay());
    const held = reservedIntervals(meals);
    for (const window of windows) {
      for (const meal of held) {
        expect(window.start < meal.end && meal.start < window.end).toBe(false);
      }
    }
  });

  it("reserves nothing when the student has opted out of meal windows", () => {
    const input = oneDay();
    input.preferences.mealWindows = [];
    expect(buildCapacity(input).meals).toEqual([]);
  });

  it("does not hold time for a meal that has already passed", () => {
    const { meals } = buildCapacity(oneDay({ now: `${MONDAY}T15:00:00.000Z` }));
    expect(meals.some((m) => m.key === "lunch")).toBe(false);
    expect(meals.some((m) => m.key === "dinner")).toBe(true);
  });
});

describe("breaks between blocks", () => {
  it("leaves recovery time between consecutive blocks", () => {
    const input = seedPlanningInput();
    const gap = input.preferences.breakMinutes;
    expect(gap).toBeGreaterThan(0);

    const byDay = new Map<string, { start: number; end: number }[]>();
    for (const session of generatePlan(input, "pv_break").sessions) {
      const date = session.startAt.slice(0, 10);
      const list = byDay.get(date) ?? [];
      list.push({ start: Date.parse(session.startAt), end: Date.parse(session.endAt) });
      byDay.set(date, list);
    }

    for (const blocks of byDay.values()) {
      blocks.sort((a, b) => a.start - b.start);
      for (let i = 1; i < blocks.length; i++) {
        const between = (blocks[i]!.start - blocks[i - 1]!.end) / 60_000;
        expect(between).toBeGreaterThanOrEqual(gap);
      }
    }
  });

  it("does not charge the break against the daily academic ceiling", () => {
    const input = seedPlanningInput();
    const plan = generatePlan(input, "pv_break2");
    const byDay = new Map<string, number>();
    for (const session of plan.sessions) {
      const date = session.startAt.slice(0, 10);
      byDay.set(date, (byDay.get(date) ?? 0) + session.minutes);
    }
    for (const minutes of byDay.values()) {
      expect(minutes).toBeLessThanOrEqual(input.preferences.maxDailyAcademicMinutes);
    }
  });
});
