import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { TermCalendar } from "@schoolquest/domain";
import { calibrateWeeks, dateForWeek } from "./calibrate.js";
import type { ScheduleAnchor } from "./schema.js";

/**
 * The calibrator against the anchors two real syllabi actually print.
 *
 * Read from `tools/e2e/semester4/`, the same files the whole-semester run serves, so this cannot
 * drift away from the documents it claims to describe: change the anchors there and this fails.
 */
const DIR = new URL("../../../../tools/e2e/semester4/", import.meta.url).pathname;
const load = (key: string): ScheduleAnchor[] =>
  JSON.parse(readFileSync(`${DIR}${key}.output.json`, "utf8")).scheduleAnchors;

const TERM = { startDate: "2023-01-09", endDate: "2023-05-15" };
const CALENDAR: TermCalendar = {
  exceptions: [13, 14, 15, 16, 17, 18, 19].map((d) => ({
    date: `2023-03-${d}`,
    kind: "no_class" as const,
    label: "Spring Break",
    followsWeekday: null,
  })),
  breaksTakeWeekNumbers: true,
  source: "manual",
};

describe("calibrated against the documents themselves", () => {
  it("puts COSC 1315's week 10 assignment after the break, not inside it", () => {
    /**
     * The finding this closes. Resolved against the term's own week numbering, "Week 10"
     * landed on 17 March — inside spring break — and the app could only flag it. The document
     * says its week 9 *is* the break; the calendar says the break is the week of 13 March.
     */
    const c = calibrateWeeks(load("tamut_cosc1315"), { ...TERM, calendar: CALENDAR });
    expect(c.basis).toBe("break_anchor");
    expect(dateForWeek(10, 5, c)?.iso).toBe("2023-03-24");
  });

  it("reads MATH 104's week 1 off its own printed dates", () => {
    const c = calibrateWeeks(load("richland_math104"), { ...TERM, calendar: CALENDAR });
    expect(c.basis).toBe("dated_anchor");
    expect(c.weekOneMonday).toBe("2023-01-16");
    expect(c.duplicateWeeks).toEqual([10]);
    // And refuses everything from the duplicate on, rather than being a week early in silence.
    expect(dateForWeek(11, 5, c)).toBeNull();
  });

  it("agrees the two documents number their weeks the same way", () => {
    // Different institutions, different sources — one dated, one from a break match — and they
    // land on the same Monday. That agreement is the check on the arithmetic.
    const a = calibrateWeeks(load("tamut_cosc1315"), { ...TERM, calendar: CALENDAR });
    const b = calibrateWeeks(load("richland_math104"), { ...TERM, calendar: CALENDAR });
    expect(a.weekOneMonday).toBe(b.weekOneMonday);
  });
});
