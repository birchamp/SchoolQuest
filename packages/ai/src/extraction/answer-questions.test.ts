import { describe, expect, it } from "vitest";
import { parseStatedDate } from "./resolve-dates.js";

/**
 * The date parser behind answering a clarification question.
 *
 * ## The false pass this closes
 *
 * Answering a question used to do nothing at all. The review screen took the text, PATCHed it
 * onto the question claim, flipped `reviewStatus` to "answered", removed it from the screen —
 * and left the underlying claim exactly as undated as before. Nothing anywhere read
 * `payload.answer`; only the weekday buttons acted, and only on `relative_date` questions.
 *
 * That is the single most costly false pass in the app, because clarification is its whole
 * answer to the ambiguity it correctly detects. Every review looked clean regardless of what
 * was actually settled, and a four-year run through the corpus would have gone green on all
 * of it.
 *
 * ## Why this parser refuses more than it accepts
 *
 * A wrong date the student appears to have confirmed is worse than the missing one it
 * replaced: it stops being flagged, stops raising a question, and starts being scheduled. So
 * the rule is read a date or record text, never coerce.
 */

describe("reading a date out of what a student typed", () => {
  it("reads the forms people actually type", () => {
    expect(parseStatedDate("December 4, 2023")).toBe("2023-12-04");
    expect(parseStatedDate("Dec. 4, 2023")).toBe("2023-12-04");
    expect(parseStatedDate("4 December 2023")).toBe("2023-12-04");
    expect(parseStatedDate("2023-12-04")).toBe("2023-12-04");
    expect(parseStatedDate("12/4/2023")).toBe("2023-12-04");
    expect(parseStatedDate("12/4/23")).toBe("2023-12-04");
  });

  it("takes the year from the term when the answer omits one", () => {
    // Nobody types the year. "December 4" is what a student writes when asked in December.
    expect(parseStatedDate("December 4", 2023)).toBe("2023-12-04");
    expect(parseStatedDate("12/4", 2023)).toBe("2023-12-04");
    expect(parseStatedDate("the 4th of December", 2023)).toBe("2023-12-04");
  });

  it("refuses a yearless answer when no term year is supplied", () => {
    expect(parseStatedDate("December 4")).toBeNull();
  });

  it("prefers a year the student typed over the term's", () => {
    // If they say 2022 in a 2023 term, that is a fact to surface as DATE_OUTSIDE_TERM, not
    // one to quietly correct.
    expect(parseStatedDate("December 4, 2022", 2023)).toBe("2022-12-04");
  });

  it("records rather than coerces every honest non-answer", () => {
    /**
     * The important half. Each of these is a real thing a student types, and turning any of
     * them into a deadline would be the app inventing one.
     */
    for (const answer of [
      "unknown",
      "I don't know",
      "I don't know yet",
      "ask the professor",
      "it's on Canvas",
      "sometime in week 3",
      "TBD",
      "not sure, maybe near the end",
      "",
    ]) {
      expect(parseStatedDate(answer, 2023), `"${answer}" must not become a date`).toBeNull();
    }
  });

  it("does not read a week number as a date", () => {
    // "Week 3" is resolvable, but only through the term calendar and only with a weekday.
    // Reading it here would bypass both and produce a confident wrong day.
    expect(parseStatedDate("Week 3", 2023)).toBeNull();
    expect(parseStatedDate("week 12", 2023)).toBeNull();
  });

  it("does not invent a day out of a bare month", () => {
    expect(parseStatedDate("December", 2023)).toBeNull();
    expect(parseStatedDate("sometime in May", 2023)).toBeNull();
  });

  it("rejects a date that cannot exist", () => {
    expect(parseStatedDate("February 30, 2023")).toBeNull();
    expect(parseStatedDate("13/45/2023")).toBeNull();
  });
});
