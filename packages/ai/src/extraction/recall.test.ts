import { describe, expect, it } from "vitest";
import {
  INGESTED_SEMESTER,
  SYLLABUS_ANSWER_KEY,
  expectedWorkTotal,
} from "@schoolquest/fixtures";

/**
 * What did extraction *miss*?
 *
 * Everything else in this harness measures precision — whether the model quoted text that is
 * not in the document — because a planner that invents an exam is unusable. That number is
 * necessary and it is blind in one direction, and the direction it is blind in is the dangerous
 * one. A student can plan around work they can see. They cannot plan around a hole, and nothing
 * in the app tells them a hole is there.
 *
 * So this scores the ingested semester against `SYLLABUS_ANSWER_KEY`: what the five syllabuses
 * actually say, quoted, sentence by sentence.
 *
 * The failure it found is specific and worth stating plainly, because it is not "the model is
 * bad at reading". Recurring work **enumerated in a table** comes through perfectly — BIO's
 * thirteen quizzes and HIS's thirteen reading quizzes are all present. Recurring work **stated
 * as a rule in prose** collapses to a single item:
 *
 *   "A weekly fitness log is due each Sunday ... There are 14 logs"  →  1 undated item
 *   "A short response ... is due each Tuesday in class"              →  1 undated item
 *
 * That is forty per cent of one course's grade and fifteen per cent of another's, and on the
 * student's screen it looks like one small thing rather than thirty.
 *
 * ## The 67% is a measurement of a file, not of today's pipeline
 *
 * `INGESTED_SEMESTER` is a committed dump, taken before `expandRecurrence` existed. Both
 * families above are exactly what expansion now produces instances for, so the number here
 * cannot move until the dump is regenerated against the current code — a model pass, which
 * needs `OPENROUTER_API_KEY` or `tools/e2e/mock-openrouter.mjs`. Until then this file is the
 * *baseline*: what the pipeline scored before the fix, kept honest so the improvement is
 * measured rather than asserted. `expand-recurrence.e2e.test.ts` is what covers the fix.
 */

/** Match an extracted title against a family in the answer key. */
const FAMILY: Record<string, RegExp> = {
  quizzes: /^quiz/i,
  readingQuizzes: /^reading quiz/i,
  exams: /exam|midterm/i,
  labReports: /lab report/i,
  labNotebook: /lab notebook/i,
  essays: /^primary source essay/i,
  researchPaper: /^research paper$/i,
  topicApproval: /topic approval/i,
  finalExam: /^final exam$/i,
  problemSets: /^problem set/i,
  fitnessLogs: /fitness log/i,
  assessments: /assessment/i,
  workshopSubmissions: /^workshop submission/i,
  readingResponses: /^reading response$/i,
  finalPortfolio: /final portfolio/i,
};

interface Miss {
  code: string;
  family: string;
  expected: number;
  found: number;
  evidence: string;
}

function score() {
  const coursesByCode = new Map(INGESTED_SEMESTER.courses.map((c) => [c.code ?? c.name, c]));
  const misses: Miss[] = [];
  let expectedTotal = 0;
  let foundTotal = 0;

  for (const course of SYLLABUS_ANSWER_KEY) {
    const match = [...coursesByCode.entries()].find(([code]) => code?.includes(course.code));
    const items = match
      ? INGESTED_SEMESTER.workItems.filter(
          // Stages of a decomposed project are the app's own doing, not the syllabus's.
          (w) => w.courseId === match[1].id && w.parentWorkItemId === null,
        )
      : [];

    for (const [family, expected] of Object.entries(course.expected)) {
      const pattern = FAMILY[family];
      const found = pattern ? items.filter((w) => pattern.test(w.title)).length : 0;
      expectedTotal += expected.count;
      foundTotal += Math.min(found, expected.count);
      if (found < expected.count) {
        misses.push({ code: course.code, family, expected: expected.count, found, evidence: expected.evidence });
      }
    }
  }

  return { misses, expectedTotal, foundTotal, recall: foundTotal / expectedTotal };
}

