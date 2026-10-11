import { describe, expect, it } from "vitest";
import { toEpochMinutes, workStatus, zoneCalendar, type WorkItem, type WorkStatus } from "@schoolquest/domain";
import {
  daysLeftForPacing,
  daysUntil,
  defaultEffortFor,
  DEFAULT_EFFORT_MINUTES,
  FALLBACK_EFFORT_MINUTES,
  givenRemainingMinutes,
  isFinished,
  isOpen,
  isOpenOrFinished,
  isPastDue,
  isUnfinished,
  remainingEffortMinutes,
  totalEffort,
} from "./work-item.js";
import { buildCampaignRadar } from "./campaign-radar.js";
import { buildTerrain } from "./terrain.js";
import { computeProjectProgress, summarizeProjects } from "./project-progress.js";
import { buildSessionBrief } from "./session-brief.js";
import { computeCourseHealth } from "./course-health.js";
import { computeCourseLoad } from "./course-load.js";
import { buildEffortSurvey } from "./effort-survey.js";

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_1",
    courseId: "crs_a",
    parentWorkItemId: null,
    title: "Thing",
    description: null,
    workType: "paper",
    availableAt: null,
    dueAt: null,
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: null,
    remainingMinutes: null,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "not_started",
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

describe("effort", () => {
  it("owed effort reads remaining, then the estimate, then the type default", () => {
    expect(remainingEffortMinutes(item({ remainingMinutes: 30, estimatedMinutes: 120 }))).toBe(30);
    expect(remainingEffortMinutes(item({ estimatedMinutes: 120 }))).toBe(120);
    expect(remainingEffortMinutes(item({ workType: "paper" }))).toBe(240);
    // Zero remaining is a real answer -- the work is done -- not a missing one.
    expect(remainingEffortMinutes(item({ remainingMinutes: 0, estimatedMinutes: 120 }))).toBe(0);
  });

  it("total effort reads the estimate first, so a half-done job is not resized to what is left", () => {
    expect(totalEffort(item({ remainingMinutes: 30, estimatedMinutes: 120 }))).toEqual({
      minutes: 120,
      assumed: false,
    });
    expect(totalEffort(item({ remainingMinutes: 90 }))).toEqual({ minutes: 90, assumed: false });
    // A remaining of zero says "done", not "small": the default sizes it instead.
    expect(totalEffort(item({ remainingMinutes: 0 }))).toEqual({ minutes: 240, assumed: true });
    expect(totalEffort(item())).toEqual({ minutes: 240, assumed: true });
  });

  it("given effort is null only when nobody stated a number", () => {
    expect(givenRemainingMinutes(item())).toBeNull();
    expect(givenRemainingMinutes(item({ estimatedMinutes: 45 }))).toBe(45);
    expect(givenRemainingMinutes(item({ remainingMinutes: 10, estimatedMinutes: 45 }))).toBe(10);
  });

  it("defaults come from one table, with one fallback for unknown types", () => {
    expect(defaultEffortFor("quiz")).toBe(DEFAULT_EFFORT_MINUTES.quiz);
    expect(defaultEffortFor("not_a_type")).toBe(FALLBACK_EFFORT_MINUTES);
  });
});

describe("status", () => {
  const all = workStatus.options;
  const where = (pred: (i: { status: WorkStatus }) => boolean) =>
    all.filter((status) => pred({ status }));

  it("finished means completed or submitted", () => {
    expect(where(isFinished)).toEqual(["completed", "submitted"]);
  });

  it("open means owed: not finished, not cancelled, not optional", () => {
    expect(where(isOpen)).toEqual(["unconfirmed", "not_started", "in_progress", "blocked"]);
  });

  it("unfinished is open plus optional work", () => {
    expect(where(isUnfinished)).toEqual(where((i) => isOpen(i) || i.status === "optional"));
  });

  it("open-or-finished leaves out only cancelled and optional work", () => {
    expect(where(isOpenOrFinished)).toEqual(all.filter((s) => s !== "canceled" && s !== "optional"));
  });
});

