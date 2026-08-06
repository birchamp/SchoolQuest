import { expandAll } from "./expand-recurrence.js";
import type { ConfidenceStatus, TermCalendar } from "@schoolquest/domain";
import type { DocumentPage } from "./prompt.js";
import { isWithinTerm } from "./resolve-dates.js";
import type {
  ClarificationQuestion,
  ExtractedAssignment,
  ExtractedDate,
  SyllabusExtraction,
} from "./schema.js";

/**
 * Validation service (docs/06-ai-system-spec.md §2 step 3).
 *
 * The model is treated as a witness, not an authority. Everything it says is checked
 * against the document before it is allowed anywhere near the student's plan:
 *
 *  - Does the quoted excerpt actually exist on the page it cited?
 *  - Did it obey the no-invented-dates rules, or did it quietly fill a blank?
 *  - Do the grading weights add up?
 *  - Is this the same assignment it already reported?
 *
 * Claims that fail hard are dropped. Claims that fail softly are downgraded and surfaced
 * for review. Either way the student sees the evidence and decides.
 */

export type ClaimIssue =
  /** The quoted excerpt is not present on the cited page. Strong fabrication signal. */
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_PAGE_MISSING"
  /** The model produced an ISO date it could not have read (e.g. from "Week 5"). */
  | "DATE_NOT_IN_SOURCE"
  /** Computed by us from a recurrence the document stated, so nobody can point at it. */
  | "DATE_DERIVED_FROM_RULE"
  /** The document states a different year beside this date — usually a stale syllabus. */
  | "DATE_YEAR_MISMATCH"
  | "DATE_OUTSIDE_TERM"
  /** Dated into a finals window the registrar has not published a day for. */
  | "DATE_SET_BY_REGISTRAR"
  /** "Week N" after a break, in a term that has not said how its syllabi count breaks. */
  | "WEEK_NUMBER_AMBIGUOUS"
  /** Resolved onto a day inside a break, when there is no class. */
  | "DATE_IN_BREAK"
  | "TIME_NOT_STATED"
  | "AMBIGUOUS_DATE"
  | "MISSING_DATE"
  | "DUPLICATE_OF_EARLIER_CLAIM"
  /** Same assignment, two different dates — the syllabus contradicts itself. */
  | "CONFLICTING_DATE_FOR_SAME_ITEM"
  | "UNKNOWN_CATEGORY"
  | "LOW_MODEL_CONFIDENCE";

export interface ValidatedAssignment {
  assignment: ExtractedAssignment;
  /** What the planning engine should treat this record's certainty as. */
  confidenceStatus: ConfidenceStatus;
  issues: ClaimIssue[];
  /** Title of the earlier claim this appears to duplicate. */
  duplicateOf: string | null;
  /** True when the evidence check passed outright. */
  evidenceVerified: boolean;
}

export interface ValidationResult {
  assignments: ValidatedAssignment[];
  /** Assignments removed entirely, with the reason, so nothing disappears silently. */
  rejected: { title: string; reason: ClaimIssue }[];
  gradingCategories: SyllabusExtraction["gradingCategories"];
  meetingPatterns: SyllabusExtraction["meetingPatterns"];
  courseFacts: SyllabusExtraction["courseFacts"];
  policies: SyllabusExtraction["policies"];
  /** The model's questions plus any the validator derived from what it found. */
  clarificationQuestions: ClarificationQuestion[];
  warnings: string[];
}

export interface ValidationContext {
  pages: DocumentPage[];
  termStartDate?: string;
  termEndDate?: string;
  /**
   * Breaks, finals and the week-numbering convention. Optional, and its absence is exactly
   * what it looks like: a term nobody has given a calendar, whose recurrence counts will be
   * one too many per break and cannot know it.
   */
  termCalendar?: TermCalendar;
}

/** Collapses whitespace and punctuation variants so quoting is robust to PDF text quirks. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    // PDFs routinely substitute smart quotes, en dashes, and non-breaking spaces.
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    // Non-breaking, thin, and zero-width spaces are common in PDF text extraction output.
    .replace(/[\u00a0\u2007\u202f\u2009\u200b]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Excerpts shorter than this cannot use the near-miss fallback at all.
 *
 * A three-word quote needs three words on the page to score 100%, and on a schedule page
 * almost any three words are: "Test Homework session" scored a clean pass against a real
 * calculus schedule. Below this length overlap carries no information, so an excerpt that
 * fails the exact match is treated as absent. The prompt already asks for a full line.
 */
