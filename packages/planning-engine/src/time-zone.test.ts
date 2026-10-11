import { describe, expect, it } from "vitest";
import { fromEpochMinutes, planningPreferences, toEpochMinutes, type WorkItem } from "@schoolquest/domain";
import { generatePlan, selectRecommendedSessions } from "./scheduler.js";
import { buildCapacityWindows } from "./capacity.js";
import { deadlinesByDay } from "./week-calendar.js";
import { seedPlanningInput } from "./seed-input.js";
import type { PlanningInput } from "./types.js";

/**
 * Everything inside the engine is UTC; the student's zone only says where their days begin and
 * when their weekly rules fall (issue #4). Every other test in this package runs at UTC+0, where
 * a UTC date and the student's date are the same thing and a mistake between them is invisible.
 * These are the tests that are not.
 */

const shift = (iso: string, minutes: number) => fromEpochMinutes(toEpochMinutes(iso) + minutes);

describe("a student five hours behind UTC", () => {
  it("gets the UTC student's plan, five hours later, block for block", () => {
    // `Etc/GMT+5` is UTC-5 all year (the sign is POSIX's, inverted), so the two plans must be the
    // same plan seen from two places: every local rule lands five hours later in UTC, and every
    // instant in the input is moved by the same five hours.
    const utc = seedPlanningInput();
    const offset = 5 * 60;
    const zoned: PlanningInput = {
      ...utc,
      timeZone: "Etc/GMT+5",
      now: shift(utc.now, offset),
      workItems: utc.workItems.map((w) => ({
        ...w,
        dueAt: w.dueAt ? shift(w.dueAt, offset) : null,
        availableAt: w.availableAt ? shift(w.availableAt, offset) : null,
      })),
      existingSessions: utc.existingSessions.map((s) => ({
        ...s,
        startAt: shift(s.startAt, offset),
        endAt: shift(s.endAt, offset),
      })),
    };

    const a = generatePlan(utc, "p");
    const b = generatePlan(zoned, "p");
    expect(b.sessions.length).toBeGreaterThan(5);
    expect(b.sessions.map((s) => [s.workItemId, s.startAt, s.endAt])).toEqual(
      a.sessions.map((s) => [s.workItemId, shift(s.startAt, offset), shift(s.endAt, offset)]),
    );
    expect(b.horizonEnd).toBe(a.horizonEnd);
    expect(b.unscheduledWorkItemIds).toEqual(a.unscheduledWorkItemIds);
  });
});

const NOW = "2026-10-12T13:00:00.000Z"; // Monday, 8am in Chicago (CDT, UTC-5).

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

function chicago(overrides: Partial<PlanningInput> = {}): PlanningInput {
  return {
    termId: "term",
    horizonStart: "2026-10-12",
    horizonDays: 7,
    now: NOW,
    timeZone: "America/Chicago",
    preferences: planningPreferences.parse({ mealWindows: [] }),
    courses: [],
    gradingCategories: [],
    meetingPatterns: [],
    commitments: [],
    availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      id: `av_${d}`,
      termId: "term",
      dayOfWeek: d,
      startTime: "18:00",
      endTime: "23:30",
      energyLevel: "medium" as const,
      location: "anywhere" as const,
      hardness: "soft" as const,
    })),
    workItems: [],
    dependencies: [],
    existingSessions: [],
    ...overrides,
  };
}

