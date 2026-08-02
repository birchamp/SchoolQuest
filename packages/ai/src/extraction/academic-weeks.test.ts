import { describe, expect, it } from "vitest";
import type { TermCalendar } from "@schoolquest/domain";
import { academicWeeks, breakCovering, lookupWeek, mondayOnOrBefore } from "./academic-weeks.js";
import { expandRecurrence } from "./expand-recurrence.js";
import { resolveWeekdayForClaim } from "./resolve-dates.js";
import type { ExtractedAssignment } from "./schema.js";

/**
 * The fixture term, with the calendar the two-date version never had.
 *
 * Instruction 24 August – 11 December 2026. Thanksgiving 23–27 November, which every one of
 * the five constructed syllabuses names and none of them could act on. Finals 14–18 December,
 * which MAT 205 states verbatim.
 */
const CALENDAR: TermCalendar = {
  breaks: [{ name: "Thanksgiving Break", startDate: "2026-11-23", endDate: "2026-11-27" }],
  finalsStartDate: "2026-12-14",
  finalsEndDate: "2026-12-18",
  breaksTakeWeekNumbers: false,
};
const TERM = { termStartDate: "2026-08-24", termEndDate: "2026-12-11", calendar: CALENDAR };
const NO_CALENDAR = { termStartDate: "2026-08-24", termEndDate: "2026-12-11" };

describe("laying out the term's weeks", () => {
  it("anchors week 1 on the Monday of the week instruction starts", () => {
    // LAN 200 starts Tuesday 25 August and its own table calls "Aug. 25-28" week 1.
    expect(mondayOnOrBefore("2026-08-25")).toBe("2026-08-24");
    expect(mondayOnOrBefore("2026-08-24")).toBe("2026-08-24");
    // Sunday is the end of its week, not the start of the next.
    expect(mondayOnOrBefore("2026-08-30")).toBe("2026-08-24");
  });

  it("keeps both numberings, and they diverge at the break", () => {
    const weeks = academicWeeks(TERM);
    const thanksgiving = weeks.find((w) => w.start === "2026-11-23")!;
    expect(thanksgiving.isBreak).toBe(true);
    expect(thanksgiving.instructionalNumber).toBeNull();
    expect(thanksgiving.breakName).toBe("Thanksgiving Break");

    const after = weeks.find((w) => w.start === "2026-11-30")!;
    // The two conventions, side by side. This one week's disagreement is the whole bug.
    expect(after.elapsedNumber).toBe(15);
    expect(after.instructionalNumber).toBe(14);
  });

  it("does not let a partial break consume a week", () => {
    // HIS 210: "Nov. 24, 2026  Thanksgiving Break  no class Thursday". Monday still has class,
    // so that week is an instructional week and keeps its number.
    const partial = academicWeeks({
      ...NO_CALENDAR,
      calendar: { ...CALENDAR, breaks: [{ name: "Thanksgiving", startDate: "2026-11-25", endDate: "2026-11-27" }] },
    });
    const week = partial.find((w) => w.start === "2026-11-23")!;
    expect(week.isBreak).toBe(false);
    expect(week.instructionalNumber).not.toBeNull();
    // Still named, so a caller can say "this week is short" without dropping it.
    expect(week.breakName).toBe("Thanksgiving");
  });

  it("finds the break covering a date", () => {
    expect(breakCovering("2026-11-24", TERM)).toBe("Thanksgiving Break");
    expect(breakCovering("2026-11-17", TERM)).toBeNull();
  });
});

describe("what a syllabus means by 'Week N'", () => {
  it("agrees with itself before the term's first break", () => {
    for (const week of [1, 5, 10, 12]) {
      const hit = lookupWeek(week, TERM)!;
      expect(hit.ambiguous).toBe(false);
    }
    expect(lookupWeek(3, TERM)).toMatchObject({ start: "2026-09-07" });
  });

  it("resolves week 14 to the week the other syllabuses print", () => {
    /**
     * The bug, fixed. MAT 205 says "Problem Set 6 due Week 14"; BIO 240 and HIS 210 both put
     * week 14 at 30 November, because neither numbers Thanksgiving. Before the calendar
     * existed this resolved to 23 November — the break itself.
     */
    expect(lookupWeek(14, TERM)).toMatchObject({ start: "2026-11-30", ambiguous: false });
  });

  it("refuses to pick when nobody has said how the school counts breaks", () => {
    const unsure = { ...TERM, calendar: { ...CALENDAR, breaksTakeWeekNumbers: null } };
    const hit = lookupWeek(14, unsure)!;
    expect(hit.ambiguous).toBe(true);
    expect(hit.start).toBe("2026-11-30");
    expect(hit.alternative).toEqual({ start: "2026-11-23", end: "2026-11-29" });
  });

  it("counts every week when the school does number its breaks", () => {
    // BIB301 numbers Research Week 8. A school whose syllabi do this is the other convention.
    const counting = { ...TERM, calendar: { ...CALENDAR, breaksTakeWeekNumbers: true } };
    expect(lookupWeek(14, counting)).toMatchObject({ start: "2026-11-23", ambiguous: false });
  });
});

