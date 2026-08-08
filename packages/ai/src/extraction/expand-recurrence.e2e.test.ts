import { describe, expect, it } from "vitest";
import { validateExtraction } from "./validate.js";
import type { SyllabusExtraction } from "./schema.js";

const PED_PAGE = `GRADING
Weekly Fitness Logs   40%
FITNESS LOGS
A weekly fitness log is due each Sunday by 9:00 pm, submitted online. Logs record all
activity for the week and a short reflection. There are 14 logs; the two lowest scores
are dropped.`;

/**
 * The whole path, on the sentence that actually failed.
 *
 * The unit tests prove `expandRecurrence` counts Sundays correctly. This proves the expansion
 * survives the validator, which is a different claim and the one that broke: the first run
 * produced fourteen assignments with fourteen null dates, because `dateAppearsInSource` cannot
 * find a date the document never printed and strips it as invented — exactly what it should do
 * to a date nobody can point at, and exactly wrong for a date this codebase computed itself.
 */
describe("expansion survives validation", () => {
  it("turns the stated rule into fourteen dated assignments", () => {
    const extraction = {
      courseFacts: { name: null, code: null, instructor: null, credits: null, termStartDate: null, termEndDate: null, evidence: { page: 1, excerpt: "GRADING" }, confidence: 0.9 },
      meetingPatterns: [],
      gradingCategories: [],
      assignments: [{
        title: "Weekly Fitness Log",
        type: "other" as const,
        dueDate: { iso: null, raw: "each Sunday", time: null, ambiguity: "missing" as const },
        pointsPossible: null,
        category: null,
        isMajorProject: false,
        recurrence: { frequency: "weekly" as const, dayOfWeek: 0, count: 14, dropLowest: 2 },
        evidence: { page: 1, excerpt: "A weekly fitness log is due each Sunday by 9:00 pm" },
        confidence: 0.95,
      }],
      policies: [],
      scheduleAnchors: [],
    clarificationQuestions: [],
    } as unknown as SyllabusExtraction;

    const result = validateExtraction(extraction, {
      pages: [{ page: 1, text: PED_PAGE }],
      termStartDate: "2026-08-24",
      termEndDate: "2026-12-11",
    });

    expect(result.assignments).toHaveLength(14);
    expect(result.rejected).toEqual([]);
    // Every instance keeps the sentence that stated the rule, so the evidence check passes on
    // all of them rather than the expansion being a way past it.
    expect(result.assignments.every((a) => a.evidenceVerified)).toBe(true);
    // Dated, and dated on Sundays.
    expect(result.assignments.map((a) => a.assignment.dueDate.iso).filter(Boolean)).toHaveLength(14);
    for (const a of result.assignments) {
      expect(new Date(`${a.assignment.dueDate.iso}T00:00:00Z`).getUTCDay()).toBe(0);
      // Flagged as inference, not fact: the rule was read by a model and the arithmetic trusts
      // the term dates, so the student gets to correct it.
      expect(a.issues).toContain("DATE_DERIVED_FROM_RULE");
    }
  });
});
