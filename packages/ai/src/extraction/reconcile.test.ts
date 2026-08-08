import { describe, expect, it } from "vitest";
import type { SyllabusExtraction, ExtractedAssignment } from "./schema.js";
import { reconcileExtractions, confidenceFromAgreement, assignmentKey } from "./reconcile.js";
import { planFollowUps, buildFollowUpMessage } from "./followup.js";
import { validateExtraction } from "./validate.js";

/**
 * Reading a syllabus more than once, and what the disagreement is worth.
 *
 * The evidence check catches a claim the document does not support. It cannot catch a claim the
 * document *does* support and one reading simply missed, and on real syllabi that is the commoner
 * failure. These are the two things a second reading buys and the one thing it does not.
 */

const PAGES = [
  {
    page: 1,
    text: "PSY 210 Schedule\nSept 12 Quiz 1\nOct 18 Developmental Analysis Paper due\nDec 4 Final Exam",
  },
  { page: 2, text: "Late work: the paper is due on or before December 1." },
];

function item(over: Partial<ExtractedAssignment> & { title: string }): ExtractedAssignment {
  return {
    type: "problem_set",
    dueDate: { iso: null, raw: null, time: null, ambiguity: "none" },
    pointsPossible: null,
    category: null,
    isMajorProject: false,
    recurrence: null,
    evidence: { page: 1, excerpt: "Sept 12 Quiz 1" },
    confidence: 0.9,
    ...over,
  };
}

function run(assignments: ExtractedAssignment[]): SyllabusExtraction {
  return {
    courseFacts: { name: "PSY 210", code: null, instructor: null, evidence: null, confidence: 0.8 },
    scheduleAnchors: [],
    meetingPatterns: [],
    gradingCategories: [],
    assignments,
    policies: [],
    clarificationQuestions: [],
  };
}

const quiz = item({ title: "Quiz 1", type: "quiz", dueDate: { iso: "2026-09-12", raw: "Sept 12", time: null, ambiguity: "none" } });
const paperOct = item({
  title: "Developmental Analysis Paper",
  type: "paper",
  dueDate: { iso: "2026-10-18", raw: "Oct 18", time: null, ambiguity: "none" },
  evidence: { page: 1, excerpt: "Oct 18 Developmental Analysis Paper due" },
});
const paperDec = item({
  title: "Developmental Analysis Paper",
  type: "paper",
  dueDate: { iso: "2026-12-01", raw: "December 1", time: null, ambiguity: "none" },
  evidence: { page: 2, excerpt: "the paper is due on or before December 1" },
});
const finalExam = item({
  title: "Final Exam",
  type: "exam",
  dueDate: { iso: "2026-12-04", raw: "Dec 4", time: null, ambiguity: "none" },
  evidence: { page: 1, excerpt: "Dec 4 Final Exam" },
});

