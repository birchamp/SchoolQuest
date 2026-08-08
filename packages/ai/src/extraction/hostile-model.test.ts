import { describe, expect, it } from "vitest";
import {
  DENSE_SCHEDULE_PAGES,
  GRADING_PROSE_PAGES,
  TABLE_SCHEDULE_PAGES,
} from "@schoolquest/fixtures";
import type { ExtractedAssignment, SyllabusExtraction } from "./schema.js";
import { validateExtraction, verifyEvidence } from "./validate.js";

/**
 * The evidence check, attacked on purpose.
 *
 * Every other test in this directory asks whether the validator lets a *correct* extraction
 * through. This one asks the opposite question, which is the one the design actually rests on:
 * when a model invents an assignment, does the claim get thrown out?
 *
 * That matters more than it looks. The whole extraction contract is "every claim carries the
 * page and the literal text it came from, and we check the text is really there". If that check
 * can be beaten, then a fluent model inventing a plausible deadline produces a work item the
 * student sees as `confirmed`, schedules time for, and studies toward. Nothing downstream
 * re-reads the PDF. `verifyEvidence` is the only thing standing between a hallucinated exam and
 * a student's calendar, and until this file existed it had never been shown to reject anything.
 *
 * The attack surface is the near-miss fallback. Exact substring is the primary test; when that
 * misses, a claim can still survive as `partial` on token overlap. Writing this file is what
 * showed that fallback was far too generous: it asked only whether 80% of the quoted words
 * longer than two characters appeared *somewhere* on the page, in any order, as a substring of
 * anything. On a dense schedule page — where every month abbreviation, every day number and
 * every assignment noun is already printed — that is a large bag of real words to build a fake
 * sentence from, and cases A and D below and the short-excerpt case all walked through it.
 *
 * `verifyEvidence` now requires the matched words to cluster inside one window of the page, and
 * refuses the fallback to excerpts under five content words. Every assertion here is the
 * behaviour after that change.
 *
 * Six shapes are tried below, ordered roughly by how hard they are to catch:
 *
 *   A. word salad assembled only from tokens on the page
 *   B. a plausible assignment the document never mentions
 *   C. a real sentence cited to the wrong page
 *   D. a real quote with an invented tail
 *   E. a real date attached to an item that is not the one it belongs to
 *   F. an entirely invented sentence in ordinary English
 *
 * Five are caught. E is not, and cannot be by this check — it is recorded as the known limit.
 *
 * Everything here is pure: no model, no Worker, no browser. It runs in milliseconds and it is
 * the cheapest permanent guard the repo has against whichever extraction model is in use.
 */

const CONTEXT = { termStartDate: "2022-01-10", termEndDate: "2022-05-06" };

function claim(over: Partial<ExtractedAssignment> & Pick<ExtractedAssignment, "title" | "evidence">): ExtractedAssignment {
  return {
    type: "problem_set",
    dueDate: { iso: null, raw: null, time: null, ambiguity: "none" },
    pointsPossible: null,
    category: null,
    isMajorProject: false,
    recurrence: null,
    confidence: 0.9,
    ...over,
  };
}

function extraction(assignments: ExtractedAssignment[]): SyllabusExtraction {
  return {
    courseFacts: { name: null, code: null, instructor: null, evidence: null, confidence: 0.5 },
    scheduleAnchors: [],
    meetingPatterns: [],
    gradingCategories: [],
    assignments,
    policies: [],
    clarificationQuestions: [],
  };
}

/** What the validator did with a single claim: kept it, kept it flagged, or threw it out. */
type Fate = "rejected" | "flagged" | "clean";

function fateOf(assignment: ExtractedAssignment, pages: { page: number; text: string }[]): {
  fate: Fate;
  issues: string[];
} {
  const result = validateExtraction(extraction([assignment]), { pages, ...CONTEXT });
  if (result.rejected.length > 0) return { fate: "rejected", issues: [result.rejected[0]!.reason] };
  const kept = result.assignments[0]!;
  return { fate: kept.issues.length > 0 ? "flagged" : "clean", issues: kept.issues };
}

