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
      assignment({ recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 2, count: null, dropLowest: null } }),
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
        recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 0, count: 14, dropLowest: 2 },
      }),
      TERM,
    );
    expect(out).toHaveLength(14);
    expect(out[0]!.dueDate.iso).toBe("2026-08-30");
    for (const a of out) expect(new Date(`${a.dueDate.iso}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it("numbers the instances so a plan can name one of them", () => {
    const out = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 2, count: 3, dropLowest: null } }),
      TERM,
    );
    expect(out.map((a) => a.title)).toEqual(["Reading Response 1", "Reading Response 2", "Reading Response 3"]);
  });

  it("admits it does not know a date rather than inventing one", () => {
    // A count with no weekday: the syllabus said how many, never said when. Undated is honest
    // and the app already flags it; a guessed deadline is a day a student turns up on.
    const out = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: null, count: 4, dropLowest: null } }),
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
      assignment({ recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 2, count: null, dropLowest: null } }),
      { termStartDate: "2026-11-30", termEndDate: "2026-12-11" },
    );
    expect(out.every((a) => (a.dueDate.iso ?? "") <= "2026-12-11")).toBe(true);
  });

  it("keeps the sentence that stated the rule as every instance's evidence", () => {
    // The validator rejects any claim whose excerpt is not on the page, so a derived instance
    // has to keep quoting the rule verbatim rather than inventing a citation for itself.
    const source = assignment({
      recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 2, count: 5, dropLowest: null },
    });
    for (const a of expandRecurrence(source, TERM)) {
      expect(a.evidence).toEqual(source.evidence);
      expect(a.recurrence).toBeNull();
    }
  });

  it("does not expand a rule that describes a single occurrence", () => {
    const out = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 2, count: 1, dropLowest: null } }),
      TERM,
    );
    expect(out).toHaveLength(1);
  });

  it("expands a whole list in place, leaving the rest alone", () => {
    const out = expandAll(
      [
        assignment({ title: "Exam 1", recurrence: null }),
        assignment({ recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 2, count: 3, dropLowest: null } }),
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
        recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 0, count: 14, dropLowest: 2 },
      }),
      TERM,
    );
    const responses = expandRecurrence(
      assignment({ recurrence: { frequency: "weekly", everyClassMeeting: false, dayOfWeek: 2, count: null, dropLowest: null } }),
      TERM,
    );
    expect(logs.length + responses.length).toBe(30);
  });
});

describe("work due at every class meeting", () => {
  /**
   * A real syllabus in the corpus sets a quiz at the start of every class in a course that meets
   * twice a week. `dayOfWeek` holds one day, so the app asked "which day of the week is this
   * due?" -- a question with no correct answer, because the answer is both. The student entered
   * every quiz of the term by hand.
   *
   * The days are not guessed and not asked for: the same syllabus states its own meeting
   * pattern, and the same extraction already reads it.
   */
  const TERM = { termStartDate: "2026-09-01", termEndDate: "2026-09-28" };
  const quiz = (over = {}) =>
    assignment({
      title: "Class quiz",
      dueDate: { iso: null, raw: "every class", time: null, ambiguity: "missing" as const },
      recurrence: {
        frequency: "weekly" as const,
        dayOfWeek: null,
        everyClassMeeting: true,
        count: null,
        dropLowest: null,
      },
      ...over,
    });

  it("produces one for each meeting day, not one a week", () => {
    // Monday and Wednesday across four full weeks is eight, and the old behaviour gave none.
    const out = expandRecurrence(quiz(), TERM, [1, 3]);
    expect(out).toHaveLength(8);
    expect(out.every((a) => a.dueDate.iso !== null)).toBe(true);
  });

  it("numbers them in date order across the days, not one weekday at a time", () => {
    // Quiz 2 has to be the first Wednesday. Expanding each weekday in turn would make it the
    // second Monday, and every number the student saw would name the wrong day.
    const out = expandRecurrence(quiz(), TERM, [1, 3]);
    expect(out[0]).toMatchObject({ title: "Class quiz 1", dueDate: { iso: "2026-09-02" } });
    expect(out[1]).toMatchObject({ title: "Class quiz 2", dueDate: { iso: "2026-09-07" } });
    expect(out[2]).toMatchObject({ title: "Class quiz 3", dueDate: { iso: "2026-09-09" } });
  });

  it("marks the dates as derived, so the validator still knows the page never printed them", () => {
    expect(expandRecurrence(quiz(), TERM, [1, 3])[0]!.dueDate.ambiguity).toBe("derived_recurrence");
  });

  it("honours a stated count over the number of meetings", () => {
    // "There are 10 quizzes" is a fact about the course; the eleventh Wednesday is not.
    const out = expandRecurrence(quiz({ recurrence: {
      frequency: "weekly" as const, dayOfWeek: null, everyClassMeeting: true, count: 3, dropLowest: null,
    } }), TERM, [1, 3]);
    expect(out).toHaveLength(3);
  });

  it("leaves them undated when the class meeting days are not known", () => {
    // A syllabus that never states its meeting times leaves this genuinely unanswerable, and an
    // admitted gap beats a guessed weekday.
    const out = expandRecurrence(quiz(), TERM, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.dueDate.iso).toBeNull();
  });

  it("keeps a stated count as one re-expandable item while the days are unknown", () => {
    // "There are 3 quizzes" with no meeting days must not explode into three dateless rows: that
    // would drop the rule and it could never be dated once the days are answered. One item that
    // still carries its rule is what lets the deterministic re-expand place them later.
    const out = expandRecurrence(
      quiz({
        recurrence: {
          frequency: "weekly" as const,
          dayOfWeek: null,
          everyClassMeeting: true,
          count: 3,
          dropLowest: null,
        },
      }),
      TERM,
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.recurrence).not.toBeNull();
    expect(out[0]!.dueDate.iso).toBeNull();
  });

  it("ignores meeting days for an ordinary weekly rule", () => {
    // "Each Tuesday" in a Monday/Wednesday class is still Tuesdays. Only a per-session rule
    // takes its days from the meeting pattern.
    const out = expandRecurrence(
      quiz({ recurrence: { frequency: "weekly" as const, dayOfWeek: 2, everyClassMeeting: false, count: null, dropLowest: null } }),
      TERM,
      [1, 3],
    );
    expect(out.every((a) => new Date(`${a.dueDate.iso}T00:00:00Z`).getUTCDay() === 2)).toBe(true);
  });
});
