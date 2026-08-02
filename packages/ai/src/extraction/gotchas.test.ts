import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FAKE_COURSES,
  GREEK_PAGES,
  INGESTED_SEMESTER,
  REVELATION_PAGES,
  THEOLOGY_PAGES,
} from "@schoolquest/fixtures";
import { rangeForWeekNumber } from "./resolve-dates.js";

/**
 * Executable entries from `docs/10-syllabus-gotchas.md`.
 *
 * The log is prose, and prose rots. Anything in it that can be checked against the real
 * syllabus text is checked here, so an entry claiming "the syllabus says X" fails the build
 * the day it stops being true — and so an entry marked OPEN cannot quietly become handled
 * without somebody noticing.
 *
 * These assert *the syllabus*, not the extractor. They are the evidence, not the fix.
 */

const text = (pages: { page: number; text: string }[]) => pages.map((p) => p.text).join("\n");
const GREEK = text(GREEK_PAGES);
const THEOLOGY = text(THEOLOGY_PAGES);
const REVELATION = text(REVELATION_PAGES);
const fake = (code: string) => text(FAKE_COURSES.find((c) => c.code === code)!.pages);

describe("gotchas §1 — dates", () => {
  it("§1.1 a stale year survives into a current syllabus", () => {
    expect(GREEK).toContain("October 31, 2025");
    expect(GREEK).toContain("Dec. 16-19, 2025");
    expect(THEOLOGY).toContain("on or before October 5, 2023");
    // And the same document's own table puts the same deadline in 2026.
    expect(THEOLOGY).toContain("Oct. 6, 2026");
  });

  it("§1.2 finals fall after the last day of instruction", () => {
    expect(THEOLOGY).toContain("August 25 – December 11, 2026");
    expect(THEOLOGY).toContain("Dec. 15, 2026");
    expect(THEOLOGY).toContain("FINAL EXAM");
  });

  it("§1.6 the grading section's paper date is written across a line break", () => {
    // Also §4.2: the phrase a reader sees as one sentence arrives split mid-clause.
    expect(REVELATION).toContain("DUE ON OR\nBEFORE December 11, 2026");
  });
});

describe("gotchas §2 — weights", () => {
  it("§2.2 weights are trailing numbers on prose paragraphs, with no grading table", () => {
    // Greek has no grading table at all. Each weight ends a numbered paragraph.
    expect(GREEK).toContain("attend all classes. 20%");
    expect(GREEK).toContain("while class is in\nsession. 10%");
    expect(GREEK).toContain("grammatical questions. 30%");
    expect(GREEK).toContain("which are cumulative. 40%");
  });

  it("§2.5 a fifth of the grade is committed weekly work with nothing to schedule", () => {
    // "Study Teams ... for one hour each week, while class is in session. 10%"
    expect(GREEK).toContain("for one hour each week");
    expect(GREEK).toContain("Attendance and Participation");
  });
});

describe("gotchas §3 — where the work is written down", () => {
  it("§3.4 a term-wide policy is parked inside week one's assignment cell", () => {
    expect(GREEK).toContain("No Quiz");
    expect(GREEK).toContain("All Quizzes are\nAccumulative");
  });

  it("§3.5 titles carry the material they cover", () => {
    expect(THEOLOGY).toContain("QUIZ 1 OVER\nDISM Intro & Ch. 1");
  });

  it("§3.6 break weeks break the week numbering", () => {
    /**
     * Theology numbers Research Week as 8 and then gives the Thanksgiving row no number at
     * all, so the printed week numbers stop tracking elapsed weeks partway through the term.
     *
     * The consequence, computed rather than asserted: `rangeForWeekNumber` counts Monday
     * weeks from the term start, which is the right reading for a syllabus that numbers its
     * breaks and the wrong one for a syllabus that skips them. After Thanksgiving, Theology
     * is one of the second kind.
     */
    expect(THEOLOGY).toContain("Research Week");
    expect(THEOLOGY).toContain("Thanksgiving Break");

    // Week 14 by strict elapsed count from 2026-08-25.
    expect(rangeForWeekNumber(14, "2026-08-25")).toEqual({
      start: "2026-11-23",
      end: "2026-11-29",
    });
    // The syllabus prints "Dec. 1, 2026  14" — a week later, because Thanksgiving was not
    // counted. A student answering "Tuesday" for week 14 gets Thanksgiving week.
    expect(THEOLOGY).toContain("Dec. 1, 2026  14");
  });

  it("§3.6 the drift has already mis-dated real work in the fixture semester", () => {
    /**
     * MAT 205: "Problem Set 6 due Week 14", due "at the beginning of class". It reached the
     * fixture dump on 23 November — Thanksgiving week, with no class in it — because week
     * numbers were counted as raw calendar weeks.
     *
     * The fixture still holds that value, because it is a dump taken before the term had a
     * calendar. What fixed it is `lookupWeek`, covered in `academic-weeks.test.ts` and
     * verified through the running Worker: with the break supplied, the same "Week 14" plus
     * the same "Monday" answer now resolves to 30 November. This assertion stays as the
     * before-picture and flips when the fixture is regenerated.
     */
    const mat = INGESTED_SEMESTER.courses.find((c) => c.code?.includes("MAT 205"))!;
    const six = INGESTED_SEMESTER.workItems.find(
      (w) => w.courseId === mat.id && w.title === "Problem Set 6",
    )!;
    expect(six.dueAt?.slice(0, 10)).toBe("2026-11-23");

    // What the other two courses in the same term call week 14.
    expect(fake("BIO 240")).toContain("Nov. 30-Dec. 4, 2026  14");
    expect(fake("HIS 210")).toContain("Dec. 1 & 3, 2026  14");
  });
});

