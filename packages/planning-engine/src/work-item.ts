import {
  calendarDaysBetween,
  MINUTES_PER_DAY,
  toEpochMinutes,
  type WorkItem,
  type ZoneCalendar,
} from "@schoolquest/domain";

/**
 * The three questions every view asks about a work item -- how big is it, is it still open,
 * and how far away is it -- answered once.
 *
 * Each of these used to be re-derived per module, and the copies drifted: effort was computed
 * six ways (one fell back to 0, one to a flat hour, one read the estimate before the remaining
 * figure), "open" had eight definitions, and "days until due" was calendar days on the radar
 * but a floor of raw minutes on the terrain, the course table and the project rows. The same
 * paper could be "1 day" on one screen and "0 days" on the next, and "needs time" on one and
 * invisible on another. Where a module genuinely needs a different answer it uses a named
 * variant from here, so the difference is a decision rather than an accident.
 */

/** Fallback effort by work type, used only when the student has given us nothing better. */
export const DEFAULT_EFFORT_MINUTES: Readonly<Record<string, number>> = {
  reading: 60,
  quiz: 30,
  quiz_prep: 45,
  problem_set: 90,
  paper: 240,
  presentation: 180,
  group_project: 180,
  exam: 60,
  exam_prep: 120,
  lab: 120,
  discussion: 30,
  milestone: 45,
  other: 60,
};

/** For a work type the table does not know. */
export const FALLBACK_EFFORT_MINUTES = 60;

/** The assumed effort for a work type when nobody has said. */
export function defaultEffortFor(workType: string): number {
  return DEFAULT_EFFORT_MINUTES[workType] ?? FALLBACK_EFFORT_MINUTES;
}

/**
 * Effort still owed that somebody actually stated, or null when nobody did.
 *
 * `remainingMinutes` is what is still owed and is set from `estimatedMinutes` at creation, so
 * either one being present means a real number was put on this.
 */
export function givenRemainingMinutes(item: WorkItem): number | null {
  return item.remainingMinutes ?? item.estimatedMinutes;
}

/**
 * Effort still owed on an item, from the best source available (docs/04 §9): remaining, then
 * the estimate, then the type default. This is what the scheduler books, so every view that
 * compares booked time against need must use it or it will disagree with the plan.
 */
export function remainingEffortMinutes(item: WorkItem): number {
  return givenRemainingMinutes(item) ?? defaultEffortFor(item.workType);
}

/**
 * Total effort for an item -- the size of the whole job, not what is left of it.
 *
 * The estimate comes *first* here, the opposite order from `remainingEffortMinutes`, on
 * purpose: completion is measured as `(total - remaining) / total`, and reading remaining as
 * the total would report every half-done project as not started. A positive remaining figure
 * stands in only when there is no estimate; a remaining of 0 says the work is done, not that
 * it was small, so it falls through to the default rather than sizing the job at nothing.
 */
export function totalEffort(item: WorkItem): { minutes: number; assumed: boolean } {
  if (item.estimatedMinutes !== null) return { minutes: item.estimatedMinutes, assumed: false };
  if (item.remainingMinutes !== null && item.remainingMinutes > 0) {
    return { minutes: item.remainingMinutes, assumed: false };
  }
  return { minutes: defaultEffortFor(item.workType), assumed: true };
}

type HasStatus = Pick<WorkItem, "status">;

/** Handed in or done. Submitted counts: the student's part is over either way. */
export function isFinished(item: HasStatus): boolean {
  return item.status === "completed" || item.status === "submitted";
}

/**
 * Not finished and not abandoned -- including optional work, which the student may still
 * choose to do. For actions the student takes on an item (asking about it, breaking it into
 * stages), not for anything that measures what is owed.
 */
export function isUnfinished(item: HasStatus): boolean {
  return !isFinished(item) && item.status !== "canceled";
}

/**
 * Still owed: unfinished, and not optional. The default meaning of "open" -- what the
 * scheduler plans, what the radar draws, and what every count of outstanding work counts.
 */
export function isOpen(item: HasStatus): boolean {
  return isUnfinished(item) && item.status !== "optional";
}

/**
 * Owed or already done: everything except cancelled and optional work. For views that draw
 * finished work alongside open work so progress stays visible.
 */
export function isOpenOrFinished(item: HasStatus): boolean {
  return isOpen(item) || isFinished(item);
}

/**
 * Whole calendar days, in the student's zone, from `now` to the date `dueAt` falls on. 0 is
 * today, negative is an earlier date. For labels and distances ("today", "in 3 days"), never
 * for deciding whether something is overdue -- that is `isPastDue`. The calendar is required on
 * purpose: the UTC date is the student's date only at UTC+0, and a default would let a module
 * forget to ask.
 */
export function daysUntil(dueAt: string, nowMinutes: number, calendar: ZoneCalendar): number {
  return calendarDaysBetween(calendar, nowMinutes, toEpochMinutes(dueAt));
}

/**
 * Whether the deadline has passed: an instant comparison, the one meaning of "overdue" every
 * view shares. A quiz that closed at 09:00 is past due at 15:00 the same day, even though
 * `daysUntil` still calls it today; waiting for midnight would offer the rest of the day as time
 * to work on something that can no longer be handed in.
 */
export function isPastDue(dueAt: string, nowMinutes: number): boolean {
  return toEpochMinutes(dueAt) < nowMinutes;
}

/** Never pace across less than an hour: past that, the honest answer is "all of it, now". */
const MIN_PACING_DAYS = 1 / 24;

/**
 * Fractional days left before the deadline, for pacing arithmetic (minutes per week and the
 * like). Elapsed time rather than calendar days: 23:00 to 09:00 tomorrow is ten hours, not a
 * day, and a midnight deadline is not a day further off than 23:59. Floored at an hour so a
 * deadline minutes away does not divide by nearly nothing. Past due is the caller's to handle
 * with `isPastDue`.
 */
export function daysLeftForPacing(dueAt: string, nowMinutes: number): number {
  return Math.max(MIN_PACING_DAYS, (toEpochMinutes(dueAt) - nowMinutes) / MINUTES_PER_DAY);
}
