import { describe, expect, it } from "vitest";
import { REAL_DATE_STRINGS } from "@schoolquest/fixtures";
import { parseDateRange, weekNumberFromRaw } from "./resolve-dates.js";
import { dateAppearsInSource } from "./validate.js";

/**
 * The date parsers, run against every date string twenty real syllabuses actually print.
 *
 * ## Why this exists
 *
 * `docs/10-syllabus-gotchas.md` marked four entries HANDLED — §1.5 cross-month ranges, §4.1 the
 * trailing week number, §4.4 dash variants, and §1.3 the registrar finals window, which depends
 * on the same parser. All four were validated against three syllabuses **from one institution**,
 * and all three happened to print a four-digit year in every schedule row.
 *
 * Run against twenty syllabuses from eighteen institutions, `parseDateRange` parsed **0 of 50**
 * ranges. Not a regression — it had never worked outside that one house style, and the log said
 * it did. §1.3's registrar branch was structurally unreachable as a result, because it is only
 * entered through a successful `parseDateRange`.
 *
 * So this file is a conformance test rather than a unit test: the inputs are harvested verbatim
 * from the corpus (`packages/fixtures/src/real-corpus/date-strings.json`) and the assertions are
 * about coverage across all of them, not about individual hand-picked cases. A parser that
 * handles a fixture and fails the corpus is the failure mode this catches, and it needs no
 * model, no Worker and no browser to run.
 */

/** Every schedule table in the corpus omits the year, so a caller always supplies one. */
const CONTEXT_YEAR = 2022;

describe("date ranges real syllabuses print", () => {
  it("parses the corpus, and reports what it cannot", () => {
    const results = REAL_DATE_STRINGS.ranges.map((r) => ({
      ...r,
      parsed: parseDateRange(r.raw, CONTEXT_YEAR),
    }));
    const failed = results.filter((r) => r.parsed === null);

    console.log(
      `\nREAL RANGES  ${results.length - failed.length}/${results.length} parsed` +
        (failed.length
          ? `\n` + failed.map((f) => `   MISS ${f.src.slice(0, 26).padEnd(26)} ${JSON.stringify(f.raw)}`).join("\n")
          : ""),
    );

    // A floor, deliberately below 100%: some harvested strings are not ranges at all (a page
    // number caught beside a month, say). What matters is that the common conventions work.
    expect(results.length).toBeGreaterThan(40);
    expect(failed.length / results.length).toBeLessThan(0.1);
  });

  it("reads a range with no year at all, given the term's year", () => {
    // "January 13–16" — Richland's week headers, and the single commonest form in the corpus.
    expect(parseDateRange("January 13–16", 2022)).toEqual({ start: "2022-01-13", end: "2022-01-16" });
    expect(parseDateRange("April 28 – May 4", 2022)).toEqual({ start: "2022-04-28", end: "2022-05-04" });
  });

  it("refuses a yearless range when nobody has supplied a year", () => {
    // Inventing one is the guess this module exists to refuse.
    expect(parseDateRange("January 13–16")).toBeNull();
  });

  it("reads ordinal suffixes", () => {
    // TAMUSA writes every date this way: "Mar. 10th-15th-Spring Break".
    expect(parseDateRange("Mar. 10th-15th", 2025)).toEqual({ start: "2025-03-10", end: "2025-03-15" });
    expect(parseDateRange("May 7th-13th", 2025)).toEqual({ start: "2025-05-07", end: "2025-05-13" });
  });

  it("reads a range split across a line break", () => {
    // NC State's table wraps mid-range; the fragments used to read as two separate dates.
    expect(parseDateRange("Mar 14-\n\nMar 18", 2022)).toEqual({ start: "2022-03-14", end: "2022-03-18" });
  });

  it("still prefers a year the text states over the one supplied", () => {
    // The stale-year defence (§1.1) depends on this: a row printing 2025 in a 2026 term must
    // keep its 2025 so `DATE_OUTSIDE_TERM` can fire.
    expect(parseDateRange("Dec. 16-19, 2025", 2026)).toEqual({ start: "2025-12-16", end: "2025-12-19" });
  });
});