describe("three readings of one syllabus", () => {
  it("keeps everything any run found, and says how many found it", () => {
    /**
     * The union, not the intersection. Dropping an item only one run saw buys a cleaner result
     * with a missing assignment — and a missing assignment is invisible to the student, while a
     * doubtful one is a line in the review queue.
     */
    const r = reconcileExtractions([run([quiz, paperOct]), run([quiz, paperOct, finalExam]), run([quiz])]);

    expect(r.extraction.assignments.map((a) => a.title).sort()).toEqual([
      "Developmental Analysis Paper",
      "Final Exam",
      "Quiz 1",
    ]);
    expect(r.agreement[assignmentKey(quiz)]).toMatchObject({ found: 3, outOf: 3 });
    expect(r.agreement[assignmentKey(finalExam)]).toMatchObject({ found: 1, outOf: 3 });
    expect(r.unanimous).toContain(assignmentKey(quiz));
    // Worst first, so the review queue can lead with the least certain thing.
    expect(r.contested[0]).toMatchObject({ key: assignmentKey(finalExam), found: 1 });
  });

  it("catches the same item dated two different ways", () => {
    // The strongest signal in the whole reconciliation: two readers disagreeing about a date
    // usually means the document states it twice, which is a real contradiction to surface.
    const r = reconcileExtractions([run([paperOct]), run([paperDec]), run([paperOct])]);
    expect(r.contradictions).toEqual([
      { key: assignmentKey(paperOct), values: ["2026-10-18", "2026-12-01"] },
    ]);
  });

  it("grades confidence from how reliably a claim was found", () => {
    const r = reconcileExtractions([run([quiz, paperOct]), run([quiz]), run([quiz])]);
    expect(confidenceFromAgreement(r.agreement[assignmentKey(quiz)])).toBe("high_inference");
    expect(confidenceFromAgreement(r.agreement[assignmentKey(paperOct)])).toBe("unknown");
    // Never "confirmed": unanimity is stability, not proof, and only a student can confirm.
    expect(confidenceFromAgreement({ found: 3, outOf: 3, conflictingValues: [] })).toBe("high_inference");
  });

  it("is unchanged by a single run, and reproducible", () => {
    const once = reconcileExtractions([run([quiz, paperOct])]);
    expect(once.extraction.assignments).toHaveLength(2);
    expect(once.contested).toEqual([]);
    // Same runs in, same answer out — the property that makes a disagreement worth investigating.
    const a = reconcileExtractions([run([quiz]), run([paperOct])]);
    const b = reconcileExtractions([run([quiz]), run([paperOct])]);
    expect(b).toEqual(a);
  });
});

describe("what to go back and ask", () => {
  it("leads with the disagreement, and carries the whole document for it", () => {
    const reconciled = reconcileExtractions([run([paperOct]), run([paperDec])]);
    const validation = validateExtraction(reconciled.extraction, { pages: PAGES });
    const plan = planFollowUps({ validation, reconciled, pages: PAGES });

    expect(plan[0]!.kind).toBe("DISAGREEMENT");
    expect(plan[0]!.question).toContain("2026-10-18");
    expect(plan[0]!.question).toContain("2026-12-01");
    // A contradiction can be settled by any page, so it gets all of them.
    expect(plan[0]!.pages).toEqual([1, 2]);
  });

  it("does not re-ask for a date the document simply does not contain", () => {
    /**
     * The omission is the design. Re-reading cannot conjure a date that was never printed, so
     * MISSING_DATE belongs to the student and their instructor. Spending a pass on it teaches
     * the loop to churn against a document that will never answer.
     */
    const undated = item({ title: "Reading Response", evidence: { page: 1, excerpt: "PSY 210 Schedule" } });
    const validation = validateExtraction(run([undated]), { pages: PAGES });
    expect(validation.assignments[0]!.issues).toContain("MISSING_DATE");
    expect(planFollowUps({ validation, pages: PAGES })).toEqual([]);
  });

  it("asks for the week headers when work is dated by week and none were reported", () => {
    const weekly = item({
      title: "Assignment 5",
      dueDate: { iso: null, raw: "Week 10", time: null, ambiguity: "relative_week" },
    });
    const validation = validateExtraction(run([weekly]), { pages: PAGES });
    const plan = planFollowUps({ validation, pages: PAGES });
    expect(plan.some((i) => i.kind === "MISSING_ANCHOR")).toBe(true);
  });

  it("sends only the pages that could answer, with the question first", () => {
    const reconciled = reconcileExtractions([run([paperOct]), run([paperDec])]);
    const validation = validateExtraction(reconciled.extraction, { pages: PAGES });
    const [first] = planFollowUps({ validation, reconciled, pages: PAGES });
    const message = buildFollowUpMessage({ ...first!, pages: [2] }, PAGES);

    expect(message.startsWith("QUESTION:")).toBe(true);
    expect(message).toContain("the paper is due on or before December 1");
    expect(message).not.toContain("Sept 12 Quiz 1");
  });

  it("never plans more questions than the budget allows", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      item({ title: `Item ${i}`, dueDate: { iso: null, raw: "Week 3", time: null, ambiguity: "relative_week" } }),
    );
    const validation = validateExtraction(run(many), { pages: PAGES });
    expect(planFollowUps({ validation, pages: PAGES, maxQuestions: 4 })).toHaveLength(4);
  });
});
