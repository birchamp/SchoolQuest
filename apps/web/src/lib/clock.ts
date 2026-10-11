import {
  formatTimeOfDay,
  fromEpochMinutes,
  parseTimeOfDay,
  toEpochMinutes,
  zoneCalendar,
  type ZoneCalendar,
} from "@schoolquest/domain";

/**
 * Time on screen: the one place the app leaves UTC.
 *
 * Every time the app holds is a UTC instant (the rule is at the top of
 * `packages/domain/src/time.ts`). The student sees and types times in their own zone, and every
 * conversion either way happens here, so no screen can disagree with another about what day it
 * is or what time something is due. Screens never format a stored time themselves, never take a
 * day off one with `.slice(0, 10)`, and never compare one with the raw clock: they call these.
 *
 * The zone is the student's plan zone -- the device's, unless they pinned another
 * (`setPlanTimeZone`). A student visiting home three zones away with their zone pinned sees their
 * school's clock, not the one outside the window.
 */
let planZone: string | null = null;

/** Sets the zone the student's times are shown in, from their settings. */
export function setPlanTimeZone(timeZone: string | null): void {
  planZone = timeZone;
}

/** The zone times are shown in. */
export function planTimeZone(): string {
  return planZone ?? browserTimeZone() ?? "UTC";
}

function calendar(): ZoneCalendar {
  return zoneCalendar(planTimeZone());
}

/** The browser's IANA time zone, or null where the platform will not say. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * A moment to read the term from, other than now. A UTC instant, like every other.
 *
 * **Development only, twice over**: the server ignores it outright once a mail provider is
 * configured, so a stray key in a real browser changes nothing it sends back. It exists so the
 * screenshot and simulation tools can look at a term from week nine.
 */
export function devNow(): string | null {
  try {
    return localStorage.getItem("sq_dev_now");
  } catch {
    return null;
  }
}

/** Now, as a UTC instant: the simulated moment in development, otherwise the real one. */
export function appNow(): string {
  return devNow() ?? new Date().toISOString();
}

/** The student's date today, "YYYY-MM-DD". */
export function appToday(): string {
  return localDate(appNow());
}

/** The student's date for an instant, "YYYY-MM-DD". */
export function localDate(iso: string): string {
  return calendar().dateOf(toEpochMinutes(iso));
}

/** The student's time of day for an instant, "HH:MM". */
export function localTime(iso: string): string {
  return formatTimeOfDay(calendar().minuteOfDay(toEpochMinutes(iso)));
}

/** Minutes since the student's midnight for an instant. */
export function localMinuteOfDay(iso: string): number {
  return calendar().minuteOfDay(toEpochMinutes(iso));
}

/** The student's weekday for an instant, 0 = Sunday. */
export function localDayOfWeek(iso: string): number {
  return calendar().dayOfWeek(toEpochMinutes(iso));
}

/** The UTC instant of a local date and "HH:MM", as the student means them. */
export function fromLocal(date: string, time: string): string {
  return fromEpochMinutes(calendar().at(date, parseTimeOfDay(time)));
}

/** The UTC instant the student's day begins. */
export function localDayStart(date: string): string {
  return fromEpochMinutes(calendar().dayStart(date));
}

/** A stored instant, formatted in the student's zone. */
export function formatInstant(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString(undefined, { ...options, timeZone: planTimeZone() });
}

/** "9:00 AM": a stored instant's time of day, on the student's clock. */
export function formatTime(iso: string): string {
  return formatInstant(iso, { hour: "numeric", minute: "2-digit" });
}

/**
 * A calendar date, which has no zone: "Oct 5" for "2026-10-05".
 *
 * Formatted at noon UTC with the zone pinned to UTC, so the day printed is the day given, in
 * every browser. Only for dates; a stored instant goes through `formatInstant`.
 */
export function formatCalendarDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

/** A time of day, which has no zone: "5:00 PM" for "17:00". */
export function formatClock(
  time: string,
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" },
): string {
  const minutes = parseTimeOfDay(time);
  return new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)).toLocaleTimeString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

/**
 * Whether the saved plan has to be rebuilt before it is shown.
 *
 * A plan is written once and was then read back unchanged for as long as nobody pressed a button.
 * Nothing replanned on its own, so the week a plan was made for ended and the app went on showing
 * it: nothing to do on Today, nothing booked for the work now coming due, and no sign that anything
 * was wrong. That is the report this exists for -- "it isn't scheduling time for the assignments
 * that are coming due" -- and `tools/e2e/scheduling.mjs` walks it.
 *
 * Rebuilt once a day rather than only when the week runs out. Yesterday's plan still has blocks
 * that were never done -- missed, not skipped, because nobody said -- and replanning is the only
 * thing that gives that work its time back. Blocks the student locked or accepted survive a replan,
 * so this moves nothing they committed to.
 *
 * `today` is the student's date; the plan's own creation day is read in the same zone.
 */
export function planIsStale(
  planVersion: { horizonEnd: string; createdAt?: string },
  today: string,
): boolean {
  if (planVersion.horizonEnd <= today) return true;
  return planVersion.createdAt !== undefined && localDate(planVersion.createdAt) < today;
}
