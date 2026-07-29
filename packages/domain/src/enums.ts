import { z } from "zod";

/**
 * Every enum in this file is theme-neutral on purpose. No value here may be a
 * Quest/Mission word — themed labels live in @schoolquest/theme-language and are
 * applied at render time only (see docs/01-product-brief.md principle 9).
 */

export const themeName = z.enum(["quest", "mission", "plain"]);
export type ThemeName = z.infer<typeof themeName>;

export const detailMode = z.enum(["reduced", "standard", "expanded"]);
export type DetailMode = z.infer<typeof detailMode>;

export const termStatus = z.enum(["planning", "active", "archived"]);
export type TermStatus = z.infer<typeof termStatus>;

export const workType = z.enum([
  "reading",
  "quiz",
  "quiz_prep",
  "problem_set",
  "paper",
  "presentation",
  "group_project",
  "exam",
  "exam_prep",
  "lab",
  "discussion",
  "milestone",
  "other",
]);
export type WorkType = z.infer<typeof workType>;

/**
 * Identity colours for courses, in assignment order.
 *
 * `colorToken` exists so a student can tell their courses apart at a glance, but nothing
 * ever assigned one — every course in the database carried the schema default, so every
 * course chip on screen came out the same colour and the field did no work at all. Courses
 * are now given the next token in this cycle as they are created.
 *
 * These are names, not values: each theme maps them to its own palette, so the Plain
 * theme's calm hues and the Quest theme's heraldic tinctures stay independent while both
 * agree on *which* course is which.
 */
export const COURSE_COLOR_TOKENS = [
  "azure",
  "vermilion",
  "verdant",
  "amber",
  "violet",
  "sable",
] as const;
export type CourseColorToken = (typeof COURSE_COLOR_TOKENS)[number];

/**
 * Deterministic fallback for a course that predates token assignment, or that was given
 * an unrecognised one. Keyed on the id so the colour is stable across reloads and across
 * screens — a course that is vermilion on the week map must not be azure on setup.
 */
export function colorTokenFor(courseId: string, storedToken?: string | null): CourseColorToken {
  if (storedToken && (COURSE_COLOR_TOKENS as readonly string[]).includes(storedToken)) {
    return storedToken as CourseColorToken;
  }
  let hash = 0;
  for (let i = 0; i < courseId.length; i += 1) hash = (hash * 31 + courseId.charCodeAt(i)) | 0;
  return COURSE_COLOR_TOKENS[Math.abs(hash) % COURSE_COLOR_TOKENS.length]!;
}

/** docs/05-data-model-and-api.md §3 */
export const workStatus = z.enum([
  "unconfirmed",
  "not_started",
  "in_progress",
  "blocked",
  "completed",
  "submitted",
  "canceled",
  "optional",
]);
export type WorkStatus = z.infer<typeof workStatus>;

export const sessionStatus = z.enum([
  "planned",
  "started",
  "completed",
  "partial",
  "missed",
  "skipped",
  /**
   * The block was never needed: its work item finished early, so the time is the
   * student's again. Distinct from "skipped", which is a choice not to do the work, and
   * from "missed", which is a judgement. Nothing about a released block is a failure.
   */
  "released",
  "moved",
]);
export type SessionStatus = z.infer<typeof sessionStatus>;

/**
 * "Unknown" is a first-class state. Nothing in the planning engine may coerce an
 * unknown into a fabricated default (docs/04-planning-engine-spec.md §14).
 */
export const confidenceStatus = z.enum([
  "confirmed",
  "high_inference",
  "low_inference",
  "unknown",
  "superseded",
]);
export type ConfidenceStatus = z.infer<typeof confidenceStatus>;

export const cognitiveDemand = z.enum(["low", "medium", "high"]);
export type CognitiveDemand = z.infer<typeof cognitiveDemand>;

export const energyLevel = z.enum(["low", "medium", "high"]);
export type EnergyLevel = z.infer<typeof energyLevel>;

/** How willing the scheduler is to move something. */
export const flexibility = z.enum(["fixed", "flexible", "optional"]);
export type Flexibility = z.infer<typeof flexibility>;

/** Hard rules constrain the scheduler absolutely; soft rules may be violated with an explanation. */
export const hardness = z.enum(["hard", "soft"]);
export type Hardness = z.infer<typeof hardness>;

export const divisibility = z.enum(["divisible", "contiguous", "atomic"]);
export type Divisibility = z.infer<typeof divisibility>;

export const commitmentType = z.enum([
  "class",
  "work",
  "commute",
  "meal",
  "sleep",
  "appointment",
  "club",
  "worship",
  "exercise",
  "other",
]);
export type CommitmentType = z.infer<typeof commitmentType>;

export const outcomeCode = z.enum([
  "completed",
  "partially_completed",
  "did_not_start",
  "took_less_time",
  "took_more_time",
  "blocked_missing_info",
  "needs_another_session",
]);
export type OutcomeCode = z.infer<typeof outcomeCode>;

/** docs/04-planning-engine-spec.md §16 — deliberately non-catastrophic wording. */
export const riskLevel = z.enum(["safe", "watch", "at_risk", "decision_needed"]);
export type RiskLevel = z.infer<typeof riskLevel>;

export const gradeConfirmation = z.enum(["confirmed", "extracted_unreviewed", "estimated"]);
export type GradeConfirmation = z.infer<typeof gradeConfirmation>;

export const dependencyType = z.enum(["finish_to_start", "informs", "same_session"]);
export type DependencyType = z.infer<typeof dependencyType>;

export const locationRequirement = z.enum(["anywhere", "desk", "library", "lab", "campus", "quiet"]);
export type LocationRequirement = z.infer<typeof locationRequirement>;