describe("daysUntil", () => {
  const at = (iso: string) => toEpochMinutes(iso);
  const utc = zoneCalendar("UTC");

  it("counts calendar days, not elapsed 24-hour periods", () => {
    // Ten hours away, but tomorrow.
    expect(daysUntil("2026-09-02T09:00:00.000Z", at("2026-09-01T23:00:00.000Z"), utc)).toBe(1);
    // Earlier today is still today, not "1 day overdue".
    expect(daysUntil("2026-09-01T08:00:00.000Z", at("2026-09-01T15:00:00.000Z"), utc)).toBe(0);
    expect(daysUntil("2026-08-31T23:59:00.000Z", at("2026-09-01T00:01:00.000Z"), utc)).toBe(-1);
    expect(daysUntil("2026-09-08T23:59:00.000Z", at("2026-09-01T00:00:00.000Z"), utc)).toBe(7);
  });

  it("counts the student's days, not UTC's", () => {
    // 21:00 in Los Angeles on the 1st; due 09:00 Los Angeles on the 2nd. UTC sees both on the
    // 2nd and would call it today.
    const la = zoneCalendar("America/Los_Angeles");
    const now = at("2026-09-02T04:00:00.000Z");
    expect(daysUntil("2026-09-02T16:00:00.000Z", now, utc)).toBe(0);
    expect(daysUntil("2026-09-02T16:00:00.000Z", now, la)).toBe(1);
  });

  it("is still one day across a daylight-saving change", () => {
    const ny = zoneCalendar("America/New_York");
    // Sat 31 Oct 22:00 EDT to Sun 1 Nov 09:00 EST: the clocks go back in between.
    expect(daysUntil("2026-11-01T14:00:00.000Z", at("2026-11-01T02:00:00.000Z"), ny)).toBe(1);
  });
});

/**
 * The point of the shared helpers: the same item, read by every view, at a moment where the
 * old floor-of-minutes rule and the calendar rule disagree. Due 09:00 tomorrow, seen at 23:00.
 */
describe("every view agrees about the same item", () => {
  const now = "2026-09-01T23:00:00.000Z";
  const paper = item({
    id: "wi_paper",
    workType: "exam",
    dueAt: "2026-09-02T09:00:00.000Z",
  });

  function daysAwayEverywhere(dueAt: string, at: string, timeZone = "UTC"): number[] {
    const due = { ...paper, dueAt };
    const zone = { timeZone };
    const radar = buildCampaignRadar({
      workItems: [due],
      gradingCategories: [],
      bookedByItem: {},
      now: at,
      termStartDate: "2026-08-31",
      termEndDate: "2026-12-11",
      ...zone,
    });
    const terrain = buildTerrain({
      workItems: [due],
      bookedByItem: {},
      courseIds: ["crs_a"],
      now: at,
      ...zone,
    });
    const brief = buildSessionBrief({
      workItems: [due],
      sessions: [],
      horizonStart: "2026-09-01",
      horizonDays: 7,
      now: at,
      ...zone,
    });
    const projects = computeProjectProgress({
      workItems: [{ ...due, estimatedMinutes: 600 }],
      weeklyCapacityMinutes: 600,
      completed: [],
      booked: [],
      now: at,
      ...zone,
    });
    return [
      radar.encounters[0]!.daysAway,
      terrain.markers[0]!.daysAway!,
      brief.milestones[0]!.daysAway,
      projects[0]!.daysAway!,
    ];
  }

  it("reports the same days-away everywhere", () => {
    expect(daysAwayEverywhere(paper.dueAt!, now)).toEqual([1, 1, 1, 1]);
  });

  it("counts those days in the student's zone everywhere", () => {
    // 21:00 on the 1st in Los Angeles, due 09:00 on the 2nd there. In UTC both are the 2nd.
    const at = "2026-09-02T04:00:00.000Z";
    const due = "2026-09-02T16:00:00.000Z";
    expect(daysAwayEverywhere(due, at, "America/Los_Angeles")).toEqual([1, 1, 1, 1]);
    expect(daysAwayEverywhere(due, at)).toEqual([0, 0, 0, 0]);
  });

  it("sizes an unestimated item the way the scheduler does", () => {
    const terrain = buildTerrain({
      workItems: [paper],
      bookedByItem: {},
      courseIds: ["crs_a"],
      now,
      timeZone: "UTC",
    });
    expect(terrain.markers[0]!.requiredMinutes).toBe(DEFAULT_EFFORT_MINUTES.exam);
  });

  it("counts an unestimated deadline's default effort as needed time on the course", () => {
    const health = computeCourseHealth({
      courses: [
        {
          id: "crs_a",
          termId: "trm_t",
          name: "A",
          code: "A 100",
          instructor: null,
          credits: null,
          colorToken: "azure",
          expectedWeeklyMinutes: null,
          targetGrade: null,
          gradingConfidence: "confirmed",
        },
      ],
      load: [
        {
          courseId: "crs_a",
          bookedMinutes: 10,
          shareOfBooked: 1,
          blocks: 1,
          investedMinutes: 0,
          openItems: 1,
          openProjects: 0,
          nextDueAt: paper.dueAt,
          nextDueTitle: paper.title,
          upkeep: "current",
          upkeepOverdue: 0,
          daysSinceProgress: null,
        },
      ],
      projects: [],
      standings: {},
      grades: [],
      gradingCategories: [],
      workItems: [paper],
      now,
      timeZone: "UTC",
    }).courses[0];
    expect(health!.nextDueInDays).toBe(1);
    expect(health!.concerns.map((c) => c.code)).toContain("DEADLINE_UNPREPARED");
  });
});

