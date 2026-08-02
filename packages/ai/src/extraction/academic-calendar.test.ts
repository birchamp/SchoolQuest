import { describe, expect, it } from "vitest";
import { validateAcademicCalendar, type AcademicCalendarReading } from "./academic-calendar.js";

/**
 * A real academic calendar page, in the shape schools actually publish: dated lines, mixed
 * single days and ranges, and a pile of entries about money and registration that have nothing
 * to do with whether class meets.
 */
const PASTED = `RIVERBEND COLLEGE — ACADEMIC CALENDAR, FALL 2026

August 17, 2026        Residence halls open for new students
August 21, 2026        Tuition payment deadline
August 24, 2026        First day of classes
September 7, 2026      Labor Day — no classes
September 11, 2026     Last day to add or drop without a W
October 12-13, 2026    Fall Break — no classes
November 24, 2026      Tuesday classes follow a Friday schedule
November 25-27, 2026   Thanksgiving Recess — no classes
December 11, 2026      Last day of classes
December 12, 2026      Reading Day
December 14-18, 2026   Final Examinations
December 19, 2026      Residence halls close
January 11, 2027       Spring classes begin`;

const TERM = { termStartDate: "2026-08-24", termEndDate: "2026-12-11" };

function reading(overrides: Partial<AcademicCalendarReading> = {}): AcademicCalendarReading {
  return {
    instructionStartDate: "2026-08-24",
    instructionEndDate: "2026-12-11",
    entries: [
      { startDate: "2026-08-24", endDate: "2026-08-24", kind: "instruction_bound", label: "First day of classes", followsWeekday: null, evidence: "August 24, 2026        First day of classes" },
      { startDate: "2026-09-07", endDate: "2026-09-07", kind: "no_class", label: "Labor Day", followsWeekday: null, evidence: "September 7, 2026      Labor Day — no classes" },
      { startDate: "2026-10-12", endDate: "2026-10-13", kind: "no_class", label: "Fall Break", followsWeekday: null, evidence: "October 12-13, 2026    Fall Break — no classes" },
      { startDate: "2026-11-24", endDate: "2026-11-24", kind: "reading", label: "Friday schedule", followsWeekday: 5, evidence: "November 24, 2026      Tuesday classes follow a Friday schedule" },
      { startDate: "2026-11-25", endDate: "2026-11-27", kind: "no_class", label: "Thanksgiving Recess", followsWeekday: null, evidence: "November 25-27, 2026   Thanksgiving Recess — no classes" },
      { startDate: "2026-12-11", endDate: "2026-12-11", kind: "instruction_bound", label: "Last day of classes", followsWeekday: null, evidence: "December 11, 2026      Last day of classes" },
      { startDate: "2026-12-12", endDate: "2026-12-12", kind: "reading", label: "Reading Day", followsWeekday: null, evidence: "December 12, 2026      Reading Day" },
      { startDate: "2026-12-14", endDate: "2026-12-18", kind: "finals", label: "Final Examinations", followsWeekday: null, evidence: "December 14-18, 2026   Final Examinations" },
    ],
    unreadableLines: [],
    ...overrides,
  };
}

