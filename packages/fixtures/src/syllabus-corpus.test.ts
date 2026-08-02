import { describe, expect, it } from "vitest";
import {
  CORPUS_COURSES,
  CORPUS_TERMS,
  SYLLABUS_CORPUS,
  corpusCoverage,
  type GotchaCode,
} from "./syllabus-corpus.js";

/**
 * What the corpus covers, printed every run so a gap is visible rather than assumed.
 *
 * The number that matters is not "forty documents". It is how many of the documented gotchas
 * are exercised, in how many combinations, across how many differently-shaped terms — and the
 * report says all three so a future reader can tell whether adding a document bought anything.
 */

/** Every gotcha the log records, so the corpus can be checked against the document. */
const ALL_GOTCHAS: GotchaCode[] = [
  "stale_year", "registrar_finals_week", "week_range_dates", "cross_month_range",
  "conflicting_dates", "no_year", "no_date_at_all", "holiday_collision",
  "weights_short", "weights_over", "weight_missing", "weights_in_prose",
  "points_and_percent", "count_not_stated", "category_without_items",
  "rule_not_listed", "described_twice", "grouped_by_category", "note_in_first_row",
  "title_carries_scope", "break_skips_number", "inconsistent_numbering",
  "weekday_not_a_class_day", "broken_list_numbering", "policy_cliff",
];

