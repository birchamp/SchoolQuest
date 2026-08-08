import { describe, expect, it } from "vitest";
import type { TermCalendar } from "@schoolquest/domain";
import type { ScheduleAnchor } from "./schema.js";
import { calibrateWeeks, dateForWeek } from "./calibrate.js";

/**
 * Week calibration, against the two real documents that made it necessary.
 *
 * Both are Spring 2023 and both date their work by week number. One prints its dates and one
 * prints none at all, which is exactly the split that decides whether this can work.
 */

/** The Spring 2023 term the four-syllabus run used: 9 Jan – 15 May, break the week of 13 March. */
const TERM = { startDate: "2023-01-09", endDate: "2023-05-15" };
const CALENDAR: TermCalendar = {
  exceptions: ["13", "14", "15", "16", "17", "18", "19"].map((d) => ({
    date: `2023-03-${d}`,
    kind: "no_class" as const,
    label: "Spring Break",
    followsWeekday: null,
  })),
  breaksTakeWeekNumbers: true,
  source: "manual",
};

const anchor = (weekNumber: number, raw: string | null, isBreak = false): ScheduleAnchor => ({
  weekNumber,
  raw,
  isBreak,
  evidence: { page: 1, excerpt: raw ?? `Week ${weekNumber}` },
});

describe("a syllabus that prints its week dates", () => {
  /**
   * Richland MATH 104: "Week 1, January 17–22", "Week 9, March 13-19 . . . Spring Break", and
   * then "Week 10" twice — March 20–26 and March 27–April 2 — with no Week 16 anywhere.
   */
  const RICHLAND = [
    anchor(1, "January 17–22"),
    anchor(9, "March 13-19", true),
    anchor(10, "March 20–26"),
    anchor(10, "March 27–April 2"),
    anchor(15, "May 1–7"),
  ];

  it("reads week 1 off the document rather than off the term", () => {
    const c = calibrateWeeks(RICHLAND, { ...TERM, calendar: CALENDAR });
    // The term's own week 1 starts 9 January; this document's starts a week later, and only the
    // document knows that.
    expect(c.weekOneMonday).toBe("2023-01-16");
    expect(c.basis).toBe("dated_anchor");
  });

  it("reports the duplicate week number and the missing one", () => {
    const c = calibrateWeeks(RICHLAND, { ...TERM, calendar: CALENDAR });
    expect(c.duplicateWeeks).toEqual([10]);
    expect(c.skippedWeeks).toEqual([2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14]);
  });

  it("refuses every week from the duplicate onwards", () => {
    /**
     * The important half. Before "Week 10" appears twice the numbering is trustworthy; after it,
     * the number no longer identifies a week and no arithmetic recovers which was meant.
     *
     * Silently returning the first of the two is what produced a one-week-early date at high
     * confidence, which is the failure this whole module exists to stop.
     */
    const c = calibrateWeeks(RICHLAND, { ...TERM, calendar: CALENDAR });
    expect(dateForWeek(9, 5, c)?.iso).toBe("2023-03-17");
    expect(dateForWeek(10, 5, c)).toBeNull();
    expect(dateForWeek(14, 5, c)).toBeNull();
  });
});

describe("a syllabus that prints no dates at all", () => {
  /**
   * TAMU-Texarkana COSC 1315: seventeen numbered weeks, "Week 9 Spring break", and not one
   * calendar date in the document.
   *
   * Resolved against the term's own numbering, its week 10 assignment landed on 17 March —
   * inside spring break. The app caught that and asked, which is the defence working, but the
   * date was still wrong and both facts needed to fix it were already held.
   */
  const TAMUT = [anchor(1, null), anchor(8, null), anchor(9, null, true), anchor(10, null), anchor(17, null)];

  it("anchors week 1 from the break the document numbers", () => {
    const c = calibrateWeeks(TAMUT, { ...TERM, calendar: CALENDAR });
    expect(c.basis).toBe("break_anchor");
    // Its week 9 is the week of 13 March, so its week 1 is 16 January — eight weeks earlier.
    expect(c.weekOneMonday).toBe("2023-01-16");
  });

  it("puts the week 10 assignment after the break instead of inside it", () => {
    const c = calibrateWeeks(TAMUT, { ...TERM, calendar: CALENDAR });
    const friday = dateForWeek(10, 5, c);
    expect(friday?.iso).toBe("2023-03-24");
    // Not certain: derived from a break match rather than a date the document printed.
    expect(friday?.certain).toBe(false);
  });

  it("says nothing when there is no break to match against", () => {
    // A term with no calendar is exactly the state that should raise a question, not a date.
    const c = calibrateWeeks(TAMUT, TERM);
    expect(c.weekOneMonday).toBeNull();
    expect(c.basis).toBe("none");
    expect(dateForWeek(10, 5, c)).toBeNull();
  });
});

describe("what it declines to do", () => {
  it("returns nothing for a document with no week headers", () => {
    const c = calibrateWeeks([], { ...TERM, calendar: CALENDAR });
    expect(c).toMatchObject({ weekOneMonday: null, basis: "none", breaksTakeWeekNumbers: null });
  });

  it("notices a syllabus that starts counting from week zero", () => {
    // Richland MATH 122 does exactly this: "Week 0, January 13–16", then "Week 1, January 17–23".
    const c = calibrateWeeks([anchor(0, "January 13–16"), anchor(1, "January 17–23")], {
      ...TERM,
      calendar: CALENDAR,
    });
    // Week 1 is the week of 16 January; week 0 is the week before, which the arithmetic handles
    // without needing a special case.
    expect(c.weekOneMonday).toBe("2023-01-16");
  });
});
