/**
 * The student's clock, in the form the app stores times.
 *
 * Every time in SchoolQuest is a wall-clock time written with a `Z` (`lib/due-time.ts` and
 * `packages/domain/src/time.ts` say why): a 9am class is `09:00Z` whoever is looking. "Now" has to
 * be read the same way or it does not line up with anything else. `new Date().toISOString()` is
 * the moment in Greenwich, which for a student in Chicago runs five or six hours ahead of their
 * own day -- so at 7pm their "today" was already tomorrow and the evening was already over.
 */
export function wallClockNow(at: Date = new Date()): string {
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString();
}

/** Today's date on the student's wall clock, "YYYY-MM-DD". */
export function wallClockToday(at: Date = new Date()): string {
  return wallClockNow(at).slice(0, 10);
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
 */
export function planIsStale(
  planVersion: { horizonEnd: string; createdAt?: string },
  today: string,
): boolean {
  if (planVersion.horizonEnd <= today) return true;
  return planVersion.createdAt !== undefined && planVersion.createdAt.slice(0, 10) < today;
}
