import { describe, expect, it } from "vitest";
import { GREEK_PAGES, REVELATION_PAGES, THEOLOGY_PAGES } from "@schoolquest/fixtures";
import { dateAppearsInSource, validateExtraction, verifyEvidence } from "./validate.js";
import type { ExtractedAssignment, SyllabusExtraction } from "./schema.js";

/**
 * Validator behaviour against three real Fall 2026 syllabi.
 *
 * The synthetic tests prove the rules fire. These prove the rules fire on documents
 * nobody wrote to be convenient: real date formats, real table layouts mangled by PDF text
 * extraction, and real editing mistakes left in by the instructors.
 *
 * The model outputs below are hand-written to represent what a competent extractor would
 * plausibly return for these pages — including the mistakes a fluent model is most likely
 * to make, which is the whole point.
 */

const GREEK_TERM = { termStartDate: "2026-08-25", termEndDate: "2026-12-18" };
const THEOLOGY_TERM = { termStartDate: "2026-08-25", termEndDate: "2026-12-11" };

function page(pages: { page: number; text: string }[], n: number): string {
  return pages.find((p) => p.page === n)!.text;
}

function assignment(overrides: Partial<ExtractedAssignment>): ExtractedAssignment {
  return {
    title: "Untitled",
    type: "other",
    dueDate: { iso: null, raw: null, time: null, ambiguity: "missing" },
    pointsPossible: null,
    category: null,
    isMajorProject: false,
    evidence: { page: 1, excerpt: "" },
    confidence: 0.9,
    ...overrides,
  };
}

function extraction(assignments: ExtractedAssignment[], extra: Partial<SyllabusExtraction> = {}) {
  return {
    courseFacts: { name: null, code: null, instructor: null, evidence: null, confidence: 0.9 },
    meetingPatterns: [],
    gradingCategories: [],
    assignments,
    policies: [],
    clarificationQuestions: [],
    ...extra,
  } satisfies SyllabusExtraction;
}

describe("real PDF text is quotable", () => {
  it("verifies excerpts from a real course-outline table", () => {
    // These tables come out of pdf.js as ragged multi-line text; excerpts must still match.
    expect(verifyEvidence("Mid-term Exam on\nOctober 31, 2025", page(GREEK_PAGES, 6)).verified).toBe(
      true,
    );
    expect(verifyEvidence("QUIZ 1\nAugust Chapters 1-3", page(GREEK_PAGES, 5)).verified).toBe(true);
    expect(
      verifyEvidence("The paper is  DUE ON OR BEFORE DECEMBER 8, 2026", page(THEOLOGY_PAGES, 5))
        .verified,
    ).toBe(true);
  });

  it("still rejects an invented quote against a real document", () => {
    expect(
      verifyEvidence(
        "All assignments must be submitted through Canvas by 11:59 PM Eastern.",
        page(GREEK_PAGES, 5),
      ).verified,
    ).toBe(false);
  });
});

describe("real date formats are recognized", () => {
  it("matches the abbreviated and full formats these syllabi actually use", () => {
    const outline = page(GREEK_PAGES, 5);
    expect(dateAppearsInSource("2026-08-25", outline).found).toBe(true); // "Aug. 25-28, 2026"
    expect(dateAppearsInSource("2026-09-01", outline).found).toBe(true); // "September 1-4, 2026"
    expect(dateAppearsInSource("2026-09-08", outline).found).toBe(true); // "Sept. 8-11, 2026"
    expect(dateAppearsInSource("2026-10-06", outline).found).toBe(true); // "Oct. 6-9, 2026"
  });

  it("reads the year stated after a date range", () => {
    // "Aug. 25-28, 2026" states its year only after the range ends.
    expect(dateAppearsInSource("2026-08-25", page(GREEK_PAGES, 5)).statedYear).toBe(2026);
    // "Nov. 3 – 6, 2026" uses an en dash with spaces.
    expect(dateAppearsInSource("2026-11-03", page(REVELATION_PAGES, 5)).statedYear).toBe(2026);
  });

  it("does not match a date the document never states", () => {
    // Quizzes fall on Wednesdays within "Aug. 25-28", but Aug 26 is nowhere in the text.
    expect(dateAppearsInSource("2026-08-26", page(GREEK_PAGES, 5)).found).toBe(false);
  });

  it("does not let a shorter day match a longer one", () => {
    // "Oct. 13-16" must not satisfy a claim of October 1.
    const text = "Oct. 13-16, 2026 Research Week";
    expect(dateAppearsInSource("2026-10-01", text).found).toBe(false);
  });
});