const MIN_FALLBACK_TOKENS = 5;

/**
 * How far the matched words may be spread before they stop being one quotation.
 *
 * Twice the quote's content-word count, in page tokens. A real quotation is *denser* than
 * that even after pdf.js has interleaved a column of times or page numbers through it, so the
 * slack is generous; an invented sentence has to find its words wherever they happen to be
 * printed, which on a five-month schedule table is tens of rows apart.
 *
 * The floor stops a short quote from getting a large window by arithmetic.
 */
function localityWindow(needleTokenCount: number): number {
  return Math.max(needleTokenCount * 2, 16);
}

/**
 * Confirms the model quoted something that is really there.
 *
 * Exact substring match after normalization is the primary test. PDF text extraction can
 * drop or reorder the odd character, so a near-miss falls back to token overlap rather
 * than failing a legitimate claim outright.
 *
 * The fallback is deliberately narrow, because it is the softest part of the whole extraction
 * contract. It used to ask only whether 80% of the quoted content words appeared *somewhere*
 * on the page, as a substring of anything. On a dense schedule page that is close to free:
 * "Feb 14 Problem session Homework 1.3 Hydrostatic Force Review Test 1" describes work that
 * does not exist and scored 100%, because every one of those words is printed somewhere in
 * five months of schedule rows.
 *
 * So the overlap is now measured **inside a window**. The quoted words have to cluster in one
 * region of the page, at token level, the way a real quotation does — which still tolerates
 * pdf.js dropping a word or transposing a column, and stops an invented sentence assembled
 * from the page's whole vocabulary. See `hostile-model.test.ts`, which exists to attack this.
 */
export function verifyEvidence(
  excerpt: string,
  pageText: string,
): { verified: boolean; partial: boolean } {
  const needle = normalize(excerpt);
  const haystack = normalize(pageText);
  if (needle.length === 0) return { verified: false, partial: false };
  if (haystack.includes(needle)) return { verified: true, partial: false };

  const tokens = needle.split(" ").filter((t) => t.length > 2);
  if (tokens.length < MIN_FALLBACK_TOKENS) return { verified: false, partial: false };

  // Token-level matching, not whole-page substring: "test" must be a page *word* containing
  // "test", so it no longer matches inside "latest" halfway down the document.
  const pageTokens = haystack.split(" ");
  const hits = tokens.map((t) => {
    const at: number[] = [];
    for (let i = 0; i < pageTokens.length; i += 1) if (pageTokens[i]!.includes(t)) at.push(i);
    return at;
  });

  const window = localityWindow(tokens.length);
  // Every window worth trying starts at a position where some quoted word actually occurs.
  const starts = new Set<number>([0, ...hits.flat()]);
  let best = 0;
  for (const start of starts) {
    const present = hits.filter((at) => at.some((i) => i >= start && i < start + window)).length;
    if (present > best) best = present;
  }

  // 0.8 tolerates extraction noise while still rejecting an invented sentence, whose
  // content words will not be clustered anywhere on the page.
  return { verified: false, partial: best / tokens.length >= 0.8 };
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Abbreviations actually seen in the wild, longest first so the fuller form wins. */
const MONTH_ABBREVIATIONS = [
  ["jan"], ["feb"], ["mar"], ["apr"], ["may"], ["jun"],
  ["jul"], ["aug"], ["sept", "sep"], ["oct"], ["nov"], ["dec"],
];

/**
 * Checks that an ISO date the model reported could plausibly have been read, rather than
 * computed, and reports what year the document states next to it.
 *
 * The year matters more than it looks. Real syllabi are edited year to year and routinely
 * carry a stale one — an otherwise-2026 document saying "Mid-term Exam on October 31,
 * 2025", or a paper topic due "on or before October 5, 2023". A model reading those will
 * usually be helpful and silently correct the year to the current term. That correction is
 * probably right, but it hides a real contradiction the student should see, and it might
 * be wrong. So the day is verified and the stated year is reported back rather than
 * quietly accepted.
 */
export function dateAppearsInSource(
  iso: string,
  pageText: string,
): { found: boolean; statedYear: number | null } {
  const haystack = normalize(pageText);
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];

  const monthName = MONTH_NAMES[month - 1]!;
  // Real syllabi abbreviate inconsistently, and September is routinely "Sept." rather
  // than the three-letter "Sep." — a truncate-to-three rule silently misses it.
  const abbreviations = MONTH_ABBREVIATIONS[month - 1]!;

  /**
   * Zero-padded forms are listed explicitly.
   *
   * Without them the check passed or failed depending on the *day of the month*: candidate
   * "2/23" is a substring of "02/23/24" and matched by accident, while "12/6" is not a
   * substring of "12/06" and was stripped as an invented date. Inside one real syllabus that
   * meant the 11/29 and 12/11 quizzes kept their dates and the 12/06 and 12/08 quizzes lost
   * theirs — a 20-page pharmacy syllabus written entirely as 01/02/24 lost every date it had.
   */
  const pad = (n: number) => String(n).padStart(2, "0");
  const candidates = [
    iso,
    `${month}/${day}/${year}`,
    `${month}/${day}/${String(year).slice(2)}`,
    `${pad(month)}/${pad(day)}/${year}`,
    `${pad(month)}/${pad(day)}/${String(year).slice(2)}`,
    `${pad(month)}/${pad(day)}`,
    `${month}/${day}`,
    `${month}-${day}`,
    `${monthName} ${day}`,
    ...abbreviations.flatMap((abbr) => [`${abbr}. ${day}`, `${abbr} ${day}`]),
    `${day} ${monthName}`,
    ...abbreviations.map((abbr) => `${day} ${abbr}`),
  ].map(normalize);

  for (const candidate of candidates) {
    const index = haystack.indexOf(candidate);
    if (index === -1) continue;
    // Reject a longer number that merely starts with ours: "oct 1" must not match "oct 15".
    const nextChar = haystack[index + candidate.length];
    if (nextChar !== undefined && /\d/.test(nextChar)) continue;

    return { found: true, statedYear: yearNear(haystack, index + candidate.length) };
  }

  return { found: false, statedYear: null };
}