describe("recurrence against the real calendar", () => {
  const response: ExtractedAssignment = {
    title: "Reading Response",
    type: "reading",
    dueDate: { iso: null, raw: "each Tuesday", time: null, ambiguity: "missing" },
    pointsPossible: null,
    category: "Reading Responses",
    isMajorProject: false,
    recurrence: { frequency: "weekly", dayOfWeek: 2, count: null, dropLowest: null },
    evidence: { page: 1, excerpt: "due each Tuesday in class" },
    confidence: 0.9,
  };

  it("stops putting a reading response inside Thanksgiving", () => {
    /**
     * ENG 230: "A short response to the assigned reading is due each Tuesday **in class**."
     * Without a calendar this produced sixteen, one of them Tuesday 24 November, in a week
     * with no Tuesday class. Fifteen is the right number and the break is why.
     */
    const withCalendar = expandRecurrence(response, TERM);
    const without = expandRecurrence(response, NO_CALENDAR);

    expect(without).toHaveLength(16);
    expect(without.map((a) => a.dueDate.iso)).toContain("2026-11-24");

    expect(withCalendar).toHaveLength(15);
    expect(withCalendar.map((a) => a.dueDate.iso)).not.toContain("2026-11-24");
    // And the week either side is untouched.
    expect(withCalendar.map((a) => a.dueDate.iso)).toContain("2026-11-17");
    expect(withCalendar.map((a) => a.dueDate.iso)).toContain("2026-12-01");
  });

  it("leaves a Sunday deadline alone when the break is Monday to Friday", () => {
    /**
     * PED 110: "A weekly fitness log is due each Sunday by 9:00 pm, submitted online. There
     * are 14 logs." Thanksgiving break runs Monday 23 to Friday 27 November, so no Sunday is
     * inside it — and that is the right answer, not a near miss. The break removes *class
     * days*, and nothing about being away from campus stops a log being filed on the Sunday.
     *
     * The distinction matters because the obvious over-correction is to drop anything in the
     * break's calendar week, which would delete a real deadline the student still owes.
     */
    const logs = expandRecurrence(
      {
        ...response,
        title: "Weekly Fitness Log",
        recurrence: { frequency: "weekly", dayOfWeek: 0, count: 14, dropLowest: 2 },
      },
      TERM,
    );
    expect(logs).toHaveLength(14);
    // Both Sundays either side of the break survive.
    expect(logs.map((a) => a.dueDate.iso)).toContain("2026-11-22");
    expect(logs.map((a) => a.dueDate.iso)).toContain("2026-11-29");
    expect(breakCovering("2026-11-29", TERM)).toBeNull();
  });
});

describe("a weekday answer against the real calendar", () => {
  const term = { startDate: "2026-08-24", endDate: "2026-12-11", calendar: CALENDAR };

  it("puts Problem Set 6 where the rest of the term thinks week 14 is", () => {
    // The headline. "Week 14" + Monday used to give 2026-11-23, in the break.
    expect(resolveWeekdayForClaim("Week 14", 1, term)).toEqual({
      iso: "2026-11-30",
      basis: "class_meeting",
    });
  });

  it("hands back both candidates when the convention is unknown", () => {
    const unsure = { ...term, calendar: { ...CALENDAR, breaksTakeWeekNumbers: null } };
    expect(resolveWeekdayForClaim("Week 14", 1, unsure)).toEqual({
      iso: "2026-11-30",
      basis: "week_number_ambiguous",
      alternativeIso: "2026-11-23",
    });
  });

  it("says so when an explicit range lands in a break", () => {
    // A syllabus row printed with real dates that fall in the break — the answer cannot be
    // describing a class meeting whatever else is true.
    expect(resolveWeekdayForClaim("Nov. 23-27, 2026", 3, term)).toEqual({
      iso: "2026-11-25",
      basis: "not_a_class_day",
    });
  });

  it("uses the stated finals window rather than inferring one", () => {
    expect(resolveWeekdayForClaim("December 14-18, 2026", 1, term)).toEqual({
      iso: "2026-12-14",
      basis: "registrar_window",
    });
  });

  it("behaves exactly as before for a term with no calendar", () => {
    const bare = { startDate: "2026-08-24", endDate: "2026-12-11" };
    expect(resolveWeekdayForClaim("Week 5", 1, bare)).toEqual({
      iso: "2026-09-21",
      basis: "class_meeting",
    });
    expect(resolveWeekdayForClaim("December 14-18, 2026", 1, bare)).toEqual({
      iso: "2026-12-14",
      basis: "registrar_window",
    });
  });
});