describe("what extraction missed", () => {
  const result = score();

  it("reports recall against what the syllabuses actually say", () => {
    console.log(
      `\nRECALL  ${result.foundTotal} of ${result.expectedTotal} pieces of work ` +
        `(${Math.round(result.recall * 100)}%)\n` +
        result.misses
          .map((m) => `  MISSED  ${m.code.padEnd(8)} ${m.family.padEnd(20)} ${m.found}/${m.expected}\n            "${m.evidence}"`)
          .join("\n"),
    );
    expect(result.expectedTotal).toBe(expectedWorkTotal());
  });

  it("gets every piece of work that a schedule table enumerates", () => {
    // The half that already works, and the reason the defect is not "the model reads badly".
    // Thirteen quizzes listed row by row come through as thirteen quizzes.
    const enumerated = result.misses.filter(
      (m) => m.family === "quizzes" || m.family === "readingQuizzes" || m.family === "problemSets",
    );
    expect(enumerated).toEqual([]);
  });

  it("loses recurring work that is stated as a rule instead of listed", () => {
    /**
     * The defect, pinned so it cannot quietly persist.
     *
     * Asserted as a *ceiling*: this test should start failing the moment extraction learns to
     * expand "each Tuesday" and "there are 14 logs" into instances, and that failure is the
     * signal to raise the bar rather than a regression. Until then it is the honest record that
     * a student is being shown one item where they face fourteen.
     */
    const byRule = result.misses.filter(
      (m) => m.family === "fitnessLogs" || m.family === "readingResponses",
    );
    expect(byRule.length).toBeGreaterThan(0);
    for (const m of byRule) expect(m.found).toBeLessThan(m.expected);
  });

  it("puts stated dates where the syllabus put them", () => {
    /**
     * The other way a student ends up not knowing they have an assignment: they have it, on a
     * day the app made up. Counting families cannot see that — PED 110 expects three
     * assessments and three were found — so this checks each explicitly-stated date against
     * the sentence that states it.
     *
     * This test was written the other way round, asserting that at least one stated date was
     * wrong, because PED 110's "Baseline assessment: September 2, 2026 in class" appeared in
     * the fixture dated 20 November. That was traced to a screenshot run typing over the row
     * through the assignments table, not to extraction: the claim in D1 reads `2026-09-02`.
     * The assertion is now a floor in the direction it should always have been — every stated
     * date is honoured, and any that stops being honoured fails here.
     */
    const wrong: string[] = [];
    for (const course of SYLLABUS_ANSWER_KEY) {
      const match = INGESTED_SEMESTER.courses.find((c) => (c.code ?? c.name)?.includes(course.code));
      if (!match) continue;
      for (const [family, expected] of Object.entries(course.expected)) {
        if (!expected.statedDate) continue;
        const pattern = FAMILY[family];
        const items = INGESTED_SEMESTER.workItems.filter(
          (w) => w.courseId === match.id && pattern?.test(w.title),
        );
        const onTheDay = items.some((w) => w.dueAt?.startsWith(expected.statedDate!));
        if (!onTheDay) {
          wrong.push(
            `${course.code} ${family}: syllabus says ${expected.statedDate}, plan has ` +
              `${items.map((w) => `${w.title}=${w.dueAt?.slice(0, 10) ?? "none"}`).join(", ")}`,
          );
        }
      }
    }
    if (wrong.length) console.log(`\nSTATED DATES NOT HONOURED\n  ${wrong.join("\n  ")}`);
    expect(wrong).toEqual([]);
  });

  it("does not silently overstate how much of the term it captured", () => {
    // The number this whole file exists to produce. A floor, so it can only be beaten by
    // actually finding more work.
    expect(result.recall).toBeLessThan(1);
    expect(result.recall).toBeGreaterThan(0.6);
  });
});