describe("evidence excerpts a model could have invented", () => {
  /**
   * A. Word salad.
   *
   * Every word below is on page 7 of the calculus schedule. None of them appear in this order,
   * and the sentence describes work that does not exist. This is the purest form of the attack
   * the overlap fallback is vulnerable to: overlap is 100% by construction.
   */
  it("throws out a sentence assembled from words that are all on the page", () => {
    const excerpt = "Feb 14 Problem session Homework 1.3 Hydrostatic Force Review Test 1";

    // Every content word is on the page. Under a whole-page overlap check that is a 100% score
    // and a free pass — which is exactly what this used to get. The locality window is what
    // rejects it: "Hydrostatic" is a January row and "Feb 14" is thirty rows further down.
    expect(verifyEvidence(excerpt, DENSE_SCHEDULE_PAGES[0]!.text)).toEqual({
      verified: false,
      partial: false,
    });

    const { fate } = fateOf(
      claim({
        title: "Hydrostatic Force Problem Session",
        evidence: { page: 7, excerpt },
        dueDate: { iso: "2022-02-14", raw: "Feb 14", time: null, ambiguity: "none" },
      }),
      DENSE_SCHEDULE_PAGES,
    );
    expect(fate).toBe("rejected");
  });

  /**
   * B. A plausible assignment nobody assigned.
   *
   * The grading-prose page talks constantly about assignments, points and percentages, so an
   * invented one can borrow all of that vocabulary. What it cannot borrow is a distinctive noun.
   */
  it("throws out an assignment the document never mentions", () => {
    const { fate } = fateOf(
      claim({
        title: "Group Presentation",
        type: "presentation",
        evidence: {
          page: 12,
          excerpt:
            "Each group presentation is worth 50 points and must be submitted through the discussion board before the final exam.",
        },
      }),
      GRADING_PROSE_PAGES,
    );
    expect(fate).toBe("rejected");
  });

  /**
   * C. A real sentence, cited to the wrong page.
   *
   * The model quoted something that genuinely exists — just not where it says. On a two-page
   * citation this is a coin flip; the point is that the check is per-page and does not go
   * looking elsewhere, so a misfiled quote is caught rather than silently accepted.
   */
  it("throws out a real quote attributed to the wrong page", () => {
    const real = "There are 14 chapter exams, each worth 100 points.";
    expect(verifyEvidence(real, GRADING_PROSE_PAGES[0]!.text).verified).toBe(true);

    const { fate } = fateOf(
      claim({ title: "Chapter Exam 1", type: "exam", evidence: { page: 12, excerpt: real } }),
      GRADING_PROSE_PAGES,
    );
    expect(fate).toBe("rejected");
  });

  /**
   * D. A real quote with an invented tail.
   *
   * The most dangerous shape in practice, because it is what a helpful model actually does: it
   * quotes the page correctly and then completes the thought with the detail the student needed
   * and the document never gave. Here a real sentence about the final exam gains a due date.
   */
  it("catches a real quote finished with an invented clause", () => {
    const real =
      "The final exam is comprehensive and worth 200 points. You have 120 minutes to complete the final exam.";
    // Quoted correctly, the claim passes outright — the check must not punish honesty.
    expect(verifyEvidence(real, GRADING_PROSE_PAGES[0]!.text).verified).toBe(true);

    const { fate } = fateOf(
      claim({
        title: "Final Exam",
        type: "exam",
        evidence: {
          page: 11,
          excerpt:
            "The final exam is comprehensive and worth 200 points. You have 120 minutes to complete the final exam, which must be started by 5:00 PM on May 11.",
        },
        dueDate: { iso: "2023-05-11", raw: "May 11", time: "17:00", ambiguity: "none" },
      }),
      GRADING_PROSE_PAGES,
    );

    /**
     * The invented tail carries the claim past the window's tolerance and the whole thing is
     * discarded. That is the right trade even though the first two sentences are genuine: an
     * excerpt is a claim about what the document says, and this one is false. The student sees
     * it in `rejected` with a reason rather than as a deadline.
     */
    expect(fate).toBe("rejected");
  });

  /**
   * E. A real date on the wrong item.
   *
   * The excerpt is verbatim and the date is genuinely printed on the page — it just belongs to a
   * different row. Nothing in the evidence check can see this, and it should not pretend to:
   * this is the class of error the check structurally cannot catch, recorded here so the limit
   * is documented rather than discovered later.
   */
  it("cannot see a real date attached to the wrong item, and that is the known limit", () => {
    const { fate, issues } = fateOf(
      claim({
        title: "Test 2",
        type: "exam",
        // Verbatim from the table. Test 2 is on Feb 21; Feb 18 is Euler's Method.
        evidence: { page: 8, excerpt: "Feb 21 Test 2" },
        dueDate: { iso: "2022-02-18", raw: "Feb 18", time: null, ambiguity: "none" },
      }),
      DENSE_SCHEDULE_PAGES,
    );

    /**
     * Nothing is raised about either the evidence or the date. The only issue recorded is
     * TIME_NOT_STATED, which every dateless-time claim on every page gets and says nothing about
     * whether the claim is true. So: a wrong date, verbatim evidence, and no signal at all.
     *
     * The defence against this is not in the validator — it is §5.1 in
     * `docs/10-syllabus-gotchas.md`: compare the resolved weekday against the meeting pattern the
     * same document states. That is still open, and this test is where it will be closed.
     */
    expect(fate).toBe("flagged");
    expect(issues).toEqual(["TIME_NOT_STATED"]);
  });

  /**
   * F. Plain invention.
   *
   * The baseline. If this ever stops being rejected, the check has been loosened into
   * uselessness and every other assertion in this file is worthless.
   */
  it("throws out an invented sentence outright", () => {
    const { fate } = fateOf(
      claim({
        title: "Reflective Journal",
        evidence: {
          page: 12,
          excerpt:
            "Students will maintain a reflective journal documenting their clinical reasoning throughout the rotation.",
        },
      }),
      TABLE_SCHEDULE_PAGES,
    );
    expect(fate).toBe("rejected");
  });
});