describe("a student in Chicago", () => {
  it("is free from six in the evening their time, which is 23:00 UTC", () => {
    const windows = buildCapacityWindows(chicago());
    expect(fromEpochMinutes(windows[0]!.start)).toBe("2026-10-12T23:00:00.000Z");
    // And until half past eleven their time, which is past midnight in UTC.
    expect(fromEpochMinutes(windows[0]!.end)).toBe("2026-10-13T04:30:00.000Z");
  });

  it("keeps the daily limit per day of their life, not per UTC date", () => {
    // Each evening straddles UTC midnight. Counted by UTC date, an evening splits in two and
    // each half gets its own allowance; counted by the student's date, it is one day.
    const plan = generatePlan(
      chicago({
        preferences: planningPreferences.parse({ mealWindows: [], maxDailyAcademicMinutes: 120 }),
        workItems: [1, 2, 3, 4, 5, 6].map((i) =>
          item({ id: `w${i}`, dueAt: "2026-10-18T23:59:00.000Z", estimatedMinutes: 90, remainingMinutes: 90 }),
        ),
      }),
      "p",
    );
    const perLocalDay = new Map<string, number>();
    for (const s of plan.sessions) {
      // Evenings from six: a block's Chicago date is the UTC date five hours earlier.
      const day = shift(s.startAt, -5 * 60).slice(0, 10);
      perLocalDay.set(day, (perLocalDay.get(day) ?? 0) + s.minutes);
    }
    expect(Math.max(...perLocalDay.values())).toBeLessThanOrEqual(120);
    expect(plan.sessions.length).toBeGreaterThan(0);
  });

  it("calls an evening block at nine tonight 'today' even after midnight UTC", () => {
    // 20:30 in Chicago is 01:30 UTC on the next date.
    const now = toEpochMinutes("2026-10-13T01:30:00.000Z");
    const tonight = { workItemId: "a", startAt: "2026-10-13T02:00:00.000Z" }; // 21:00 local
    const tomorrow = { workItemId: "b", startAt: "2026-10-13T23:00:00.000Z" }; // 18:00 next day
    expect(selectRecommendedSessions([tonight, tomorrow], now, undefined, 3, "America/Chicago")).toEqual([tonight]);
  });

  it("puts a deadline at midnight their time on their day, as a default time", () => {
    // Friday 23:59 in Chicago is Saturday 04:59 UTC.
    const byDay = deadlinesByDay(
      [{ workItemId: "essay", courseId: "c", title: "Essay", workType: "paper", dueAt: "2026-10-17T04:59:00.000Z" }],
      { horizonStart: "2026-10-12", horizonDays: 7, sessions: [], timeZone: "America/Chicago" },
    );
    const friday = byDay.get("2026-10-16");
    expect(friday?.map((d) => d.workItemId)).toEqual(["essay"]);
    expect(friday?.[0]?.timeStated).toBe(false);
    expect(byDay.has("2026-10-17")).toBe(false);
  });
});

describe("across the end of daylight saving", () => {
  it("keeps a nine o'clock class at nine, and the study hours around it, on both sides", () => {
    // New York falls back at 2am on Sunday 1 November 2026: 9am is 13:00 UTC the Friday before
    // and 14:00 UTC the Monday after.
    const input = chicago({
      timeZone: "America/New_York",
      horizonStart: "2026-10-30",
      now: "2026-10-30T10:00:00.000Z",
      availabilityRules: [1, 5].map((d) => ({
        id: `av_${d}`,
        termId: "term",
        dayOfWeek: d,
        startTime: "08:00",
        endTime: "12:00",
        energyLevel: "medium" as const,
        location: "anywhere" as const,
        hardness: "soft" as const,
      })),
      meetingPatterns: [
        {
          id: "m",
          courseId: "c",
          daysOfWeek: [1, 5],
          startTime: "09:00",
          endTime: "10:00",
          location: null,
          effectiveStart: null,
          effectiveEnd: null,
        },
      ],
    });
    const windows = buildCapacityWindows(input).map((w) => [fromEpochMinutes(w.start), fromEpochMinutes(w.end)]);
    expect(windows).toEqual([
      // Friday, EDT (UTC-4): 8-9 and 10-12.
      ["2026-10-30T12:00:00.000Z", "2026-10-30T13:00:00.000Z"],
      ["2026-10-30T14:00:00.000Z", "2026-10-30T16:00:00.000Z"],
      // Monday, EST (UTC-5): the same local hours, an hour later in UTC.
      ["2026-11-02T13:00:00.000Z", "2026-11-02T14:00:00.000Z"],
      ["2026-11-02T15:00:00.000Z", "2026-11-02T17:00:00.000Z"],
    ]);
  });
});