describe("reading a pasted academic calendar", () => {
  const result = validateAcademicCalendar(reading(), { pastedText: PASTED, ...TERM });

  it("expands ranges to days, because that is arithmetic", () => {
    // Fall Break is two days; Thanksgiving three; finals five. Nine plus the two single days.
    const dates = result.exceptions.map((e) => e.date);
    expect(dates).toContain("2026-10-12");
    expect(dates).toContain("2026-10-13");
    expect(dates).toEqual([...dates].sort());
    expect(result.exceptions.filter((e) => e.kind === "finals")).toHaveLength(5);
  });

  it("keeps a one-day holiday as one day", () => {
    // The case a range list handles badly and the reason the bedrock is by day.
    const labor = result.exceptions.filter((e) => e.label === "Labor Day");
    expect(labor).toHaveLength(1);
    expect(labor[0]!.date).toBe("2026-09-07");
  });

  it("carries a day that runs another weekday's schedule", () => {
    const swap = result.exceptions.find((e) => e.date === "2026-11-24")!;
    expect(swap.followsWeekday).toBe(5);
  });

  it("takes the instruction bounds only where an entry supports them", () => {
    expect(result.instructionStartDate).toBe("2026-08-24");
    expect(result.instructionEndDate).toBe("2026-12-11");
  });

  it("does not let a bound through that no entry mentions", () => {
    // A bound the model reports but the entry list does not support would silently move the
    // whole term, which is the largest single thing this reading can get wrong.
    const bad = validateAcademicCalendar(
      reading({ instructionStartDate: "2026-08-31", entries: reading().entries.slice(1) }),
      { pastedText: PASTED, ...TERM },
    );
    expect(bad.instructionStartDate).toBeNull();
  });

  it("discards an invented holiday", () => {
    /**
     * The check that matters most. A fabricated no-class day silently deletes a day the
     * student really does have class — worse than missing one, because nothing looks wrong.
     */
    const invented = validateAcademicCalendar(
      reading({
        entries: [
          ...reading().entries,
          { startDate: "2026-10-05", endDate: "2026-10-05", kind: "no_class", label: "Founders Day", followsWeekday: null, evidence: "October 5, 2026        Founders Day — no classes" },
        ],
      }),
      { pastedText: PASTED, ...TERM },
    );
    expect(invented.exceptions.map((e) => e.date)).not.toContain("2026-10-05");
    expect(invented.rejected).toHaveLength(1);
    expect(invented.rejected[0]!.reason).toContain("not in the calendar you pasted");
  });

  it("drops the other semester without complaining about it", () => {
    // Calendar pages cover the whole year. January is not an error, it is the spring term.
    const spring = validateAcademicCalendar(
      reading({
        entries: [
          ...reading().entries,
          { startDate: "2027-01-11", endDate: "2027-01-11", kind: "instruction_bound", label: "Spring classes begin", followsWeekday: null, evidence: "January 11, 2027       Spring classes begin" },
        ],
      }),
      { pastedText: PASTED, ...TERM },
    );
    expect(spring.exceptions.map((e) => e.date)).not.toContain("2027-01-11");
    expect(spring.rejected).toEqual([]);
  });

  it("rejects a backwards range rather than storing it", () => {
    const backwards = validateAcademicCalendar(
      reading({
        entries: [
          { startDate: "2026-11-27", endDate: "2026-11-25", kind: "no_class", label: "Thanksgiving Recess", followsWeekday: null, evidence: "November 25-27, 2026   Thanksgiving Recess — no classes" },
        ],
      }),
      { pastedText: PASTED, ...TERM },
    );
    expect(backwards.exceptions).toEqual([]);
    expect(backwards.rejected[0]!.reason).toContain("ended before it started");
  });

  it("says so when it found no exam period", () => {
    const noFinals = validateAcademicCalendar(
      reading({ entries: reading().entries.filter((e) => e.kind !== "finals") }),
      { pastedText: PASTED, ...TERM },
    );
    expect(noFinals.warnings.some((w) => w.includes("finals week is still unknown"))).toBe(true);
  });

  it("lets a later entry correct an earlier one on the same day", () => {
    // A specific line printed after a general one is the correction, which is how a reader
    // takes it too.
    const overlap = validateAcademicCalendar(
      reading({
        entries: [
          { startDate: "2026-11-23", endDate: "2026-11-27", kind: "no_class", label: "Thanksgiving Recess", followsWeekday: null, evidence: "November 25-27, 2026   Thanksgiving Recess — no classes" },
          { startDate: "2026-11-24", endDate: "2026-11-24", kind: "reading", label: "Friday schedule", followsWeekday: 5, evidence: "November 24, 2026      Tuesday classes follow a Friday schedule" },
        ],
      }),
      { pastedText: PASTED, ...TERM },
    );
    const day = overlap.exceptions.find((e) => e.date === "2026-11-24")!;
    expect(day.followsWeekday).toBe(5);
  });

  it("keeps what it could not read rather than dropping it", () => {
    const messy = validateAcademicCalendar(
      reading({ unreadableLines: ["Mid-semester grades due (date TBD)"] }),
      { pastedText: PASTED, ...TERM },
    );
    expect(messy.unreadableLines).toEqual(["Mid-semester grades due (date TBD)"]);
  });
});
