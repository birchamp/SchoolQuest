export type ClaimType =
  | "assignment"
  | "grading_category"
  | "meeting_pattern"
  | "course_fact"
  | "policy"
  | "clarification_question";

export interface ExtractedDateView {
  iso: string | null;
  raw: string | null;
  time: string | null;
  ambiguity: string;
}

export interface AssignmentPayload {
  title: string;
  type: string;
  dueDate: ExtractedDateView;
  pointsPossible: number | null;
  category: string | null;
  isMajorProject: boolean;
  issues: string[];
  duplicateOf: string | null;
  confidenceStatus: string;
  evidenceVerified: boolean;
}

export interface QuestionPayload {
  question: string;
  why: string;
  relatesToTitle: string | null;
  kind: string;
  /** Set once the student answers, including the explicit "I don't know yet". */
  answer?: string | null;
}

export interface ClaimView {
  id: string;
  claimType: ClaimType;
  payload: Record<string, unknown>;
  pageNumber: number | null;
  sourceExcerpt: string | null;
  confidence: number | null;
  reviewStatus: string;
}

export interface ExtractionResponse {
  documentId: string;
  pagesProcessed: number;
  model: string;
  counts: { assignments: number; rejected: number; questions: number };
  rejected: { title: string; reason: string }[];
  warnings: string[];
  claims: ClaimView[];
}

/**
 * Plain-language explanations of the validator's issue codes.
 *
 * These are what make the review screen trustworthy rather than a wall of AI output: each
 * one says what the machine could not establish, so the student knows exactly what they
 * are being asked to check.
 */
export const ISSUE_TEXT: Record<string, string> = {
  EVIDENCE_NOT_FOUND: "The quoted text could not be matched exactly in the document.",
  EVIDENCE_PAGE_MISSING: "The cited page does not exist in this document.",
  DATE_NOT_IN_SOURCE: "No date was found in the source text, so the suggested date was removed.",
  DATE_OUTSIDE_TERM: "This date falls outside your term. It may be from a previous year.",
  WEEK_NUMBER_AMBIGUOUS:
    "This is listed by week number, after a break. Syllabi disagree about whether break weeks are counted, so this could be a week either side — worth checking against your syllabus's own table.",
  DATE_IN_BREAK: "This lands inside a break, when there is no class.",
  DATE_SET_BY_REGISTRAR:
    "The syllabus gives finals week, not a day — the registrar sets that later. This is planned from the first day of that week, the earliest it could be.",
  TIME_NOT_STATED: "No time of day was given. End of day is assumed.",
  AMBIGUOUS_DATE: "The date is relative or incomplete and needs confirming.",
  MISSING_DATE: "No due date was given anywhere in the document.",
  DATE_YEAR_MISMATCH:
    "The syllabus writes this date with a different year — often left over from an earlier version. Worth confirming.",
  DUPLICATE_OF_EARLIER_CLAIM: "This looks like the same item as an earlier one.",
  CONFLICTING_DATE_FOR_SAME_ITEM:
    "The syllabus gives this item two different dates. Pick the one you want to plan against.",
  CATEGORY_WEIGHTS_DO_NOT_SUM: "The grading weights do not add up to 100%.",
  UNKNOWN_CATEGORY: "This grading category was not found elsewhere in the syllabus.",
  LOW_MODEL_CONFIDENCE: "This one was read with low confidence — worth a careful look.",
};

export const REJECTION_TEXT: Record<string, string> = {
  EVIDENCE_NOT_FOUND:
    "Discarded: the supporting quote was not in the document, so this may have been invented.",
  EVIDENCE_PAGE_MISSING: "Discarded: it cited a page that does not exist.",
};
