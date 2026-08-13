import { describe, expect, it } from "vitest";
import type { GradingCategory, WorkItem } from "@schoolquest/domain";

import {
  buildCampaignRadar,
  expectedFraction,
  summarizeRadar,
  worstEncounter,
  type RadarInput,
} from "./campaign-radar.js";

const NOW = "2026-09-14T09:00:00.000Z"; // A Monday.

/** Midnight UTC `days` after "now"'s calendar date. */
const dueIn = (days: number, hour = 12): string => {
  const base = Date.parse("2026-09-14T00:00:00.000Z");
  return new Date(base + days * 86_400_000 + hour * 3_600_000).toISOString();
};

const item = (over: Partial<WorkItem> & { id: string }): WorkItem => ({
  courseId: "crs_bio",
  parentWorkItemId: null,
  title: "Problem set",
  description: null,
  workType: "problem_set",
  availableAt: null,
  dueAt: dueIn(3),
  pointsPossible: null,
  gradingCategoryId: null,
  categorySharePercent: null,
  estimatedMinutes: 120,
  remainingMinutes: null,
  cognitiveDemand: "medium",
  divisibility: "divisible",
  locationRequirement: "anywhere",
  status: "not_started",
  sourceConfidence: "confirmed",
  userPriority: 0,
  ...over,
});

const category = (over: Partial<GradingCategory> & { id: string }): GradingCategory => ({
  courseId: "crs_bio",
  name: "Exams",
  weightPercent: 40,
  dropRule: null,
  confidenceStatus: "confirmed",
  ...over,
});

const run = (over: Partial<RadarInput> = {}) =>
  buildCampaignRadar({
    workItems: [],
    gradingCategories: [],
    bookedByItem: {},
    now: NOW,
    ...over,
  });