/**
 * Looks for a 4-digit year just after a date match. The window is wide enough to step over
 * the tail of a range — "Aug. 25-28, 2026" states its year only after the range ends.
 */
function yearNear(haystack: string, from: number): number | null {
  const window = haystack.slice(from, from + 14);
  // Anything other than range/separator characters before the year means it is unrelated.
  const match = /^[\s\-–—,]*(?:\d{1,2}[\s\-–—,]*)?((?:19|20)\d{2})\b/.exec(window);
  return match ? Number(match[1]) : null;
}

export function validateExtraction(
  extraction: SyllabusExtraction,
  context: ValidationContext,
): ValidationResult {
  const pageText = new Map(context.pages.map((p) => [p.page, p.text]));
  const warnings: string[] = [];
  const rejected: ValidationResult["rejected"] = [];
  const derivedQuestions: ClarificationQuestion[] = [];
  const validated: ValidatedAssignment[] = [];
  const seen: { title: string; dateKey: string; original: string }[] = [];

  const knownCategories = new Set(
    extraction.gradingCategories.map((c) => c.name.trim().toLowerCase()),
  );

  /**
   * Work stated as a rule becomes work, before anything else looks at it.
   *
   * Expanding here rather than downstream means every generated occurrence goes through the
   * same evidence check, date resolution and duplicate detection as an assignment the model
   * listed itself — which is the point: an instance the app invented must be held to exactly
   * the standard as one it read, or expansion becomes a way to smuggle unverified work in.
   *
   * Needs the term dates to know how many Tuesdays there are. Without them the rule cannot be
   * counted, so the assignment stays as the single item the model reported and the missing
   * dates are raised as questions in the ordinary way.
   */
  const assignments =
    context.termStartDate && context.termEndDate
      ? expandAll(extraction.assignments, {
          termStartDate: context.termStartDate,
          termEndDate: context.termEndDate,
          ...(context.termCalendar ? { calendar: context.termCalendar } : {}),
        })
      : extraction.assignments;

  for (const assignment of assignments) {
    const issues: ClaimIssue[] = [];
    const text = pageText.get(assignment.evidence.page);

    // --- Evidence check. A claim citing a page that does not exist is discarded.
    if (text === undefined) {
      rejected.push({ title: assignment.title, reason: "EVIDENCE_PAGE_MISSING" });
      continue;
    }

    const { verified, partial } = verifyEvidence(assignment.evidence.excerpt, text);
    if (!verified && !partial) {
      // The model quoted something that is not on the page. Nothing else it said about
      // this item can be trusted, so the item does not enter the review queue at all.
      rejected.push({ title: assignment.title, reason: "EVIDENCE_NOT_FOUND" });
      continue;
    }
    if (!verified) issues.push("EVIDENCE_NOT_FOUND");

    // --- Date checks.
    const date = assignment.dueDate;
    if (date.iso !== null && date.ambiguity === "derived_recurrence") {
      /**
       * A date this codebase computed, not one the model claimed to read.
       *
       * `dateAppearsInSource` cannot tell those apart — neither is printed on the page — so
       * without this branch the validator strips every occurrence it has just generated, which
       * is what it did on the first run of this change: fourteen fitness logs survived with
       * fourteen null dates.
       *
       * It is still not treated as confirmed. The rule was read by a model and the arithmetic
       * assumes the term dates are right, so it enters review as an inference for the student
       * to correct, which is the same standing a resolved "Week 3" gets.
       */
      issues.push("DATE_DERIVED_FROM_RULE");
      // The dates were generated from these bounds, so they cannot fall outside them — unless
      // a caller expanded against one term and validated against another, which is worth
      // catching rather than assuming away.
      if (
        context.termStartDate !== undefined &&
        context.termEndDate !== undefined &&
        !isWithinTerm(date.iso, context.termStartDate, context.termEndDate)
      ) {
        issues.push("DATE_OUTSIDE_TERM");
        date.iso = null;
      }
    } else if (date.iso !== null) {
      const { found, statedYear } = dateAppearsInSource(date.iso, text);

      if (!found) {
        // The date was computed, not read. Strip it rather than schedule against it.
        issues.push("DATE_NOT_IN_SOURCE");
        date.iso = null;
        derivedQuestions.push({
          question: `When is "${assignment.title}" actually due?`,
          why: "The syllabus mentions it, but the date could not be confirmed from the document text.",
          relatesToTitle: assignment.title,
          kind: "missing_date",
        });
      } else if (statedYear !== null && statedYear !== Number(date.iso.slice(0, 4))) {
        // The day is real but the document's year disagrees. Do not pick a winner: the
        // stated year may be a leftover from last year's syllabus, or the model may have
        // "corrected" a year that was right. Surface it and let the student decide.
        issues.push("DATE_YEAR_MISMATCH");
        derivedQuestions.push({
          question: `Is "${assignment.title}" due in ${date.iso.slice(0, 4)} or ${statedYear}?`,
          why: `The syllabus writes this date with the year ${statedYear}, which does not match the rest of the term. It may be left over from a previous version.`,
          relatesToTitle: assignment.title,
          kind: "conflicting_information",
        });
      } else if (isOutsideTerm(date.iso, context)) {
        issues.push("DATE_OUTSIDE_TERM");
        warnings.push(
          `"${assignment.title}" is dated ${date.iso}, which falls outside the term. It may be from a prior year.`,
        );
      }
    }

    if (date.iso !== null) {
      // Absent time is normal and correct, but the planner should know it is assuming.
      if (date.time === null) issues.push("TIME_NOT_STATED");
    } else {
      // INVARIANT: an item with no resolved date always raises an issue and is always
      // "unknown". Reaching this branch silently is the exact failure this product is
      // built to prevent — an unschedulable item that looks like part of a plan. Real
      // model output showed a whole course arriving here labelled "conflicting" and
      // sailing through with no issue at all, so the check is on iso itself rather than
      // on the ambiguity the model happened to report.
      switch (date.ambiguity) {
        case "relative_week":
        case "relative_event":
          issues.push("AMBIGUOUS_DATE");
          derivedQuestions.push({
            question: `"${assignment.title}" is listed as ${date.raw ?? "a relative date"}. What calendar date is that?`,
            why: "Relative dates cannot be scheduled until they are tied to the term calendar.",
            relatesToTitle: assignment.title,
            kind: "relative_date",
          });
          break;

        case "conflicting":
          issues.push("AMBIGUOUS_DATE");
          derivedQuestions.push({
            question: `What date should "${assignment.title}" use?`,
            why: `The syllabus is inconsistent about this one: ${truncate(date.raw ?? "no date given", 160)}`,
            relatesToTitle: assignment.title,
            kind: "conflicting_information",
          });
          break;

        case "no_year":
          issues.push("AMBIGUOUS_DATE");
          derivedQuestions.push({
            question: `"${assignment.title}" is listed as ${date.raw ?? "a date"} with no year. Which year is it?`,
            why: "Without a year this cannot be placed in the term.",
            relatesToTitle: assignment.title,
            kind: "relative_date",
          });
          break;

        case "missing":
        case "none":
          if (date.raw !== null) {
            // The model read a date but did not resolve it to a calendar date.
            issues.push("AMBIGUOUS_DATE");
            derivedQuestions.push({
              question: `"${assignment.title}" is listed as ${truncate(date.raw, 80)}. What date should it use?`,
              why: "The syllabus gives this date in a form that could not be resolved automatically.",
              relatesToTitle: assignment.title,
              kind: "relative_date",
            });
          } else {
            issues.push("MISSING_DATE");
          }
          break;
      }
    }

    if (assignment.category && !knownCategories.has(assignment.category.trim().toLowerCase())) {
      issues.push("UNKNOWN_CATEGORY");
    }

    if (assignment.confidence < 0.5) issues.push("LOW_MODEL_CONFIDENCE");

    // --- Duplicate vs contradiction.
    // Same title AND same date is one assignment reported twice. Same title with a
    // DIFFERENT date is something else entirely: the syllabus contradicts itself, which
    // happens for real when a schedule table and the grading section disagree. Collapsing
    // those two cases would hide the more important one.
    const title = normalizeTitle(assignment.title);
    const dateKey = assignment.dueDate.iso ?? assignment.dueDate.raw ?? "nodate";
    const priorMatch = seen.find((s) => s.title === title);

    if (priorMatch && priorMatch.dateKey === dateKey) {
      issues.push("DUPLICATE_OF_EARLIER_CLAIM");
    } else if (priorMatch) {
      issues.push("CONFLICTING_DATE_FOR_SAME_ITEM");
      derivedQuestions.push({
        question: `"${assignment.title}" is listed with two different dates. Which one is right?`,
        why: `The syllabus gives both ${priorMatch.dateKey} and ${dateKey} for this.`,
        relatesToTitle: assignment.title,
        kind: "conflicting_information",
      });
    } else {
      seen.push({ title, dateKey, original: assignment.title });
    }

    validated.push({
      assignment,
      confidenceStatus: confidenceFor(assignment, issues, verified),
      issues,
      duplicateOf: priorMatch?.original ?? null,
      evidenceVerified: verified,
    });
  }

  // --- Grading weights should describe a whole course.
  /**
   * "The weights do not add up" is three different faults with three different costs, and
   * lumping them together said the least useful thing about each.
   *
   * The one that mattered most was silent. A category with no weight was *filtered out* before
   * summing, so a syllabus with "Exams 50%, Papers 50%, Participation" — no number on
   * participation — totalled 100 and passed without a word. The student is then told nothing
   * at the one moment they are looking at the syllabus and could still fix it, and finds out
   * later from the dashboard, because `course-health.ts` does check for missing weights. Two
   * layers disagreeing, and the earlier one was the weaker.
   *
   * Under and over are also not the same thing. Short of 100 means a category is *missing*, and
   * a missing category means work the student may never be shown. Over 100 means something is
   * counted twice, or there is extra credit — which genuinely can exceed 100 and is not a
   * fault at all. Saying "may be missing or misread" to both was accurate about neither.
   */
  /**
   * A scheme weighted in points is a complete scheme, and reading it as "no weights" was a
   * false alarm on a document that states everything.
   *
   * Washburn's family law syllabus, verbatim: "Class Participation: Maximum of 20 points;
   * Midterm / Project: Maximum of 40 points; Final Examination: Maximum of 40 points." That is
   * 20/40/40 of a hundred, stated as plainly as any percentage table — and it came back as
   * three nulls, so the student was told "No weight was found for Class Participation, Midterm
   * / Project, Final Examination. The rest add up to 0%".
   *
   * The share is computed here rather than by the model, for the reason all the arithmetic is:
   * dividing 20 by 100 is not a reading task. Only done when *every* category carries points
   * and none carries a percentage — a document mixing the two is stating its grade twice in
   * two units that need not agree, which is a contradiction to surface rather than average.
   */
  const pointsOnly =
    extraction.gradingCategories.length > 0 &&
    extraction.gradingCategories.every((c) => c.weightPercent === null && (c.pointsPossible ?? 0) > 0);

  if (pointsOnly) {
    const totalPoints = extraction.gradingCategories.reduce((sum, c) => sum + (c.pointsPossible ?? 0), 0);
    for (const category of extraction.gradingCategories) {
      category.weightPercent = round(((category.pointsPossible ?? 0) / totalPoints) * 100);
    }
    warnings.push(
      `This course is graded out of ${round(totalPoints)} points rather than percentages. ` +
        `The weights below are that share: ` +
        extraction.gradingCategories.map((c) => `${c.name} ${c.weightPercent}%`).join(", ") +
        `.`,
    );
  }

  const unweighted = extraction.gradingCategories.filter((c) => c.weightPercent === null);
  const stated = extraction.gradingCategories
    .map((c) => c.weightPercent)
    .filter((w): w is number => w !== null);
  const total = stated.reduce((sum, w) => sum + w, 0);
  // A point of slack, so three categories of 33.3% are not reported as a defect.
  const TOLERANCE = 1;

  if (unweighted.length > 0) {
    const names = unweighted.map((c) => c.name).join(", ");
    warnings.push(
      `No weight was found for ${names}. The rest add up to ${round(total)}%, so what ` +
        `${unweighted.length === 1 ? "it is" : "they are"} worth is unknown.`,
    );
    derivedQuestions.push({
      question: `What ${unweighted.length === 1 ? "is" : "are"} ${names} worth?`,
      why: "Without it, this course's standing cannot be worked out and its work cannot be ranked against your other courses.",
      relatesToTitle: null,
      kind: "conflicting_information",
    });
  } else if (stated.length > 0 && total < 100 - TOLERANCE) {
    warnings.push(
      `The grading categories add up to ${round(total)}%, not 100%. ` +
        `${round(100 - total)}% of the grade is unaccounted for — a category may be missing entirely.`,
    );
    derivedQuestions.push({
      question: `What makes up the other ${round(100 - total)}% of your grade in this course?`,
      why: "A category the syllabus does not list is work you would never be shown.",
      relatesToTitle: null,
      kind: "conflicting_information",
    });
  } else if (stated.length > 0 && total > 100 + TOLERANCE) {
    warnings.push(
      `The grading categories add up to ${round(total)}%, more than 100%. ` +
        `Something may be counted twice, or one of these may be extra credit.`,
    );
    derivedQuestions.push({
      question: "Is one of these grading categories extra credit, or counted twice?",
      why: `They total ${round(total)}%. Extra credit is fine and worth marking; a double count would skew every estimate.`,
      relatesToTitle: null,
      kind: "conflicting_information",
    });
  }

  if (extraction.meetingPatterns.length === 0) {
    derivedQuestions.push({
      question: "What days and times does this class meet?",
      why: "Class meetings are fixed commitments, and the plan schedules work around them.",
      relatesToTitle: null,
      kind: "meeting_times",
    });
  }

  return {
    assignments: validated,
    rejected,
    gradingCategories: extraction.gradingCategories,
    meetingPatterns: extraction.meetingPatterns,
    courseFacts: extraction.courseFacts,
    policies: extraction.policies,
    clarificationQuestions: groupQuestions(
      dedupeQuestions([...extraction.clarificationQuestions, ...derivedQuestions]),
    ),
    warnings,
  };
}