describe("gotchas — findings the log itself turned up", () => {
  it("§5.4 a policy claim is stored and then rendered nowhere", () => {
    /**
     * Extraction reads policies, the validator carries them, and `buildClaimRows` writes them
     * to `extraction_claims`. Then the confirm route promotes only grading categories, meeting
     * patterns and assignments, and the review screen renders only those plus questions.
     *
     * So "you will fail the course if you miss more than 7 classes" is in the database of every
     * account that uploaded Greek, and has never been on a screen.
     */
    const confirm = readFileSync(
      new URL("../../../../apps/api/src/routes/extraction.ts", import.meta.url),
      "utf8",
    );
    const review = readFileSync(
      new URL("../../../../apps/web/src/components/ExtractionReview.tsx", import.meta.url),
      "utf8",
    );

    // It is written...
    expect(confirm).toContain('claimType: "policy"');
    // ...and then never promoted or displayed. Both assertions flip together when it is.
    expect(confirm).not.toContain('c.claimType === "policy"');
    expect(review).not.toContain('"policy"');
  });
});

describe("gotchas §4 — what the PDF does to the text", () => {
  it("§4.1 the week number lands after the date on the same line", () => {
    expect(GREEK).toContain("September 1-4, 2026  2");
    expect(GREEK).toContain("Sept. 8-11, 2026  3");
  });

  it("§4.2 one table row arrives as separate lines with the date split across them", () => {
    expect(REVELATION).toContain("Sept. 1 – Sept. 4,\n2026\n2");
  });

  it("§4.3 the grading scale interleaves two columns onto one line", () => {
    expect(GREEK).toContain("98-100 A+  73-77 C");
  });

  it("§4.4 dash variants and stray spacing are in the real text", () => {
    expect(REVELATION).toContain("Sept. 8– 11, 2026");
    expect(REVELATION).toContain("Nov. 3 – 6, 2026");
  });

  it("§4.5 ligatures survive extraction as spaced glyph runs", () => {
    // Would break an exact evidence-excerpt match, which is what stops fabricated assignments.
    expect(GREEK).toContain("make every e ff ort");
  });
});

describe("gotchas §5 — contradictions between sections", () => {
  it("§5.1 the stated quiz weekday is not a day the class meets", () => {
    /**
     * The highest-value open item in the log. Theology meets Tuesday and says its quizzes are
     * every Thursday. One of the two is wrong and the document cannot say which — but the app
     * has both facts already and does not compare them, so a student answering the weekday
     * question in good faith can date thirteen quizzes to a day they have no class.
     */
    expect(THEOLOGY).toContain("Course schedule:  Tuesday");
    expect(THEOLOGY).toContain("Quizzes will be given each Thursday");
  });

  it("§5.3 the grading list numbers two items 4 and has no item 3", () => {
    expect(THEOLOGY).toContain("2.  Quizzes 25%");
    expect(THEOLOGY).toContain("4. Research Paper 25%");
    expect(THEOLOGY).toContain("4. Final Exam 25%");
    expect(THEOLOGY).not.toContain("3. Research Paper");
  });

  it("§5.4 a course-wide cliff is stated as prose in the requirements", () => {
    expect(GREEK).toContain("If you miss more than 7 classes");
    expect(THEOLOGY).toContain("Late assignments will not be accepted one week");
  });
});