describe("buildCampaignRadar", () => {
  describe("placement", () => {
    it("puts today's work at the centre and next week's a week out", () => {
      const radar = run({
        workItems: [item({ id: "a", dueAt: dueIn(0) }), item({ id: "b", dueAt: dueIn(7) })],
      });
      const [a, b] = radar.encounters;
      expect(a!.daysAway).toBe(0);
      expect(b!.daysAway).toBe(7);
    });

    it("counts calendar days, so work due tomorrow morning is tomorrow's", () => {
      // Ten hours away, but a different day. A floor of the raw difference would call this
      // "today", which is the one thing a student cannot afford to be told wrongly.
      const radar = run({ workItems: [item({ id: "a", dueAt: dueIn(1, 5) })] });
      expect(radar.encounters[0]!.daysAway).toBe(1);
    });

    it("puts the same weekday on the same spoke every week", () => {
      const radar = run({
        workItems: [
          item({ id: "a", dueAt: dueIn(2) }),
          item({ id: "b", dueAt: dueIn(9) }),
          item({ id: "c", dueAt: dueIn(16) }),
        ],
      });
      const bearings = radar.encounters.map((e) => e.bearingIndex);
      expect(bearings).toEqual([2, 2, 2]);
      // And they really are the same weekday, not just the same arithmetic.
      expect(new Set(radar.encounters.map((e) => e.dayOfWeek)).size).toBe(1);
    });

    it("gives a late Monday the same spoke as next Monday", () => {
      // The overdue band mirrors the sweep below the baseline, so a column read through the
      // line is one weekday. That only holds if bearing wraps the same way in both directions.
      const radar = run({
        workItems: [item({ id: "late", dueAt: dueIn(-3) }), item({ id: "next", dueAt: dueIn(4) })],
      });
      const bearings = Object.fromEntries(radar.encounters.map((e) => [e.id, e.bearingIndex]));
      expect(bearings["late"]).toBe(bearings["next"]);
      expect(new Set(radar.encounters.map((e) => e.dayOfWeek)).size).toBe(1);
    });

    it("puts today on spoke zero whatever day of the week today is", () => {
      // The prototype hard-coded Monday at the origin because its fixtures assumed it.
      // Bearing has to be relative to today or the whole sweep rotates by the day of the week.
      const wednesday = run({
        workItems: [item({ id: "a", dueAt: "2026-09-16T12:00:00.000Z" })],
        now: "2026-09-16T09:00:00.000Z",
      });
      expect(wednesday.encounters[0]!.bearingIndex).toBe(0);
    });

    it("pins overdue work at the centre rather than behind the student", () => {
      const radar = run({ workItems: [item({ id: "a", dueAt: dueIn(-3) })] });
      const encounter = radar.encounters[0]!;
      expect(encounter.daysAway).toBe(-3);
      expect(encounter.distanceDays).toBe(0);
      expect(encounter.overdue).toBe(true);
    });

    it("counts work past the horizon instead of placing it", () => {
      const radar = run({
        workItems: [item({ id: "a", dueAt: dueIn(40) }), item({ id: "b", dueAt: dueIn(3) })],
      });
      expect(radar.encounters.map((e) => e.id)).toEqual(["b"]);
      expect(radar.beyondCount).toBe(1);
    });

    it("counts undated work instead of inventing a place for it", () => {
      const radar = run({ workItems: [item({ id: "a", dueAt: null })] });
      expect(radar.encounters).toHaveLength(0);
      expect(radar.undatedCount).toBe(1);
    });

    it("leaves finished and canceled work off the board", () => {
      const radar = run({
        workItems: [
          item({ id: "done", status: "completed" }),
          item({ id: "sent", status: "submitted" }),
          item({ id: "dropped", status: "canceled" }),
          item({ id: "extra", status: "optional" }),
          item({ id: "live" }),
        ],
      });
      expect(radar.encounters.map((e) => e.id)).toEqual(["live"]);
    });
  });

  describe("threat tier", () => {
    it("normalizes points and category weights to the same share of the grade", () => {
      // One course states raw points, the other states a category weight. A 200-point final
      // out of 1000 and a 20%-weighted final are the same fifth of the grade, and the radar
      // has to draw them the same size or the sizes mean nothing across classes.
      const byPoints = run({
        workItems: [
          item({ id: "final", courseId: "pts", pointsPossible: 200, dueAt: dueIn(3) }),
          item({ id: "rest", courseId: "pts", pointsPossible: 800, dueAt: dueIn(5) }),
        ],
      });
      const byWeight = run({
        workItems: [item({ id: "final", courseId: "wgt", gradingCategoryId: "cat" })],
        gradingCategories: [category({ id: "cat", courseId: "wgt", weightPercent: 20 })],
      });

      const a = byPoints.encounters.find((e) => e.id === "final")!;
      const b = byWeight.encounters.find((e) => e.id === "final")!;
      expect(a.gradeShare).toBeCloseTo(0.2, 5);
      expect(b.gradeShare).toBeCloseTo(0.2, 5);
      expect(a.tier).toBe(b.tier);
      expect(a.tier).toBe(5);
    });

    it("scales the tier with the share of the grade", () => {
      const radar = run({
        workItems: [
          item({ id: "speck", pointsPossible: 10, dueAt: dueIn(2) }),
          item({ id: "boulder", pointsPossible: 300, dueAt: dueIn(4) }),
          item({ id: "filler", pointsPossible: 690, dueAt: dueIn(6) }),
        ],
      });
      const tiers = Object.fromEntries(radar.encounters.map((e) => [e.id, e.tier]));
      expect(tiers["speck"]).toBe(1);
      expect(tiers["boulder"]).toBe(5);
    });

    it("falls back to the work type without inventing a percentage", () => {
      const radar = run({ workItems: [item({ id: "exam", workType: "exam" })] });
      const encounter = radar.encounters[0]!;
      expect(encounter.gradeShare).toBeNull();
      expect(encounter.tier).toBe(4);
    });
  });

  describe("the verdict", () => {
    it("leaves a big piece of work calm before its runway opens", () => {
      // Twelve hours of paper, three weeks out, nothing booked. The naive booked/needed ratio
      // calls this critical the day it appears on a syllabus, and a screen that is always red
      // is not a warning.
      const radar = run({
        workItems: [
          item({ id: "paper", workType: "paper", estimatedMinutes: 720, dueAt: dueIn(25) }),
        ],
      });
      const encounter = radar.encounters[0]!;
      expect(encounter.health).toBe("ok");
      expect(encounter.advice).toBe("NOT_YET_DUE_WORK");
      // The real figures are still reported, unmassaged.
      expect(encounter.hoursNeeded).toBe(12);
      expect(encounter.hoursBanked).toBe(0);
      expect(encounter.coverage).toBe(0);
    });

    it("turns the same piece of work critical once the runway has opened", () => {
      const radar = run({
        workItems: [
          item({ id: "paper", workType: "paper", estimatedMinutes: 720, dueAt: dueIn(4) }),
        ],
      });
      expect(radar.encounters[0]!.health).toBe("crit");
      expect(radar.encounters[0]!.advice).toBe("BOOK_NOW");
    });

    it("reads booked time as on pace", () => {
      const radar = run({
        workItems: [item({ id: "a", estimatedMinutes: 120, dueAt: dueIn(1) })],
        bookedByItem: { a: 120 },
      });
      expect(radar.encounters[0]!.health).toBe("ok");
      expect(radar.encounters[0]!.advice).toBe("HOLD");
      expect(radar.encounters[0]!.shortfallHours).toBe(0);
    });

    it("reads a partly booked item as one session short", () => {
      const radar = run({
        workItems: [item({ id: "a", estimatedMinutes: 120, dueAt: dueIn(0) })],
        bookedByItem: { a: 90 },
      });
      const encounter = radar.encounters[0]!;
      expect(encounter.health).toBe("warn");
      expect(encounter.advice).toBe("ONE_MORE_SESSION");
      expect(encounter.shortfallHours).toBe(0.5);
    });

    it("never calls overdue work provisioned, however much time was booked", () => {
      const radar = run({
        workItems: [item({ id: "a", estimatedMinutes: 120, dueAt: dueIn(-2) })],
        bookedByItem: { a: 600 },
      });
      const encounter = radar.encounters[0]!;
      expect(encounter.health).toBe("warn");
      expect(encounter.advice).toBe("OVERDUE");
    });

    it("keeps coverage and readiness apart", () => {
      // Coverage is the bar: how much of the work is booked. Readiness is the verdict: how
      // much of what should be booked by now is. Collapsing them is what makes the naive
      // ratio wrong, so nothing may quietly substitute one for the other.
      const radar = run({
        workItems: [item({ id: "a", estimatedMinutes: 600, dueAt: dueIn(9) })],
        bookedByItem: { a: 300 },
      });
      const encounter = radar.encounters[0]!;
      expect(encounter.coverage).toBe(0.5);
      expect(encounter.readiness).toBeGreaterThan(encounter.coverage);
    });
  });

  describe("boss merging", () => {
    const twoExams = () => ({
      workItems: [
        item({ id: "bio_exam", courseId: "bio", workType: "exam", estimatedMinutes: 480, dueAt: dueIn(9) }),
        item({ id: "lit_paper", courseId: "lit", workType: "paper", estimatedMinutes: 600, dueAt: dueIn(9, 23) }),
        item({ id: "small", workType: "reading", dueAt: dueIn(9) }),
      ],
    });

    it("folds two heavy things on one day into a single encounter", () => {
      const radar = run(twoExams());
      const boss = radar.encounters.find((e) => e.boss)!;
      expect(boss.memberIds).toEqual(["bio_exam", "lit_paper"]);
      expect(boss.courseIds).toEqual(["bio", "lit"]);
      // Hours are the sums, so the dossier describes the fight actually being walked into.
      expect(boss.hoursNeeded).toBe(18);
      expect(boss.workType).toBe("mixed");
      // The pieces are gone from the board; the light reading beside them is not.
      expect(radar.encounters.map((e) => e.id).sort()).toEqual([`boss:${boss.dueDate}`, "small"]);
    });

    it("leaves a lone heavy item alone", () => {
      const radar = run({
        workItems: [item({ id: "exam", workType: "exam", dueAt: dueIn(5) })],
      });
      expect(radar.encounters[0]!.boss).toBe(false);
    });

    it("carries a stable string id that nothing has to hash to a number", () => {
      // The prototype's jitter hashed the numeric id and fell back to a day-derived key; a
      // NaN there silently drops a marker into the corner of the frame.
      const radar = run(twoExams());
      const boss = radar.encounters.find((e) => e.boss)!;
      expect(boss.id).toBe(`boss:${boss.dueDate}`);
      expect(Number.isFinite(boss.distanceDays)).toBe(true);
      expect(Number.isFinite(boss.bearingIndex)).toBe(true);
    });

    it("says to split the prep when the merged day is short", () => {
      const radar = run(twoExams());
      const boss = radar.encounters.find((e) => e.boss)!;
      expect(boss.advice).toBe("SPLIT_THE_BOSS");
    });

    it("does not merge two heavy things in different weeks", () => {
      const radar = run({
        workItems: [
          item({ id: "a", workType: "exam", dueAt: dueIn(4) }),
          item({ id: "b", workType: "exam", dueAt: dueIn(11) }),
        ],
      });
      expect(radar.encounters.filter((e) => e.boss)).toHaveLength(0);
    });
  });

  describe("the term map", () => {
    const termDates = { termStartDate: "2026-08-31", termEndDate: "2026-12-11" };

    it("draws one bar per week of the term and marks the week we are in", () => {
      const radar = run({ ...termDates, workItems: [item({ id: "a" })] });
      expect(radar.termWeeks).toHaveLength(15);
      expect(radar.currentTermWeek).toBe(3);
      expect(radar.termWeeks[0]!.isPast).toBe(true);
      expect(radar.termWeeks[2]!.isCurrent).toBe(true);
    });

    it("measures a week by the work due in it, not the time booked for it", () => {
      const radar = run({
        ...termDates,
        workItems: [
          item({ id: "a", estimatedMinutes: 600, dueAt: dueIn(3) }),
          item({ id: "b", estimatedMinutes: 60, dueAt: dueIn(10) }),
        ],
        bookedByItem: { a: 600 },
      });
      const heavy = radar.termWeeks.find((w) => w.isCurrent)!;
      expect(heavy.hours).toBe(10);
      expect(heavy.intensity).toBe(1);
      expect(radar.termWeeks[3]!.intensity).toBe(0.1);
    });

    it("flags the weeks that contain a boss", () => {
      const radar = run({
        ...termDates,
        workItems: [
          item({ id: "a", workType: "exam", dueAt: dueIn(9) }),
          item({ id: "b", workType: "paper", dueAt: dueIn(9) }),
        ],
      });
      expect(radar.termWeeks.filter((w) => w.hasBoss).map((w) => w.weekNumber)).toEqual([4]);
    });

    it("draws no map at all rather than a fake one when the term has no dates", () => {
      const radar = run({ workItems: [item({ id: "a" })] });
      expect(radar.termWeeks).toEqual([]);
      expect(radar.currentTermWeek).toBeNull();
    });

    it("keeps the week numbering before the term has started", () => {
      // Setting up in August, before the first day of instruction, is the ordinary case and
      // the moment the semester's own week numbers are most worth showing. Reporting "we do
      // not know which week it is" loses them from the ring labels for the whole of setup.
      const radar = run({ termStartDate: "2026-09-28", termEndDate: "2026-12-11" });
      expect(radar.currentTermWeek).toBe(0);
      expect(radar.termWeeks.some((w) => w.isCurrent)).toBe(false);
    });

    it("still says which week it is on the last day of the term", () => {
      const radar = run({ termStartDate: "2026-08-31", termEndDate: "2026-09-14" });
      expect(radar.currentTermWeek).toBe(3);
    });
  });

  it("is deterministic: the same inputs give the same board", () => {
    const input = {
      workItems: [
        item({ id: "a", dueAt: dueIn(2) }),
        item({ id: "b", workType: "exam", dueAt: dueIn(9) }),
        item({ id: "c", workType: "paper", dueAt: dueIn(9) }),
      ],
      termStartDate: "2026-08-31",
      termEndDate: "2026-12-11",
    };
    expect(JSON.stringify(run(input))).toBe(JSON.stringify(run(input)));
  });
});