describe("the stale years these syllabi actually contain", () => {
  it("catches a model silently correcting Greek's 2025 mid-term to 2026", () => {
    // The document says "Mid-term Exam on October 31, 2025" in a term ending Dec 2026.
    // A helpful model reports 2026-10-31. The day is real, so the excerpt and date checks
    // both pass — only the year comparison catches it.
    const result = validateExtraction(
      extraction([
        assignment({
          title: "Mid-term Exam",
          type: "exam",
          dueDate: { iso: "2026-10-31", raw: "October 31, 2025", time: null, ambiguity: "none" },
          isMajorProject: true,
          evidence: { page: 6, excerpt: "Mid-term Exam on\nOctober 31, 2025" },
        }),
      ]),
      { pages: GREEK_PAGES, ...GREEK_TERM },
    );

    const midterm = result.assignments[0]!;
    expect(midterm.issues).toContain("DATE_YEAR_MISMATCH");
    expect(
      result.clarificationQuestions.some((q) => q.question.includes("2025")),
    ).toBe(true);
  });

  it("catches Theology's 2023 topic-approval date", () => {
    // Prose: "present it to the professor for approval on or before October 5, 2023".
    const result = validateExtraction(
      extraction([
        assignment({
          title: "Research paper topic approval",
          type: "paper",
          dueDate: { iso: "2026-10-05", raw: "October 5, 2023", time: null, ambiguity: "none" },
          evidence: {
            page: 5,
            excerpt: "present it to the professor for\napproval on or before October 5, 2023",
          },
        }),
      ]),
      { pages: THEOLOGY_PAGES, ...THEOLOGY_TERM },
    );

    expect(result.assignments[0]!.issues).toContain("DATE_YEAR_MISMATCH");
  });

  it("accepts a correctly stated year without complaint", () => {
    const result = validateExtraction(
      extraction([
        assignment({
          title: "Research Paper",
          type: "paper",
          dueDate: { iso: "2026-12-08", raw: "DECEMBER 8, 2026", time: null, ambiguity: "none" },
          pointsPossible: null,
          category: "Research Paper",
          isMajorProject: true,
          evidence: { page: 5, excerpt: "DUE ON OR BEFORE DECEMBER 8, 2026" },
        }),
      ]),
      { pages: THEOLOGY_PAGES, ...THEOLOGY_TERM },
    );

    expect(result.assignments[0]!.issues).not.toContain("DATE_YEAR_MISMATCH");
    expect(result.assignments[0]!.issues).not.toContain("DATE_NOT_IN_SOURCE");
  });
});

describe("week-range scheduling, as all three syllabi use it", () => {
  it("strips a due date the model derived from a week range", () => {
    // "Each Wednesday there will be a quiz" plus "Aug. 25-28, 2026" does imply Aug 26,
    // but that is a two-step inference the extractor must not make silently.
    const result = validateExtraction(
      extraction([
        assignment({
          title: "QUIZ 1",
          type: "quiz",
          dueDate: { iso: "2026-09-02", raw: "September 1-4, 2026", time: null, ambiguity: "none" },
          evidence: { page: 5, excerpt: "QUIZ 1\nAugust Chapters 1-3" },
        }),
      ]),
      { pages: GREEK_PAGES, ...GREEK_TERM },
    );

    expect(result.assignments[0]!.issues).toContain("DATE_NOT_IN_SOURCE");
    expect(result.assignments[0]!.assignment.dueDate.iso).toBeNull();
  });

  it("asks about thirteen undated quizzes once, not thirteen times", () => {
    // Greek lists 13 weekly quizzes by week range. One question should resolve all of them.
    const quizzes = Array.from({ length: 13 }, (_, i) =>
      assignment({
        title: `QUIZ ${i + 1}`,
        type: "quiz",
        dueDate: { iso: null, raw: `Week ${i + 2}`, time: null, ambiguity: "relative_week" },
        evidence: { page: 5, excerpt: "All Quizzes are\nAccumulative" },
      }),
    );

    const result = validateExtraction(extraction(quizzes), { pages: GREEK_PAGES, ...GREEK_TERM });

    const relative = result.clarificationQuestions.filter((q) => q.kind === "relative_date");
    expect(relative).toHaveLength(1);
    expect(relative[0]!.relatesToTitles).toHaveLength(13);
    expect(relative[0]!.question).toContain("13");
    // Every quiz is still individually present and reviewable.
    expect(result.assignments).toHaveLength(13);
  });

  it("keeps a small number of questions listed individually", () => {
    const two = [1, 2].map((n) =>
      assignment({
        title: `QUIZ ${n}`,
        dueDate: { iso: null, raw: `Week ${n}`, time: null, ambiguity: "relative_week" },
        evidence: { page: 5, excerpt: "All Quizzes are\nAccumulative" },
      }),
    );
    const result = validateExtraction(extraction(two), { pages: GREEK_PAGES, ...GREEK_TERM });
    expect(result.clarificationQuestions.filter((q) => q.kind === "relative_date")).toHaveLength(2);
  });
});

