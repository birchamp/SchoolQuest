/**
 * Reason codes are the contract between the scheduler and every explanation surface.
 *
 * The engine never emits prose. It emits these codes; @schoolquest/theme-language turns
 * them into Quest/Mission/Plain wording, and the AI coach may only paraphrase codes that
 * are actually present (docs/06-ai-system-spec.md §11 — explanation/reason-code consistency).
 */
export const REASON_CODES = [
  "DEADLINE_IMMINENT",
  "DEADLINE_BUFFER_AT_RISK",
  "PRESERVES_DEADLINE_BUFFER",
  "HIGH_ACADEMIC_VALUE",
  "UNLOCKS_MAJOR_PROJECT",
  "PREREQUISITE_FOR_LATER_WORK",
  "BEST_CONTEXT_WINDOW",
  "MATCHES_ENERGY_LEVEL",
  "LOCATION_MATCH",
  "SPACED_PRACTICE",
  "NEGLECTED_WORK",
  "USER_PRIORITIZED",
  "COURSE_NEEDS_ATTENTION",
  "UNCERTAIN_INPUT_CONSERVATIVE",
  "ONLY_REMAINING_WINDOW",
  "FITS_AVAILABLE_TIME",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export const TRADEOFF_CODES = [
  "READING_MOVED_TO_LOW_ENERGY_WINDOW",
  "LOWER_VALUE_WORK_DEFERRED",
  "SESSION_SHORTENED",
  "WORK_PUSHED_CLOSER_TO_DEADLINE",
  "DAILY_LIMIT_REACHED",
] as const;

export type TradeoffCode = (typeof TRADEOFF_CODES)[number];

export const RISK_CODES = [
  "INSUFFICIENT_CAPACITY",
  "PREREQUISITE_LATE",
  "NO_FEASIBLE_WINDOW",
  "DUE_DATE_UNCONFIRMED",
  "DUE_DATE_UNKNOWN",
  "EFFORT_UNKNOWN",
  "DAILY_LIMIT_EXCEEDED",
  "OVER_HORIZON",
  /** Long work being advanced steadily rather than crammed into one horizon. */
  "PACED_TO_DEADLINE",
  /**
   * Nothing was booked for this, on purpose: its deadline is past the end of the horizon and
   * its runway has not opened yet.
   *
   * Distinct from `NO_FEASIBLE_WINDOW`, which it used to be reported as. On the first Monday of
   * a real ingested term that meant 42 of 61 items were shown at `at_risk` saying "no available
   * window fits this before it is due" — and every single one of them was due weeks later, with
   * nothing wrong at all. This is the same fact told truthfully: not this week, and that is
   * fine.
   */
  "WAITING_ITS_TURN",
] as const;

export type RiskCode = (typeof RISK_CODES)[number];