/** Below this, listing each question separately is still readable. */
const GROUP_THRESHOLD = 3;

/**
 * Collapses repeated per-assignment questions into one.
 *
 * A syllabus that lists thirteen weekly quizzes by week number rather than by date
 * legitimately raises thirteen unanswerable dates — but presenting that as thirteen
 * questions is exactly the overwhelm this product exists to prevent. One question,
 * answered once, resolves the set (docs/02-prd.md FR-4).
 */
function groupQuestions(questions: ClarificationQuestion[]): ClarificationQuestion[] {
  const byKind = new Map<string, ClarificationQuestion[]>();
  for (const question of questions) {
    const list = byKind.get(question.kind);
    if (list) list.push(question);
    else byKind.set(question.kind, [question]);
  }

  const result: ClarificationQuestion[] = [];
  for (const [kind, group] of byKind) {
    const perItem = group.filter((q) => q.relatesToTitle !== null);
    if (perItem.length < GROUP_THRESHOLD) {
      result.push(...group);
      continue;
    }

    const titles = perItem.map((q) => q.relatesToTitle!);
    const shown = titles.slice(0, 3).join(", ");
    const rest = titles.length - 3;

    result.push({
      question: groupedQuestionText(kind, titles.length),
      why: `${titles.length} items need this: ${shown}${rest > 0 ? `, and ${rest} more` : ""}.`,
      relatesToTitle: null,
      relatesToTitles: titles,
      kind: kind as ClarificationQuestion["kind"],
    });
    // Questions in this group that were not about a specific item still stand alone.
    result.push(...group.filter((q) => q.relatesToTitle === null));
  }

  return result;
}

