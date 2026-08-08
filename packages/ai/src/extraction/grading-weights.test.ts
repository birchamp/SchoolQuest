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
    scheduleAnchors: [],
    clarificationQuestions: [],
    gradingCategories: cats.map((c) => ({
      ...c,
      pointsPossible: null,
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

describe("a course graded in points rather than percentages", () => {
  /**
   * Washburn's family law syllabus, verbatim:
   *
   *   "• Class Participation: Maximum of 20 points;
   *    • Midterm / Project: Maximum of 40 points;
   *    • Final Examination: Maximum of 40 points."
   *
   * A complete grading scheme — 20/40/40 of a hundred — stated as plainly as any percentage
   * table. The category schema had nowhere to put points, so it came back as three nulls and
   * the student was told "No weight was found… The rest add up to 0%": a false alarm on a
   * document that states everything.
   *
   * This is §2.3 in the gotchas log, which was marked OPEN with "Wanted: a real syllabus doing
   * this". The corpus has two.
   */
  const POINTS_PAGE = [
    {
      page: 1,
      text: "Grading:\nAll students will receive a numeric grade for the course. Course grades will be based upon a\npoint system. Your grade will be based upon:\n• Class Participation: Maximum of 20 points;\n• Midterm / Project: Maximum of 40 points;\n• Final Examination: Maximum of 40 points.",
    },
  ];

  function pointsExtraction(cats: { name: string; pointsPossible: number }[]): SyllabusExtraction {
    return {
      courseFacts: { name: "Family Law", code: null, instructor: null, credits: null, evidence: null, confidence: 0.9 },
      meetingPatterns: [],
      assignments: [],
      policies: [],
      clarificationQuestions: [],
      gradingCategories: cats.map((c) => ({
        ...c,
        weightPercent: null,
        dropLowest: null,
        evidence: { page: 1, excerpt: `${c.name}: Maximum of ${c.pointsPossible} points` },
        confidence: 0.95,
      })),
    } as unknown as SyllabusExtraction;
  }

  const WASHBURN = [
    { name: "Class Participation", pointsPossible: 20 },
    { name: "Midterm / Project", pointsPossible: 40 },
    { name: "Final Examination", pointsPossible: 40 },
  ];

  it("reads 20/40/40 points as 20/40/40 per cent", () => {
    const r = validateExtraction(pointsExtraction(WASHBURN), { pages: POINTS_PAGE });
    expect(r.gradingCategories.map((c) => [c.name, c.weightPercent])).toEqual([
      ["Class Participation", 20],
      ["Midterm / Project", 40],
      ["Final Examination", 40],
    ]);
  });

  it("stops claiming the weights are missing", () => {
    const r = validateExtraction(pointsExtraction(WASHBURN), { pages: POINTS_PAGE });
    expect(r.warnings.join(" ")).not.toContain("No weight was found");
    expect(r.warnings.join(" ")).not.toContain("add up to 0%");
  });

  it("says the course is graded in points, so the percentages are visibly derived", () => {
    // The share is arithmetic over what the document said, not a reading of it. A student
    // seeing "40%" beside a syllabus that says "40 points" deserves to know which it is.
    const r = validateExtraction(pointsExtraction(WASHBURN), { pages: POINTS_PAGE });
    expect(r.warnings.join(" ")).toContain("graded out of 100 points rather than percentages");
  });

  it("handles a points total that is not 100", () => {
    // Nothing says a course must total 100 points. 30/45/75 of 150 is 20/30/50.
    const r = validateExtraction(
      pointsExtraction([
        { name: "Quizzes", pointsPossible: 30 },
        { name: "Projects", pointsPossible: 45 },
        { name: "Final", pointsPossible: 75 },
      ]),
      {
        pages: [{ page: 1, text: "Quizzes: Maximum of 30 points Projects: Maximum of 45 points Final: Maximum of 75 points" }],
      },
    );
    expect(r.gradingCategories.map((c) => c.weightPercent)).toEqual([20, 30, 50]);
  });

  it("refuses to derive when the document states both units", () => {
    /**
     * A syllabus giving a percentage weight *and* raw points is describing the same grade
     * twice in two units that need not agree. Averaging them would hide the contradiction;
     * leaving the stated percentages alone keeps it visible.
     */
    const mixed = pointsExtraction(WASHBURN);
    mixed.gradingCategories[0]!.weightPercent = 25;
    const r = validateExtraction(mixed, { pages: POINTS_PAGE });
    expect(r.warnings.join(" ")).not.toContain("graded out of");
    // The other two are still unweighted, and that is what gets reported.
    expect(r.warnings.join(" ")).toContain("No weight was found");
  });
});