describe("Revelation's contradictory paper deadline", () => {
  it("surfaces both dates rather than silently picking one", () => {
    // The schedule table says "Position Paper DUE December 10"; the grading section says
    // "DUE ON OR BEFORE December 11, 2026". Both are real text in the document.
    const result = validateExtraction(
      extraction([
        assignment({
          title: "Position Paper",
          type: "paper",
          dueDate: { iso: "2026-12-10", raw: "December 10", time: null, ambiguity: "conflicting" },
          isMajorProject: true,
          evidence: { page: 5, excerpt: "Position Paper DUE\nDecember 10" },
        }),
        assignment({
          title: "Position Paper",
          type: "paper",
          dueDate: { iso: "2026-12-11", raw: "December 11, 2026", time: null, ambiguity: "conflicting" },
          isMajorProject: true,
          evidence: { page: 6, excerpt: "DUE ON OR BEFORE December 11, 2026" },
        }),
      ]),
      { pages: REVELATION_PAGES, termStartDate: "2026-08-25", termEndDate: "2026-12-18" },
    );

    // Both survive review — neither date is invented, so neither is dropped and the
    // student picks. But the second is flagged as contradicting the first rather than
    // being written off as a duplicate, which would have hidden the disagreement.
    expect(result.assignments).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.assignments.map((a) => a.assignment.dueDate.iso)).toEqual([
      "2026-12-10",
      "2026-12-11",
    ]);
    expect(result.assignments[1]!.issues).toContain("CONFLICTING_DATE_FOR_SAME_ITEM");
    expect(result.assignments[1]!.issues).not.toContain("DUPLICATE_OF_EARLIER_CLAIM");

    const question = result.clarificationQuestions.find((q) =>
      q.question.includes("two different dates"),
    );
    expect(question?.why).toContain("2026-12-10");
    expect(question?.why).toContain("2026-12-11");
  });

  it("still treats a genuine repeat as a duplicate, not a conflict", () => {
    const twice = Array.from({ length: 2 }, () =>
      assignment({
        title: "Position Paper",
        type: "paper",
        dueDate: { iso: "2026-12-11", raw: "December 11, 2026", time: null, ambiguity: "none" },
        evidence: { page: 6, excerpt: "DUE ON OR BEFORE December 11, 2026" },
      }),
    );

    const result = validateExtraction(extraction(twice), {
      pages: REVELATION_PAGES,
      termStartDate: "2026-08-25",
      termEndDate: "2026-12-18",
    });

    expect(result.assignments[1]!.issues).toContain("DUPLICATE_OF_EARLIER_CLAIM");
    expect(result.assignments[1]!.duplicateOf).toBe("Position Paper");
  });
});

describe("grading weights in the real documents", () => {
  it("accepts Theology's four 25% categories", () => {
    const result = validateExtraction(
      extraction([], {
        gradingCategories: [
          ["Attendance & Class Participation", 25],
          ["Quizzes", 25],
          ["Research Paper", 25],
          ["Final Exam", 25],
        ].map(([name, weight]) => ({
          name: name as string,
          weightPercent: weight as number,
          dropLowest: null,
          evidence: { page: 5, excerpt: `${name} ${weight}%` },
          confidence: 0.95,
        })),
      }),
      { pages: THEOLOGY_PAGES, ...THEOLOGY_TERM },
    );

    expect(result.warnings.filter((w) => w.includes("add up to"))).toHaveLength(0);
  });

  it("warns when only part of Greek's grading scheme was read", () => {
    // Greek's quizzes are 30% and exams 40%; missing the rest should not pass silently.
    const result = validateExtraction(
      extraction([], {
        gradingCategories: [
          {
            name: "Quizzes",
            weightPercent: 30,
            dropLowest: null,
            evidence: { page: 4, excerpt: "Quizzes: Each Wednesday there will be a quiz" },
            confidence: 0.9,
          },
          {
            name: "Exams",
            weightPercent: 40,
            dropLowest: null,
            evidence: { page: 4, excerpt: "Exams: There are two exams this semester" },
            confidence: 0.9,
          },
        ],
      }),
      { pages: GREEK_PAGES, ...GREEK_TERM },
    );

    expect(result.warnings.join(" ")).toMatch(/70%/);
  });
});