describe("expectedFraction", () => {
  it("owes nothing before the runway opens and everything on the day", () => {
    expect(expectedFraction(40, 720)).toBe(0);
    expect(expectedFraction(0, 720)).toBe(1);
    expect(expectedFraction(-2, 720)).toBe(1);
  });

  it("gives bigger work a longer runway", () => {
    // A twelve-hour paper is already owed time at a point where a one-hour reading is not.
    expect(expectedFraction(14, 720)).toBeGreaterThan(0);
    expect(expectedFraction(14, 60)).toBe(0);
  });
});

describe("summarizeRadar", () => {
  const radar = () =>
    run({
      workItems: [
        item({ id: "near", estimatedMinutes: 120, dueAt: dueIn(1) }),
        item({ id: "far", workType: "paper", estimatedMinutes: 720, dueAt: dueIn(24) }),
      ],
    }).encounters;

  it("counts only what the horizon actually shows", () => {
    expect(summarizeRadar(radar(), 28).inRange).toBe(2);
    expect(summarizeRadar(radar(), 7).inRange).toBe(1);
  });

  it("adds up the hours that should already be booked and are not", () => {
    const summary = summarizeRadar(radar(), 7);
    expect(summary.critical).toBe(1);
    expect(summary.deficitHours).toBeGreaterThan(0);
    expect(summary.partyPercent).toBe(0);
  });

  it("calls an empty board fully healthy rather than dividing by zero", () => {
    expect(summarizeRadar([], 28)).toMatchObject({ inRange: 0, partyPercent: 100 });
  });
});

describe("worstEncounter", () => {
  it("puts the boss ahead of everything so the dossier is never neutral", () => {
    const encounters = run({
      workItems: [
        item({ id: "crit_now", estimatedMinutes: 120, dueAt: dueIn(0) }),
        item({ id: "exam", workType: "exam", estimatedMinutes: 480, dueAt: dueIn(9) }),
        item({ id: "paper", workType: "paper", estimatedMinutes: 600, dueAt: dueIn(9) }),
      ],
    }).encounters;
    expect(worstEncounter(encounters)!.boss).toBe(true);
  });

  it("returns nothing at all on an empty board", () => {
    expect(worstEncounter([])).toBeNull();
  });
});
