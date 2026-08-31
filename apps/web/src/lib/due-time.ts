/**
 * The clock half of a due date.
 *
 * Everything that could set a due date wrote `T23:59:00.000Z` and nothing could change it, so a
 * quiz that closes at 9am and a paper accepted until midnight were the same date to the planner:
 * the whole day before a 9am deadline was offered as time to work in, which is a plan that is
 * wrong in the one direction that costs a grade. The scheduler already reasons in instants
 * (`toEpochMinutes(item.dueAt)`), so a real time of day flows straight through it -- the only
 * thing missing was a way to say one.
 *
 * **These are UTC wall-clock characters, not local time.** Every other view formats a due date
 * from `dueAt.slice(0, 10)` on purpose, so that a date does not slide a day for a student in
 * Tokyo, and a time read in local zone would contradict the date printed beside it -- "due Oct 5,
 * 8:59am" on a row whose instant is Oct 6. Splitting and rejoining the same characters keeps the
 * two halves telling one story. `packages/domain/src/time.ts` states the same rule for the engine.
 */

/** What "due Friday" has always meant here, and what extraction writes when a syllabus is silent. */
export const DEFAULT_DUE_TIME = "23:59";

/** The date half of a stored instant, or "" when the work has no due date. */
export function dueDatePart(dueAt: string | null | undefined): string {
  return dueAt ? dueAt.slice(0, 10) : "";
}

/**
 * The "HH:MM" half of a stored instant.
 *
 * Falls back to the end-of-day default rather than to "", because a time input showing nothing
 * reads as "no deadline time known" when in fact the item has always had one -- and an empty
 * input that then saves as 23:59 anyway is worse.
 */
export function dueTimePart(dueAt: string | null | undefined): string {
  const time = dueAt ? dueAt.slice(11, 16) : "";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : DEFAULT_DUE_TIME;
}

/**
 * Joins a calendar day and a time of day back into the instant the API stores.
 *
 * No date means no deadline, whatever the time box says: a time alone is not a due date, and
 * writing one would put the assignment on the first of January.
 */
export function composeDueAt(date: string, time: string): string | null {
  if (!date) return null;
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : DEFAULT_DUE_TIME;
  return `${date}T${clock}:00.000Z`;
}

/** True when the item is due at the end of its day, i.e. nobody has said otherwise. */
export function isDefaultDueTime(dueAt: string | null | undefined): boolean {
  return dueTimePart(dueAt) === DEFAULT_DUE_TIME;
}

/**
 * A due date as a short day, from the stored calendar day rather than the instant.
 *
 * Review found the views this was missing from. `new Date(dueAt).toLocaleDateString(...)` renders
 * in the browser's zone, so the printed day slides off the ten characters every other view shows:
 * a deadline stored at 01:00 reads as the day before in Los Angeles, and one at 23:59 as the day
 * after in Tokyo -- while the assignments table, formatting from `slice(0, 10)`, shows the day the
 * student typed. One assignment, two dates, on two screens of the same app.
 *
 * Being able to set a time is what exposed it: while every deadline sat at 23:59Z the western
 * half of the world happened to round the right way. Noon anchors the formatting far enough from
 * both midnights that no zone can shift it.
 */
export function formatDueDay(
  dueAt: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  return new Date(`${dueDatePart(dueAt)}T12:00:00Z`).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}
