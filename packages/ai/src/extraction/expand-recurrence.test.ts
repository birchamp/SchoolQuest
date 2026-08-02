import { describe, expect, it } from "vitest";
import { expandAll, expandRecurrence, type TermWindow } from "./expand-recurrence.js";
import type { ExtractedAssignment } from "./schema.js";

/** Instruction runs 24 August – 11 December 2026, the fixture semester. */
const TERM: TermWindow = { termStartDate: "2026-08-24", termEndDate: "2026-12-11" };

function assignment(overrides: Partial<ExtractedAssignment> = {}): ExtractedAssignment {
  return {
    title: "Reading Response",
    type: "reading",
    dueDate: { iso: null, raw: "each Tuesday", time: null, ambiguity: "missing" },
    pointsPossible: null,
    category: "Reading Responses",
    isMajorProject: false,
    recurrence: null,
    evidence: { page: 1, excerpt: "A short response to the assigned reading is due each Tuesday in class." },
    confidence: 0.9,
    ...overrides,
  };
}

describe("expanding work a syllabus states as a rule", () => {
  it("leaves an ordinary assignment exactly as it is", () => {
    const one = assignment({ recurrence: null });
    expect(expandRecurrence(one, TERM)).toEqual([one]);
  });

  it('turns "due each Tuesday" into one assignment per Tuesday of the term', () => {
    // The real ENG 230 sentence. Sixteen Tuesdays fall between 24 August and 11 December 2026.
    const out = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", dayOfWeek: 2, count: null, dropLowest: null } }),
      TERM,
    );
    expect(out).toHaveLength(16);
    expect(out[0]!.title).toBe("Reading Response 1");
    expect(out[0]!.dueDate.iso).toBe("2026-08-25");
    expect(out.at(-1)!.dueDate.iso).toBe("2026-12-08");
    for (const a of out) expect(new Date(`${a.dueDate.iso}T00:00:00Z`).getUTCDay()).toBe(2);
  });

  it("believes a stated count over the calendar", () => {
    // PED 110: "A weekly fitness log is due each Sunday ... There are 14 logs". Sixteen Sundays
    // fall in the term, and the syllabus says fourteen. Fourteen is a fact about the course.
    const out = expandRecurrence(
      assignment({
        title: "Weekly Fitness Log",
        recurrence: { frequency: "weekly", dayOfWeek: 0, count: 14, dropLowest: 2 },
      }),
      TERM,
    );
    expect(out).toHaveLength(14);
    expect(out[0]!.dueDate.iso).toBe("2026-08-30");
    for (const a of out) expect(new Date(`${a.dueDate.iso}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it("numbers the instances so a plan can name one of them", () => {
    const out = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", dayOfWeek: 2, count: 3, dropLowest: null } }),
      TERM,
    );
    expect(out.map((a) => a.title)).toEqual(["Reading Response 1", "Reading Response 2", "Reading Response 3"]);
  });

  it("admits it does not know a date rather than inventing one", () => {
    // A count with no weekday: the syllabus said how many, never said when. Undated is honest
    // and the app already flags it; a guessed deadline is a day a student turns up on.
    const out = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", dayOfWeek: null, count: 4, dropLowest: null } }),
      TERM,
    );
    expect(out).toHaveLength(4);
    for (const a of out) {
      expect(a.dueDate.iso).toBeNull();
      expect(a.dueDate.ambiguity).toBe("missing");
    }
  });

  it("never runs past the end of the term", () => {
    const out = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", dayOfWeek: 2, count: null, dropLowest: null } }),
      { termStartDate: "2026-11-30", termEndDate: "2026-12-11" },
    );
    expect(out.every((a) => (a.dueDate.iso ?? "") <= "2026-12-11")).toBe(true);
  });

  it("keeps the sentence that stated the rule as every instance's evidence", () => {
    // The validator rejects any claim whose excerpt is not on the page, so a derived instance
    // has to keep quoting the rule verbatim rather than inventing a citation for itself.
    const source = assignment({
      recurrence: { frequency: "weekly", dayOfWeek: 2, count: 5, dropLowest: null },
    });
    for (const a of expandRecurrence(source, TERM)) {
      expect(a.evidence).toEqual(source.evidence);
      expect(a.recurrence).toBeNull();
    }
  });

  it("does not expand a rule that describes a single occurrence", () => {
    const out = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", dayOfWeek: 2, count: 1, dropLowest: null } }),
      TERM,
    );
    expect(out).toHaveLength(1);
  });

  it("expands a whole list in place, leaving the rest alone", () => {
    const out = expandAll(
      [
        assignment({ title: "Exam 1", recurrence: null }),
        assignment({ recurrence: { frequency: "weekly", dayOfWeek: 2, count: 3, dropLowest: null } }),
        assignment({ title: "Final", recurrence: null }),
      ],
      TERM,
    );
    expect(out.map((a) => a.title)).toEqual([
      "Exam 1",
      "Reading Response 1",
      "Reading Response 2",
      "Reading Response 3",
      "Final",
    ]);
  });

  it("closes the gap the recall eval measured", () => {
    /**
     * The two sentences that cost 28 of 84 pieces of work, run through together. Recall on the
     * fixture semester was 67%; these two families alone are 30 of the 84, and they arrive as
     * two items without this.
     */
    const logs = expandRecurrence(
      assignment({
        title: "Weekly Fitness Log",
        recurrence: { frequency: "weekly", dayOfWeek: 0, count: 14, dropLowest: 2 },
      }),
      TERM,
    );
    const responses = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", dayOfWeek: 2, count: null, dropLowest: null } }),
      TERM,
    );
    expect(logs.length + responses.length).toBe(30);
  });
});
