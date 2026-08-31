import { z } from "zod";

/**
 * One spelling for a stored instant.
 *
 * The work-item schemas accept `z.string().datetime({ offset: true })`, which is wider than the
 * app can hold: `2026-10-05T09:00:00-07:00` passes validation and is stored verbatim. Nothing in
 * the product writes one -- extraction and both editors emit `...Z` -- but review found what
 * happens if anything ever does. The assignments table reads a deadline back by slicing the
 * characters (`slice(0, 10)` for the day, 11-16 for the clock), so it shows `09:00`, and saving
 * writes `09:00Z`: focusing the field and tabbing out, touching nothing, moves the deadline seven
 * hours. An edit that changes data the student did not change is the one thing an editor may
 * never do.
 *
 * So the boundary narrows the type instead of trusting everyone who reaches it. An offset is
 * honoured as what it says -- an instant -- and rewritten in the one spelling everything
 * downstream reads. What the app then *displays* for such a value is UTC wall-clock, as it does
 * for every other time; that is the wider timezone question in issue #4, not this one.
 */
export const isoInstant = z.string().datetime({ offset: true }).transform(toCanonicalInstant);

/** The same instant, spelled the way everything downstream reads it. */
export function toCanonicalInstant(value: string): string {
  return new Date(value).toISOString();
}
