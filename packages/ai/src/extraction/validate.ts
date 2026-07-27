import type { ConfidenceStatus } from "@schoolquest/domain";
import type { DocumentPage } from "./prompt.js";
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
  | "DATE_OUTSIDE_TERM"
  | "TIME_NOT_STATED"
  | "AMBIGUOUS_DATE"
  | "MISSING_DATE"
  | "DUPLICATE_OF_EARLIER_CLAIM"
  | "CATEGORY_WEIGHTS_DO_NOT_SUM"
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
 * Confirms the model quoted something that is really there.
 *
 * Exact substring match after normalization is the primary test. PDF text extraction can
 * drop or reorder the odd character, so a near-miss falls back to token overlap rather
 * than failing a legitimate claim outright.
 */
export function verifyEvidence(
  excerpt: string,
  pageText: string,
): { verified: boolean; partial: boolean } {
  const needle = normalize(excerpt);
  const haystack = normalize(pageText);
  if (needle.length === 0) return { verified: false, partial: false };
  if (haystack.includes(needle)) return { verified: true, partial: false };

  // Fall back to token overlap: most of the quoted words should appear on the page.
  const tokens = needle.split(" ").filter((t) => t.length > 2);
  if (tokens.length === 0) return { verified: false, partial: false };
  const present = tokens.filter((t) => haystack.includes(t)).length;
  const ratio = present / tokens.length;

  // 0.8 tolerates extraction noise while still rejecting an invented sentence, whose
  // content words will not be on the page at all.
  return { verified: false, partial: ratio >= 0.8 };
}

/**
 * Checks that an ISO date the model reported could plausibly have been read, rather than
 * computed. If the model claims 2026-10-18, some recognizable form of that date should
 * appear in the source text.
 */
export function dateAppearsInSource(iso: string, pageText: string): boolean {
  const haystack = normalize(pageText);
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];

  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const monthName = monthNames[month - 1]!;
  const shortMonth = monthName.slice(0, 3);

  const candidates = [
    iso,
    `${month}/${day}`,
    `${month}/${day}/${year}`,
    `${month}/${day}/${String(year).slice(2)}`,
    `${month}-${day}`,
    `${monthName} ${day}`,
    `${shortMonth} ${day}`,
    `${shortMonth}. ${day}`,
    `${day} ${monthName}`,
    `${day} ${shortMonth}`,
  ];

  return candidates.some((c) => haystack.includes(normalize(c)));
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
  const seen: { key: string; title: string }[] = [];

  const knownCategories = new Set(
    extraction.gradingCategories.map((c) => c.name.trim().toLowerCase()),
  );

  for (const assignment of extraction.assignments) {
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
    if (date.iso !== null) {
      if (!dateAppearsInSource(date.iso, text)) {
        // The date was computed, not read. Strip it rather than schedule against it.
        issues.push("DATE_NOT_IN_SOURCE");
        date.iso = null;
        derivedQuestions.push({
          question: `When is "${assignment.title}" actually due?`,
          why: "The syllabus mentions it, but the date could not be confirmed from the document text.",
          relatesToTitle: assignment.title,
          kind: "missing_date",
        });
      } else if (isOutsideTerm(date.iso, context)) {
        issues.push("DATE_OUTSIDE_TERM");
        warnings.push(
          `"${assignment.title}" is dated ${date.iso}, which falls outside the term. It may be from a prior year.`,
        );
      }
    }

    if (date.ambiguity === "relative_week" || date.ambiguity === "relative_event") {
      issues.push("AMBIGUOUS_DATE");
      derivedQuestions.push({
        question: `"${assignment.title}" is listed as ${date.raw ?? "a relative date"}. What calendar date is that?`,
        why: "Relative dates cannot be scheduled until they are tied to the term calendar.",
        relatesToTitle: assignment.title,
        kind: "relative_date",
      });
    } else if (date.ambiguity === "no_year") {
      issues.push("AMBIGUOUS_DATE");
    } else if (date.ambiguity === "missing" || (date.iso === null && date.raw === null)) {
      issues.push("MISSING_DATE");
    }

    // Absent time is normal and correct, but the planner should know it is assuming.
    if (date.iso !== null && date.time === null) issues.push("TIME_NOT_STATED");

    if (assignment.category && !knownCategories.has(assignment.category.trim().toLowerCase())) {
      issues.push("UNKNOWN_CATEGORY");
    }

    if (assignment.confidence < 0.5) issues.push("LOW_MODEL_CONFIDENCE");

    // --- Duplicate detection. Same-ish title on the same date is one assignment.
    const key = duplicateKey(assignment);
    const priorMatch = seen.find((s) => s.key === key);
    if (priorMatch) issues.push("DUPLICATE_OF_EARLIER_CLAIM");
    else seen.push({ key, title: assignment.title });

    validated.push({
      assignment,
      confidenceStatus: confidenceFor(assignment, issues, verified),
      issues,
      duplicateOf: priorMatch?.title ?? null,
      evidenceVerified: verified,
    });
  }

  // --- Grading weights should describe a whole course.
  const weights = extraction.gradingCategories
    .map((c) => c.weightPercent)
    .filter((w): w is number => w !== null);
  if (weights.length > 0) {
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (Math.abs(total - 100) > 1) {
      warnings.push(
        `The grading categories add up to ${total}%, not 100%. Some weights may be missing or misread.`,
      );
      derivedQuestions.push({
        question: "Do these grading categories and weights look right?",
        why: `They currently total ${total}%, so course-standing estimates would be off.`,
        relatesToTitle: null,
        kind: "conflicting_information",
      });
    }
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
    clarificationQuestions: dedupeQuestions([
      ...extraction.clarificationQuestions,
      ...derivedQuestions,
    ]),
    warnings,
  };
}

function isOutsideTerm(iso: string, context: ValidationContext): boolean {
  if (!context.termStartDate || !context.termEndDate) return false;
  return iso < context.termStartDate || iso > context.termEndDate;
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
  if (issues.includes("MISSING_DATE") || issues.includes("AMBIGUOUS_DATE")) return "unknown";
  if (!evidenceVerified || issues.includes("DATE_NOT_IN_SOURCE")) return "low_inference";
  if (assignment.confidence < 0.5) return "low_inference";
  if (assignment.confidence < 0.85 || issues.length > 0) return "high_inference";
  return "high_inference";
}

/** Normalized title plus date: the same paper listed twice collapses to one key. */
function duplicateKey(assignment: ExtractedAssignment): string {
  const title = normalize(assignment.title)
    // Strip ordinal and numbering noise so "Quiz 2" and "Quiz #2" match.
    .replace(/[#:]/g, "")
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${title}|${assignment.dueDate.iso ?? assignment.dueDate.raw ?? "nodate"}`;
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