describe("modules that used to disagree about open", () => {
  it("course load does not count optional work as still open", () => {
    const load = computeCourseLoad({
      courseIds: ["crs_a"],
      workItems: [item({ id: "a" }), item({ id: "b", status: "optional" })],
      booked: [],
      completed: [],
      capacityMinutes: 600,
      now: "2026-09-01T09:00:00.000Z",
    });
    expect(load.courses[0]!.openItems).toBe(1);
  });

  it("the effort survey does not ask about submitted or optional work", () => {
    const survey = buildEffortSurvey({
      workItems: [
        item({ id: "a" }),
        item({ id: "b", status: "submitted" }),
        item({ id: "c", status: "optional" }),
      ],
      courses: [],
      gradingCategories: [],
    });
    expect(survey.itemCount).toBe(1);
  });
});

/**
 * Due at 09:00, looked at 15:00 the same day: `daysUntil` says today (0), and the deadline has
 * still passed. Every view must call it past due now, not at midnight.
 */
describe("a deadline that passed earlier today", () => {
  const now = "2026-09-01T15:00:00.000Z";
  const dueAt = "2026-09-01T09:00:00.000Z";
  const exam = item({ id: "wi_exam", workType: "exam", dueAt, estimatedMinutes: 600 });

  it("is past due by the instant while still today by the calendar", () => {
    expect(isPastDue(dueAt, toEpochMinutes(now))).toBe(true);
    expect(daysUntil(dueAt, toEpochMinutes(now), zoneCalendar("UTC"))).toBe(0);
    expect(isPastDue("2026-09-01T18:00:00.000Z", toEpochMinutes(now))).toBe(false);
  });

  it("is past due on the project rows and in the summary", () => {
    const rows = computeProjectProgress({
      workItems: [exam],
      weeklyCapacityMinutes: 6000,
      completed: [],
      booked: [],
      now,
      timeZone: "UTC",
    });
    expect(rows[0]!.daysAway).toBe(0);
    expect(rows[0]!.health).toBe("past_due");
    expect(summarizeProjects(rows, { investedMinutes: 0, sessionsCompleted: 0 }).projectsPastDue).toBe(1);
  });

  it("burns as overdue on the terrain", () => {
    const terrain = buildTerrain({
      workItems: [exam],
      bookedByItem: {},
      courseIds: ["crs_a"],
      now,
      timeZone: "UTC",
    });
    expect(terrain.markers[0]!.state).toBe("overdue");
  });

  it("is marked passed among the session brief's milestones", () => {
    const brief = buildSessionBrief({
      workItems: [exam],
      sessions: [],
      horizonStart: "2026-09-01",
      horizonDays: 7,
      now,
      timeZone: "UTC",
    });
    expect(brief.milestones[0]!.daysAway).toBe(0);
    expect(brief.milestones[0]!.pastDue).toBe(true);
  });

  it("is overdue on the radar", () => {
    const radar = buildCampaignRadar({
      workItems: [exam],
      gradingCategories: [],
      bookedByItem: {},
      now,
      termStartDate: "2026-08-31",
      termEndDate: "2026-12-11",
    });
    expect(radar.encounters[0]!.overdue).toBe(true);
  });
});

