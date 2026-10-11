import { formatInstant, fromLocal, localDate, localTime } from "./clock";

/**
 * The two halves of a due date, as the student edits them.
 *
 * A due date is stored as a UTC instant, like every time in the app. The editor shows it as a
 * date box and a time box in the student's zone, and joins them back the same way, so the round
 * trip -- open the row, touch nothing, save -- writes back exactly the instant that was there.
 * Everything goes through `lib/clock.ts`: a date read one way and written another is how a
 * deadline drifts a day for a student far from Greenwich (issue #4).
 */

/** What "due Friday" means when no time is given: the end of the student's Friday. */
export const DEFAULT_DUE_TIME = "23:59";

/** The student's date for a deadline, or "" when the work has no due date. */
export function dueDatePart(dueAt: string | null | undefined): string {
  return dueAt ? localDate(dueAt) : "";
}

/**
 * The student's time of day for a deadline, "HH:MM".
 *
 * Falls back to the end-of-day default rather than to "", because a time input showing nothing
 * reads as "no deadline time known" when in fact the item has always had one.
 */
export function dueTimePart(dueAt: string | null | undefined): string {
  return dueAt && !Number.isNaN(Date.parse(dueAt)) ? localTime(dueAt) : DEFAULT_DUE_TIME;
}

/**
 * Joins a local date and time of day into the UTC instant the API stores.
 *
 * No date means no deadline, whatever the time box says: a time alone is not a due date.
 */
export function composeDueAt(date: string, time: string): string | null {
  if (!date) return null;
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : DEFAULT_DUE_TIME;
  return fromLocal(date, clock);
}

/**
 * What a deadline becomes after the student edits the two boxes, or undefined when nothing
 * changed and nothing should be saved.
 *
 * Judged by what the boxes show, not by rejoining them: on the night the clocks go back the
 * boxes cannot tell the two 1:30s apart, so a deadline at the second one rejoined as the first,
 * and tabbing past the row moved it an hour earlier. Found in review.
 */
export function dueAfterEdit(
  stored: string | null | undefined,
  date: string,
  time: string,
): string | null | undefined {
  if (stored && date === dueDatePart(stored) && time === dueTimePart(stored)) return undefined;
  const next = composeDueAt(date, time);
  return next === (stored ?? null) ? undefined : next;
}

/** A deadline as a short day, on the student's calendar: "Oct 5". */
export function formatDueDay(
  dueAt: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  return formatInstant(dueAt, options);
}
