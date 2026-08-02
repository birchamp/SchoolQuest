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
     * day the app made up. PED 110 says "Baseline assessment: September 2, 2026 in class" and
     * the plan carries it on 20 November — eleven weeks late, in a course where the assessments
     * are forty per cent of the grade.
     *
     * Counting families cannot see this: three assessments were expected and three were found.
     * Only checking the date against the sentence catches it.
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
    // A ceiling again: fix the extraction and this flips, which is the signal to tighten it.
    expect(wrong.length).toBeGreaterThan(0);
  });

  it("does not silently overstate how much of the term it captured", () => {
    // The number this whole file exists to produce. A floor, so it can only be beaten by
    // actually finding more work.
    expect(result.recall).toBeLessThan(1);
    expect(result.recall).toBeGreaterThan(0.6);
  });
});