describe("how much invention the overlap fallback tolerates", () => {
  /**
   * The residual tolerance, measured rather than argued.
   *
   * The fallback still keeps a claim at 80% overlap, so some invention gets in — it has to, or
   * a legitimate quote mangled by pdf.js would be thrown out with it. The question with a number
   * attached is: starting from a real quote, how many invented words can be appended before it
   * is caught? That is the size of what is left of the attack surface, and it is printed so a
   * change to the threshold or the window shows up as a changed number rather than a silent
   * shift. Before the locality window it was 4; it is 2 now.
   */
  it("measures how many invented words a real quote can carry", () => {
    const page = GRADING_PROSE_PAGES[0]!.text;
    const real = "The final exam is comprehensive and worth 200 points.";
    // Deliberately words that are NOT on the page — the strongest case for the check.
    const invented =
      "submitted electronically through the proctored testing centre before midnight on registration deadline".split(" ");

    let survived = 0;
    for (let n = 1; n <= invented.length; n += 1) {
      const excerpt = `${real} ${invented.slice(0, n).join(" ")}`;
      if (verifyEvidence(excerpt, page).partial) survived = n;
      else break;
    }

    const realTokens = real.split(" ").filter((t) => t.length > 2).length;
    console.log(
      `\nOVERLAP FALLBACK  a ${realTokens}-token real quote carries ${survived} invented words before rejection`,
    );

    /**
     * Bounded on both sides on purpose. Above zero, because a quote that survives no noise at
     * all is a check that will discard real work the first time pdf.js drops a word. Well under
     * the real quote's own length, because at that point the excerpt is mostly invention.
     *
     * What remains reachable is padding an existing claim with a clause or two — not fabricating
     * an assignment, which needs its own title, date and verb. That is why the date check is
     * load-bearing and not redundant: a padded claim is still stopped from carrying a date the
     * page does not print.
     */
    expect(survived).toBeGreaterThan(0);
    expect(survived).toBeLessThan(realTokens / 2);
  });

  /**
   * Short excerpts get no fallback at all.
   *
   * A three-word quote needs three words on the page to reach 100%, and on a dense schedule page
   * almost any three words are: each of these scored a clean pass before. Below five content
   * words the overlap ratio carries no information, so a short excerpt that misses the exact
   * match is simply absent.
   */
  it("gives short excerpts no fallback to hide behind", () => {
    const page = DENSE_SCHEDULE_PAGES[0]!.text;
    for (const nonsense of ["Test Homework session", "Review Homework Test", "Force Work session"]) {
      expect(verifyEvidence(nonsense, page), nonsense).toEqual({ verified: false, partial: false });
    }

    // A short quote that is really on the page still passes — on the exact match, which is where
    // a short quote should be passing. The fallback is for pdf.js noise, not for brevity.
    expect(verifyEvidence("Jan 28 Test 1", page).verified).toBe(true);
  });
});