function groupedQuestionText(kind: string, count: number): string {
  switch (kind) {
    case "relative_date":
      return `${count} items are listed by week rather than a specific date. What day of the week are they due?`;
    case "missing_date":
      return `${count} items have no confirmable due date. Do you know when they are due?`;
    case "conflicting_information":
      return `${count} items have dates that contradict the rest of the syllabus. Which is right?`;
    default:
      return `${count} items need the same detail confirmed.`;
  }
}

function isOutsideTerm(iso: string, context: ValidationContext): boolean {
  if (!context.termStartDate || !context.termEndDate) return false;
  return !isWithinTerm(iso, context.termStartDate, context.termEndDate);
}

/**
 * Maps validation outcome onto the planning engine's confidence states. Nothing extracted
 * is ever "confirmed" — only a human confirming it in review earns that.
 */
function confidenceFor(
  assignment: ExtractedAssignment,
  issues: ClaimIssue[],
  evidenceVerified: boolean,
): ConfidenceStatus {
  // No resolved date means unknown, full stop — regardless of how sure the model sounded.
  if (assignment.dueDate.iso === null) return "unknown";
  if (issues.includes("MISSING_DATE") || issues.includes("AMBIGUOUS_DATE")) return "unknown";
  if (!evidenceVerified || issues.includes("DATE_NOT_IN_SOURCE")) return "low_inference";

  // A date the document itself casts doubt on is not something to plan confidently
  // against, however plainly it was printed. Real output produced a topic-approval
  // deadline dated 2023 in a 2026 term, quoted accurately — the model was right about
  // what it read, and the date is still not trustworthy.
  const disputed: ClaimIssue[] = [
    "DATE_OUTSIDE_TERM",
    "DATE_YEAR_MISMATCH",
    "CONFLICTING_DATE_FOR_SAME_ITEM",
  ];
  if (disputed.some((issue) => issues.includes(issue))) return "low_inference";

  if (assignment.confidence < 0.5) return "low_inference";
  return "high_inference";
}

/** Collapses title noise so "Quiz 2", "Quiz #2", and "QUIZ 2" are recognized as one item. */
function normalizeTitle(title: string): string {
  return normalize(title)
    .replace(/[#:]/g, "")
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Models sometimes stuff a whole explanation into a data field; keep questions readable. */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function dedupeQuestions(questions: ClarificationQuestion[]): ClarificationQuestion[] {
  const seen = new Set<string>();
  return questions.filter((q) => {
    const key = normalize(q.question);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Turns a validated date into the ISO instant the domain stores, or null if unresolved. */
export function toDueAt(date: ExtractedDate): string | null {
  if (date.iso === null) return null;
  // No stated time means end of day is an assumption, not a fact — but a date-only
  // deadline still has to land somewhere, so it lands at the end of that day and the
  // TIME_NOT_STATED issue tells the student it was assumed.
  return `${date.iso}T${date.time ?? "23:59"}:00.000Z`;
}

/** Weights are often written 33.3; a whole number reads better in a sentence. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