describe("week headers real syllabuses print", () => {
  it("reads the corpus's week numbers, and reports what it cannot", () => {
    const results = REAL_DATE_STRINGS.weekHeaders.map((h) => ({ ...h, week: weekNumberFromRaw(h.raw) }));
    const failed = results.filter((r) => r.week === null);
    console.log(
      `\nREAL WEEK HEADERS  ${results.length - failed.length}/${results.length} read` +
        (failed.length ? `\n` + failed.map((f) => `   MISS ${f.src.slice(0, 26).padEnd(26)} ${JSON.stringify(f.raw)}`).join("\n") : ""),
    );
    expect(results.length).toBeGreaterThan(20);
  });

  it("does not read Week 0, which one real syllabus starts from", () => {
    /**
     * Richland's MATH 122 numbers its first week **zero**: "Week 0, January 13–16", then
     * "Week 1, January 17–23". `weekNumberFromRaw` requires `week >= 1`, so week zero returns
     * null and every later week is off by one against a reader that counts the first Monday
     * as week 1.
     *
     * Asserted as the *current* behaviour rather than fixed here, because the fix is not a
     * looser bound — it is calibrating against the pairs the document itself prints, which is
     * §3.7's open item. Returning 0 without that would make an off-by-one silent instead of
     * absent, and absent is the safer of the two.
     */
    expect(weekNumberFromRaw("Week 0, January 13–16")).toBeNull();
    expect(weekNumberFromRaw("Week 1, January 17–23")).toBe(1);
  });

  it("finds the duplicate week number one real syllabus prints", () => {
    // Richland MATH 104 prints "Week 10" twice, for 20–26 March and 27 March–2 April. Every
    // row after it runs a week behind a reader counting elapsed weeks — and because its break
    // *is* numbered, `breaksTakeWeekNumbers: true` is correct and takes the short-circuit that
    // reports `ambiguous: false`. A silent one-week-early date at high confidence.
    const richland = REAL_DATE_STRINGS.weekHeaders.filter((h) => h.src.includes("richland_math104"));
    const numbers = richland.map((h) => weekNumberFromRaw(h.raw));
    const dupes = numbers.filter((n, i) => n !== null && numbers.indexOf(n) !== i);
    expect(dupes).toEqual([10]);
  });
});

describe("verifying a date really is on the page", () => {
  it("finds zero-padded numeric dates whatever the day of the month", () => {
    /**
     * The check used to pass or fail on the *day*: candidate "2/23" is a substring
     * of "02/23/24" and matched by accident, while "12/6" is not a substring of "12/06" and
     * was stripped as invented.
     *
     * Inside one real syllabus that meant the 11/29 and 12/11 quizzes kept their dates and the
     * 12/06 and 12/08 quizzes lost theirs. A 20-page pharmacy syllabus written entirely in
     * 01/02/24 form lost every date it had.
     */
    for (const [iso, text] of [
      ["2024-01-02", "01/02/24 1.1 Lecture Video Brain Neurochemistry"],
      ["2021-12-06", "Quiz due 12/06 Week 16 NO LAB"],
      ["2024-09-05", "09/05 Homework 2 due"],
      ["2021-12-11", "EXAM 3 - Saturday 12/11 12:30 - 2:10 pm"],
      ["2021-11-29", "Quiz due 11/29 Week 15 NO LAB"],
    ] as const) {
      expect(dateAppearsInSource(iso, text).found, `${iso} in ${text}`).toBe(true);
    }
  });

  it("still rejects a date the page does not contain", () => {
    // The defence has to keep working: a looser matcher that finds everything finds nothing.
    expect(dateAppearsInSource("2024-07-04", "01/02/24 1.1 Lecture Video").found).toBe(false);
    expect(dateAppearsInSource("2021-10-15", "Quiz due 12/06 Week 16 NO LAB").found).toBe(false);
  });

  it("does not mistake a longer number for a shorter one", () => {
    expect(dateAppearsInSource("2024-01-02", "Room 01/020 meets Tuesdays").found).toBe(false);
  });
});