describe("pacing uses elapsed time, not calendar days", () => {
  const remaining = 600;
  const project = (dueAt: string) =>
    computeProjectProgress({
      workItems: [item({ id: "wi_p", dueAt, estimatedMinutes: remaining })],
      weeklyCapacityMinutes: 600_000,
      completed: [],
      booked: [],
      now: "2026-09-01T23:00:00.000Z",
      timeZone: "UTC",
    })[0]!;

  it("treats 23:00 to 09:00 tomorrow as ten hours, not a day", () => {
    const row = project("2026-09-02T09:00:00.000Z");
    expect(row.daysAway).toBe(1);
    expect(row.neededPerWeekMinutes).toBe(Math.round(remaining / (10 / 24 / 7)));
  });

  it("does not put a midnight deadline a day further off than 23:59", () => {
    const midnight = project("2026-09-02T00:00:00.000Z").neededPerWeekMinutes!;
    const lastMinute = project("2026-09-01T23:59:00.000Z").neededPerWeekMinutes!;
    expect(midnight).toBeGreaterThan(remaining * 7);
    expect(midnight).toBeLessThanOrEqual(lastMinute);
  });

  it("never divides by less than an hour", () => {
    const now = toEpochMinutes("2026-09-01T23:00:00.000Z");
    expect(daysLeftForPacing("2026-09-01T23:01:00.000Z", now)).toBeCloseTo(1 / 24);
    expect(daysLeftForPacing("2026-09-03T23:00:00.000Z", now)).toBe(2);
  });
});

describe("course health's imminent check", () => {
  it("counts calendar days, as nextDueInDays does", () => {
    // Due 23:59 three days out, seen at 09:00: three calendar days, 3.6 elapsed.
    const dueAt = "2026-09-04T23:59:00.000Z";
    const health = computeCourseHealth({
      courses: [
        {
          id: "crs_a",
          termId: "trm_t",
          name: "A",
          code: "A 100",
          instructor: null,
          credits: null,
          colorToken: "azure",
          expectedWeeklyMinutes: null,
          targetGrade: null,
          gradingConfidence: "confirmed",
        },
      ],
      load: [
        {
          courseId: "crs_a",
          bookedMinutes: 10,
          shareOfBooked: 1,
          blocks: 1,
          investedMinutes: 0,
          openItems: 1,
          openProjects: 0,
          nextDueAt: dueAt,
          nextDueTitle: "Paper",
          upkeep: "current",
          upkeepOverdue: 0,
          daysSinceProgress: null,
        },
      ],
      projects: [],
      standings: {},
      grades: [],
      gradingCategories: [],
      workItems: [item({ dueAt, estimatedMinutes: 240 })],
      now: "2026-09-01T09:00:00.000Z",
      timeZone: "UTC",
    }).courses[0]!;
    expect(health.nextDueInDays).toBe(3);
    expect(health.concerns.map((c) => c.code)).toContain("DEADLINE_UNPREPARED");
  });
});