describe("the constructed corpus", () => {
  it("reports what it covers", () => {
    const counts = corpusCoverage();
    const missing = ALL_GOTCHAS.filter((g) => !counts.has(g));
    const work = SYLLABUS_CORPUS.reduce(
      (sum, s) => sum + s.expected.reduce((n, e) => n + e.count, 0),
      0,
    );

    console.log(
      `\nCORPUS  ${SYLLABUS_CORPUS.length} syllabuses across ${CORPUS_TERMS.length} terms, ` +
        `${work} pieces of work with an exact key\n` +
        `  gotchas exercised: ${counts.size} of ${ALL_GOTCHAS.length}` +
        (missing.length ? `  MISSING: ${missing.join(", ")}` : "") +
        "\n" +
        ALL_GOTCHAS.map((g) => `  ${g.padEnd(26)} ${"█".repeat(counts.get(g) ?? 0)} ${counts.get(g) ?? 0}`).join("\n"),
    );

    expect(missing).toEqual([]);
  });

  it("is eight terms of five courses", () => {
    expect(SYLLABUS_CORPUS).toHaveLength(40);
    for (const term of CORPUS_TERMS) {
      expect(CORPUS_COURSES.filter((c) => c.termKey === term.key)).toHaveLength(5);
    }
  });

  it("gives every term a genuinely different shape", () => {
    /**
     * A corpus of eight identical calendars is one calendar tested eight times.
     *
     * The fingerprint includes each break's **length**, which a first draft of this test
     * omitted and which is the dimension that actually matters: a three-day Thanksgiving
     * leaves Monday and Tuesday holding class, so that week keeps its number, while a
     * five-day one does not. Two terms differing only in that are not duplicates — they are
     * the pair most worth having.
     */
    const shapes = CORPUS_TERMS.map((t) =>
      [
        new Date(`${t.startDate}T00:00:00Z`).getUTCDay(),
        t.breaks
          .map((b) => (Date.parse(b.endDate) - Date.parse(b.startDate)) / 86_400_000 + 1)
          .sort((a, b) => a - b)
          .join(","),
        t.weekNumbering,
        t.readingDays.length > 0,
      ].join("|"),
    );
    expect(new Set(shapes).size).toBe(CORPUS_TERMS.length);
  });

  it("contains terms that differ only in how long a break runs", () => {
    // Fall 2026's Thanksgiving is three days and Fall 2029's is five. That single difference
    // decides whether the week is a break week at all, and therefore whether "Week 14" means
    // the same thing in both. Losing it would make the corpus easier than reality.
    const lengths = CORPUS_TERMS.flatMap((t) =>
      t.breaks.map((b) => (Date.parse(b.endDate) - Date.parse(b.startDate)) / 86_400_000 + 1),
    );
    expect(new Set(lengths)).toEqual(new Set([1, 2, 3, 5]));
  });

  it("covers all three week-numbering conventions", () => {
    // The third one — a document that numbers one break and skips another — is what defeated
    // a per-term boolean. A corpus without it would be easier than reality.
    const conventions = new Set(CORPUS_TERMS.map((t) => t.weekNumbering));
    expect(conventions).toEqual(new Set(["counts_breaks", "skips_breaks", "inconsistent"]));
  });

  it("puts faults in combination, not one per document", () => {
    // A reader that handles each fault alone and breaks when two coincide is exactly what
    // this exists to catch, so most documents carry three or more.
    const combos = CORPUS_COURSES.filter((c) => c.gotchas.length >= 3).length;
    expect(combos).toBeGreaterThan(CORPUS_COURSES.length * 0.8);
  });

  it("carries an exact key for every document", () => {
    for (const s of SYLLABUS_CORPUS) {
      expect(s.expected.length).toBeGreaterThan(0);
      for (const family of s.expected) {
        expect(family.count).toBeGreaterThan(0);
        /**
         * A family with dates carries one per instance — except where the document states
         * *two* dates for one item, which is §1.6 and is the whole point of that fault. A key
         * that flattened those to one would hide the contradiction the app has to surface.
         */
        const conflicting = s.course.gotchas.includes("conflicting_dates");
        if (family.statedDates.length > 0) {
          if (conflicting && family.family === "termPaper") {
            expect(family.statedDates.length).toBe(2);
            expect(family.count).toBe(1);
          } else {
            expect(family.statedDates.length).toBe(family.count);
          }
        }
      }
    }
  });

  it("never dates work into a break", () => {
    /**
     * The corpus's own correctness check, and the one most worth having. Every date in an
     * answer key is a date the app is expected to produce, so a key that itself put work on
     * Thanksgiving would train the reader to be wrong.
     */
    for (const s of SYLLABUS_CORPUS) {
      for (const family of s.expected) {
        for (const date of family.statedDates) {
          const hit = s.term.breaks.find(
            (b) => b.startDate <= date && b.endDate >= date,
          );
          expect(hit, `${s.course.code} ${family.family} ${date} is inside ${hit?.name}`).toBeUndefined();
        }
      }
    }
  });

  it("gives the extractor real text to read, not a stub", () => {
    for (const s of SYLLABUS_CORPUS) {
      expect(s.pages).toHaveLength(3);
      const total = s.pages.reduce((n, p) => n + p.text.length, 0);
      expect(total).toBeGreaterThan(1500);
      // Page 1 always carries the meeting pattern and the instruction dates, which is what
      // the term calendar and the weekday cross-check both need.
      expect(s.pages[0]!.text).toContain("Dates of instruction");
      expect(s.pages[0]!.text).toContain("Course schedule");
    }
  });

  it("states a quiz weekday the class does not meet, where that is the point", () => {
    // §5.1, reproduced: both facts extractable, and nothing compares them yet.
    const offenders = SYLLABUS_CORPUS.filter((s) =>
      s.course.gotchas.includes("weekday_not_a_class_day"),
    );
    expect(offenders.length).toBeGreaterThan(0);
    for (const s of offenders) {
      const stated = s.pages[2]!.text.match(/Quizzes are given each (\w+)/)?.[1];
      const meets = s.course.meetingDays.map(
        (d) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d],
      );
      expect(meets).not.toContain(stated);
    }
  });

  it("builds the same corpus twice", () => {
    // No Math.random anywhere in this package: a corpus that shuffled itself would make a
    // failing test unreproducible.
    const a = JSON.stringify(SYLLABUS_CORPUS);
    const b = JSON.stringify(CORPUS_COURSES.map((c) => SYLLABUS_CORPUS.find((s) => s.course.code === c.code && s.course.termKey === c.termKey)));
    expect(a).toBe(b);
  });
});