describe("what survives a whole invented extraction", () => {
  /**
   * The end-to-end version: a model that read the calculus schedule and returned six items, of
   * which three are real and three are not. What reaches the student is what matters.
   */
  it("separates the real claims from the invented ones", () => {
    const result = validateExtraction(
      extraction([
        claim({
          title: "Test 1",
          type: "exam",
          evidence: { page: 7, excerpt: "Jan 28 Test 1" },
          dueDate: { iso: "2022-01-28", raw: "Jan 28", time: null, ambiguity: "none" },
        }),
        claim({
          title: "Homework 2.1",
          evidence: { page: 7, excerpt: "Feb 1 Problem session Homework 2.1" },
          dueDate: { iso: "2022-02-01", raw: "Feb 1", time: null, ambiguity: "none" },
        }),
        claim({
          title: "Test 2",
          type: "exam",
          evidence: { page: 8, excerpt: "Feb 21 Test 2" },
          dueDate: { iso: "2022-02-21", raw: "Feb 21", time: null, ambiguity: "none" },
        }),
        // Invented: a midterm project this course does not have.
        claim({
          title: "Midterm Project Proposal",
          type: "paper",
          evidence: {
            page: 7,
            excerpt: "A two-page project proposal is due at the start of the problem session.",
          },
          dueDate: { iso: "2022-02-11", raw: "Feb 11", time: null, ambiguity: "none" },
        }),
        // Invented: a reading response, quoted from a page the document does not have.
        claim({
          title: "Weekly Reading Response",
          type: "reading",
          evidence: { page: 3, excerpt: "Post a reading response each week before class." },
        }),
        // Invented by padding: real row, invented submission rule appended.
        claim({
          title: "Homework 3.2",
          evidence: {
            page: 8,
            excerpt: "Feb 22 3.2 Separable Equations Homework 2.6, Homework 3.1 submitted online",
          },
          dueDate: { iso: "2022-02-22", raw: "Feb 22", time: null, ambiguity: "none" },
        }),
      ]),
      { pages: DENSE_SCHEDULE_PAGES, ...CONTEXT },
    );

    const kept = new Map(result.assignments.map((a) => [a.assignment.title, a]));
    const thrownOut = result.rejected.map((r) => r.title);

    console.log(
      `\nHOSTILE EXTRACTION  ${result.assignments.length} kept, ${result.rejected.length} rejected` +
        `\n   rejected: ${thrownOut.join(", ") || "(none)"}` +
        `\n   kept:     ${[...kept].map(([t, a]) => `${t} [${a.confidenceStatus}] ${a.issues.join("|") || "-"}`).join("\n             ")}`,
    );

    // The two claims with no basis on the cited page are gone.
    expect(thrownOut).toEqual(
      expect.arrayContaining(["Midterm Project Proposal", "Weekly Reading Response"]),
    );

    // The three real ones survive with the evidence check satisfied outright.
    for (const title of ["Test 1", "Homework 2.1", "Test 2"]) {
      expect(kept.get(title)?.evidenceVerified, title).toBe(true);
    }

    // The padded one survives, and is flagged rather than confirmed — which is the behaviour the
    // review UI depends on to put it in front of the student instead of straight on the calendar.
    const padded = kept.get("Homework 3.2");
    expect(padded?.evidenceVerified).toBe(false);
    expect(padded?.issues).toContain("EVIDENCE_NOT_FOUND");
    expect(padded?.confidenceStatus).not.toBe("confirmed");
  });
});
