import { describe, expect, it } from "vitest";
import { validateExtraction } from "./validate.js";
import type { SyllabusExtraction } from "./schema.js";

/**
 * "The percentages do not add up to 100" is three different faults with three different costs.
 *
 * Lumping them together said the least useful thing about each, and the most important one —
 * a category with no weight at all — was not detected at all: nulls were filtered out before
 * summing, so "Exams 50%, Papers 50%, Participation" totalled 100 and passed in silence.
 */

const PAGES = [{ page: 1, text: "GRADING\nExams 50%\nPapers 50%\nParticipation" }];

function extraction(cats: { name: string; weightPercent: number | null }[]): SyllabusExtraction {
  return {
    courseFacts: { name: "X", code: null, instructor: null, credits: null, evidence: null, confidence: 0.9 },
    meetingPatterns: [],
    assignments: [],
    policies: [],
    clarificationQuestions: [],
    gradingCategories: cats.map((c) => ({
      ...c,
      dropLowest: null,
      evidence: { page: 1, excerpt: "GRADING" },
      confidence: 0.9,
    })),
  } as unknown as SyllabusExtraction;
}

const check = (cats: Parameters<typeof extraction>[0]) => {
  const r = validateExtraction(extraction(cats), { pages: PAGES });
  return {
    warning: r.warnings.join(" | "),
    questions: r.clarificationQuestions.map((q) => q.question).join(" | "),
  };
};

describe("when the grading weights do not add up", () => {
  it("says nothing when they add to 100", () => {
    const r = check([{ name: "A", weightPercent: 50 }, { name: "B", weightPercent: 50 }]);
    expect(r.warning).toBe("");
  });

  it("tolerates the rounding a real syllabus prints", () => {
    // Three categories of 33.3% is not a defect, and reporting it as one trains the student
    // to ignore the warning that matters.
    const r = check([
      { name: "A", weightPercent: 33.3 },
      { name: "B", weightPercent: 33.3 },
      { name: "C", weightPercent: 33.3 },
    ]);
    expect(r.warning).toBe("");
  });

  it("names what is unaccounted for when they fall short", () => {
    // BIO 240, verbatim: Labs 25 + Exams 40 + Quizzes 15 + Participation 10 = 90.
    const r = check([
      { name: "Laboratory Reports", weightPercent: 25 },
      { name: "Exams", weightPercent: 40 },
      { name: "Quizzes", weightPercent: 15 },
      { name: "Participation", weightPercent: 10 },
    ]);
    expect(r.warning).toContain("add up to 90%");
    expect(r.warning).toContain("10% of the grade is unaccounted for");
    // Short of 100 means a category may be *missing*, and a missing category is work the
    // student would never be shown. The question has to say that, not "check these weights".
    expect(r.questions).toContain("What makes up the other 10% of your grade");
  });

  it("reads over 100 as a different fault, because it is", () => {
    // Extra credit genuinely can exceed 100 and is not a defect. A double count is.
    const r = check([
      { name: "A", weightPercent: 50 },
      { name: "B", weightPercent: 50 },
      { name: "Extra credit", weightPercent: 15 },
    ]);
    expect(r.warning).toContain("more than 100%");
    expect(r.warning).toContain("counted twice, or one of these may be extra credit");
    expect(r.warning).not.toContain("unaccounted for");
  });

  it("catches a category with no weight, even when the rest total 100", () => {
    /**
     * The one that was silent. `Participation` has no number beside it, the other two sum to
     * 100, and the old check filtered nulls out before summing — so nothing was said at the
     * one moment the student is looking at the syllabus and could still fix it.
     *
     * `course-health.ts` did catch this, which made it worse rather than better: the student
     * found out weeks later from the dashboard instead of at ingest.
     */
    const r = check([
      { name: "Exams", weightPercent: 50 },
      { name: "Papers", weightPercent: 50 },
      { name: "Participation", weightPercent: null },
    ]);
    expect(r.warning).toContain("No weight was found for Participation");
    expect(r.questions).toContain("What is Participation worth?");
  });

  it("names every unweighted category, not just the first", () => {
    const r = check([
      { name: "Exams", weightPercent: 60 },
      { name: "Participation", weightPercent: null },
      { name: "Attendance", weightPercent: null },
    ]);
    expect(r.warning).toContain("Participation, Attendance");
    expect(r.questions).toContain("What are Participation, Attendance worth?");
  });

  it("prefers the unknown weight over the arithmetic when both are wrong", () => {
    // 60 + a missing one. "Add up to 60%" is true and useless: the actionable fact is that
    // one category has no number on it at all.
    const r = check([
      { name: "Exams", weightPercent: 60 },
      { name: "Participation", weightPercent: null },
    ]);
    expect(r.warning).toContain("No weight was found");
    expect(r.warning).not.toContain("unaccounted for");
  });

  it("says something when no category has a weight at all", () => {
    const r = check([
      { name: "A", weightPercent: null },
      { name: "B", weightPercent: null },
    ]);
    expect(r.warning).toContain("No weight was found for A, B");
  });
});
