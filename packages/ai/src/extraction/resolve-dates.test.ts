import { describe, expect, it } from "vitest";
import {
  isWithinTerm,
  parseDateRange,
  parseWeekday,
  rangeForWeekNumber,
  resolveRawDate,
  resolveWeekdayInRange,
  weekNumberFromRaw,
  weekdayWithinRange,
} from "./resolve-dates.js";

/**
 * The raw strings below are verbatim model output from the real syllabi, messy spacing and
 * trailing week numbers included. Hand-tidied examples would not have caught the en dashes
 * or the "September 1-4, 2026  2" week-number suffix.
 */

describe("parsing the ranges real syllabi produce", () => {
  const cases: [string, string, string][] = [
    ["September 1-4, 2026  2", "2026-09-01", "2026-09-04"],
    ["Sept. 8-11, 2026  3", "2026-09-08", "2026-09-11"],
    ["Sept. 29-Oct. 2, 2026  6", "2026-09-29", "2026-10-02"],
    ["Nov. 3 – 6, 2026", "2026-11-03", "2026-11-06"],
    ["Dec. 1 - 4, 2026", "2026-12-01", "2026-12-04"],
    ["Sept. 1 – Sept. 4, 2026", "2026-09-01", "2026-09-04"],
    ["Sept. 8– 11, 2026", "2026-09-08", "2026-09-11"],
    ["Dec. 15-18, 2026 (Finals Week)", "2026-12-15", "2026-12-18"],
    ["Aug. 25-28, 2026", "2026-08-25", "2026-08-28"],
    ["Dec. 16-19, 2025  16", "2025-12-16", "2025-12-19"],
  ];

  for (const [raw, start, end] of cases) {
    it(`parses ${JSON.stringify(raw)}`, () => {
      expect(parseDateRange(raw)).toEqual({ start, end });
    });
  }

  it("returns null for prose that is not a range", () => {
    expect(parseDateRange("Mid-term Exam on October 31, 2025")).toBeNull();
    expect(parseDateRange("DUE ON OR BEFORE DECEMBER 8, 2026")).toBeNull();
    expect(parseDateRange("Week 5")).toBeNull();
    expect(parseDateRange("")).toBeNull();
  });

  it("rejects an impossible date rather than rolling it forward", () => {
    expect(parseDateRange("Feb. 30-31, 2026")).toBeNull();
  });

  it("carries a December to January range into the next year", () => {
    expect(parseDateRange("Dec. 28-Jan. 3, 2026")).toEqual({
      start: "2026-12-28",
      end: "2027-01-03",
    });
  });
});

describe("finding the weekday inside a range", () => {
  it("resolves Greek's QUIZ 1 to Wednesday September 2", () => {
    // The syllabus lists QUIZ 1 in the Sept 1-4 row and says quizzes are each Wednesday.
    // Sept 1 2026 is a Tuesday, so the Wednesday in that week is Sept 2.
    expect(resolveWeekdayInRange("September 1-4, 2026  2", 3)).toBe("2026-09-02");
  });

  it("resolves each Greek quiz week to its own Wednesday", () => {
    expect(resolveWeekdayInRange("Sept. 8-11, 2026  3", 3)).toBe("2026-09-09");
    expect(resolveWeekdayInRange("Sept. 15-18, 2026  4", 3)).toBe("2026-09-16");
    expect(resolveWeekdayInRange("Sept. 29-Oct. 2, 2026  6", 3)).toBe("2026-09-30");
    expect(resolveWeekdayInRange("Dec. 8-11, 2026  15", 3)).toBe("2026-12-09");
  });

  it("resolves Revelation's Thursday quizzes", () => {
    expect(resolveWeekdayInRange("Nov. 3 – 6, 2026", 4)).toBe("2026-11-05");
    expect(resolveWeekdayInRange("Dec. 1 - 4, 2026", 4)).toBe("2026-12-03");
  });

  it("lands every resolved date on the requested weekday", () => {
    const ranges = [
      "September 1-4, 2026",
      "Sept. 8-11, 2026",
      "Oct. 20-23, 2026",
      "Nov. 17-20, 2026",
    ];
    for (const raw of ranges) {
      const iso = resolveWeekdayInRange(raw, 3)!;
      expect(new Date(`${iso}T00:00:00Z`).getUTCDay()).toBe(3);
    }
  });

  it("stays inside the range it was given", () => {
    for (const raw of ["September 1-4, 2026", "Oct. 6-9, 2026"]) {
      const range = parseDateRange(raw)!;
      const iso = weekdayWithinRange(range, 3)!;
      expect(iso >= range.start && iso <= range.end).toBe(true);
    }
  });

  it("returns null rather than guessing when the weekday is not in the range", () => {
    // Sept 1-4 2026 is Tuesday to Friday: no Sunday, no Monday.
    expect(resolveWeekdayInRange("September 1-4, 2026", 0)).toBeNull();
    expect(resolveWeekdayInRange("September 1-4, 2026", 1)).toBeNull();
  });

  it("returns null for text that is not a range at all", () => {
    expect(resolveWeekdayInRange("Week 5", 3)).toBeNull();
  });
});

describe("reading the student's answer", () => {
  it("accepts the ways a person writes a weekday", () => {
    expect(parseWeekday("Wednesday")).toBe(3);
    expect(parseWeekday("wednesday")).toBe(3);
    expect(parseWeekday("Wed")).toBe(3);
    expect(parseWeekday("Weds.")).toBe(3);
    expect(parseWeekday("THURSDAY")).toBe(4);
    expect(parseWeekday("thu")).toBe(4);
    expect(parseWeekday(3)).toBe(3);
    expect(parseWeekday("3")).toBe(3);
  });

  it("rejects anything it cannot read, rather than defaulting to Sunday", () => {
    expect(parseWeekday("I don't know")).toBeNull();
    expect(parseWeekday("s")).toBeNull();
    expect(parseWeekday("")).toBeNull();
    expect(parseWeekday(9)).toBeNull();
    expect(parseWeekday(-1)).toBeNull();
  });
});

describe("term bounds allow for finals week", () => {
  // Theology: instruction ends Dec 11, final exam Dec 15. Greek: instruction ends Dec 18,
  // finals week Dec 16-19. Both are ordinary; neither should look suspicious.
  it("accepts a final exam sitting after the last day of instruction", () => {
    expect(isWithinTerm("2026-12-15", "2026-08-25", "2026-12-11")).toBe(true);
    expect(isWithinTerm("2026-12-19", "2026-08-25", "2026-12-18")).toBe(true);
  });

  it("still rejects a date from a previous year", () => {
    // Greek's stale finals row, "Dec. 16-19, 2025", in a 2026 term.
    expect(isWithinTerm("2025-12-17", "2026-08-25", "2026-12-18")).toBe(false);
    // Theology's stale topic-approval date.
    expect(isWithinTerm("2023-10-05", "2026-08-25", "2026-12-11")).toBe(false);
  });

  it("rejects a date far beyond the grace window", () => {
    expect(isWithinTerm("2027-02-01", "2026-08-25", "2026-12-11")).toBe(false);
  });

  it("guards against a weekday answer laundering a stale year", () => {
    // Resolving "Dec. 16-19, 2025" to its Wednesday is arithmetically right and still
    // lands outside the term, so the caller must not treat it as confirmed.
    const iso = resolveWeekdayInRange("Dec. 16-19, 2025  16", 3)!;
    expect(iso).toBe("2025-12-17");
    expect(isWithinTerm(iso, "2026-08-25", "2026-12-18")).toBe(false);
  });
});

describe("week-number resolution against the term calendar", () => {
  // Greek's term starts Tuesday 2026-08-25, so week 1 is the Monday-anchored week of
  // Aug 24, and the syllabus's own table confirms the convention: "Week 2" is Sept 1-4.
  const TERM_START = "2026-08-25";

  it("reads week references in the forms syllabi use", () => {
    expect(weekNumberFromRaw("Week 5")).toBe(5);
    expect(weekNumberFromRaw("week #5")).toBe(5);
    expect(weekNumberFromRaw("during Week 11")).toBe(11);
    expect(weekNumberFromRaw("Wk 3")).toBe(3);
  });

  it("does not mistake ordinary numbers for week references", () => {
    expect(weekNumberFromRaw("Chapter 5")).toBeNull();
    expect(weekNumberFromRaw("worth 5 points")).toBeNull();
    expect(weekNumberFromRaw("Week 45")).toBeNull(); // no term is 45 weeks
    expect(weekNumberFromRaw("")).toBeNull();
  });

  it("maps week numbers onto Monday-anchored weeks containing the term start", () => {
    expect(rangeForWeekNumber(1, TERM_START)).toEqual({ start: "2026-08-24", end: "2026-08-30" });
    expect(rangeForWeekNumber(2, TERM_START)).toEqual({ start: "2026-08-31", end: "2026-09-06" });
    // Cross-checked against the syllabus's own table: "Week 5: Sept. 22-25, 2026".
    expect(rangeForWeekNumber(5, TERM_START)).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  });

  it("resolves 'Week 5' plus the answered weekday to a real date", () => {
    expect(resolveRawDate("Week 5", 3, TERM_START)).toBe("2026-09-23"); // Wednesday
    expect(resolveRawDate("Quiz during Week 5", 4, TERM_START)).toBe("2026-09-24"); // Thursday
  });

  it("prefers an explicit range over a week number when both appear", () => {
    // The syllabus's own dates outrank arithmetic — "Sept. 22-25, 2026  5" has a range.
    expect(resolveRawDate("Sept. 22-25, 2026  5", 3, TERM_START)).toBe("2026-09-23");
  });

  it("leaves week references unresolved without a term start, rather than guessing", () => {
    expect(resolveRawDate("Week 5", 3)).toBeNull();
  });
});
