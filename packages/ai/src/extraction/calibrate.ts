import type { TermCalendar } from "@schoolquest/domain";
import type { ScheduleAnchor } from "./schema.js";
import { parseDateRange } from "./resolve-dates.js";
import { academicWeeks } from "./academic-weeks.js";

/**
 * Working out what *this* syllabus means by "Week 10".
 *
 * ## The problem, measured
 *
 * A syllabus that dates work by week number is counting from a start it never states, and no two
 * documents count the same way. From the corpus:
 *
 *   - Richland MATH 104 numbers its break: "Week 9, March 13-19 . . . Spring Break".
 *   - TAMU-Texarkana COSC 1315 also numbers it — "Week 9 Spring break" — but prints no dates at
 *     all, so nothing anchors its week 1.
 *   - Richland MATH 122 starts from "Week 0".
 *   - Richland MATH 104 prints "Week 10" twice and has no Week 16.
 *
 * Resolved against the term's own week numbering, COSC 1315's Assignment 5 ("Week 10") landed on
 * **17 March — inside spring break**. The app caught that and asked, which is the defence
 * working, but the date was still wrong and the document contained everything needed to fix it:
 * it says week 9 is the break, and the calendar says the break is the week of 13 March.
 *
 * Two facts, both already held, never put together. That is what this does.
 *
 * ## Why it is code
 *
 * Because it is arithmetic, and arithmetic is the thing models are worst at and code is best at.
 * The model's job is to copy the headers down; deciding that a document whose week 9 is the week
 * of 13 March must have started on 16 January is subtraction.
 */

export interface WeekCalibration {
  /** Monday of what this document calls week 1, ISO date. Null when nothing anchored it. */
  weekOneMonday: string | null;
  /** How the conclusion was reached, for the reader who has to trust it. */
  basis: "dated_anchor" | "break_anchor" | "none";
  /** The anchor that settled it, quoted. */
  evidence: string | null;
  /**
   * Numbers the document prints more than once. Every week after the first duplicate is a week
   * behind anyone counting elapsed weeks, and the offset is silent.
   */
  duplicateWeeks: number[];
  /** Numbers missing from an otherwise continuous run. */
  skippedWeeks: number[];
  /** True when the document gives a number to a week it also calls a break. */
  breaksTakeWeekNumbers: boolean | null;
}

const MONDAY = 1;

/** Monday of the ISO week containing this date. */
function mondayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function addWeeks(isoDate: string, weeks: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Calibrate one document's week numbering against the term calendar.
 *
 * Two ways in, in order of how much they are worth:
 *
 * 1. **A dated anchor.** Any week header that printed a date range settles it outright — that
 *    week's Monday minus (n − 1) weeks is week 1. Prefers the earliest such row, because a
 *    document with a duplicated number later on is still reliable before the duplicate.
 * 2. **A break anchor.** A header marked as a break, matched against the break the calendar
 *    knows about. This is the case that had no fix: COSC 1315 prints no dates anywhere, and its
 *    "Week 9 Spring break" plus the calendar's March break is enough on its own.
 *
 * Returns nulls rather than a guess when neither is available. A document with no anchors is
 * exactly the state that should raise a question, not produce a date.
 */
export function calibrateWeeks(
  anchors: ScheduleAnchor[],
  term: { startDate: string; endDate: string; calendar?: TermCalendar },
): WeekCalibration {
  const numbers = anchors.map((a) => a.weekNumber);
  const duplicateWeeks = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))].sort(
    (a, b) => a - b,
  );
  const skippedWeeks: number[] = [];
  if (numbers.length > 1) {
    const lo = Math.min(...numbers);
    const hi = Math.max(...numbers);
    for (let n = lo; n <= hi; n += 1) if (!numbers.includes(n)) skippedWeeks.push(n);
  }
  const breaksTakeWeekNumbers = anchors.length === 0 ? null : anchors.some((a) => a.isBreak);

  const contextYear = Number(term.startDate.slice(0, 4));

  // --- 1. A header that printed its own dates.
  const dated = anchors
    .map((a) => ({ anchor: a, range: a.raw ? parseDateRange(a.raw, contextYear) : null }))
    .filter((x): x is { anchor: ScheduleAnchor; range: { start: string; end: string } } => x.range !== null)
    .sort((a, b) => a.anchor.weekNumber - b.anchor.weekNumber);

  if (dated.length > 0) {
    const first = dated[0]!;
    return {
      weekOneMonday: addWeeks(mondayOf(first.range.start), -(first.anchor.weekNumber - 1)),
      basis: "dated_anchor",
      evidence: first.anchor.evidence.excerpt,
      duplicateWeeks,
      skippedWeeks,
      breaksTakeWeekNumbers,
    };
  }

  // --- 2. A numbered break, matched to the break the calendar knows about.
  const breakAnchor = anchors.find((a) => a.isBreak);
  if (breakAnchor && term.calendar) {
    const weeks = academicWeeks({
      termStartDate: term.startDate,
      termEndDate: term.endDate,
      calendar: term.calendar,
    });
    const breakWeek = weeks.find((w) => w.isBreak);
    if (breakWeek) {
      return {
        weekOneMonday: addWeeks(mondayOf(breakWeek.start), -(breakAnchor.weekNumber - 1)),
        basis: "break_anchor",
        evidence: breakAnchor.evidence.excerpt,
        duplicateWeeks,
        skippedWeeks,
        breaksTakeWeekNumbers,
      };
    }
  }

  return {
    weekOneMonday: null,
    basis: "none",
    evidence: null,
    duplicateWeeks,
    skippedWeeks,
    breaksTakeWeekNumbers,
  };
}

/**
 * The date a given week number means in this document, on a chosen weekday.
 *
 * Refuses rather than guesses when the document was never calibrated, and refuses again for any
 * week number at or past a duplicate — because after "Week 10" appears twice, the number no
 * longer identifies a week and no arithmetic can recover which one was meant. That is a question
 * for the student, and the honest answer is to say so rather than to be a week early in silence.
 */
export function dateForWeek(
  weekNumber: number,
  weekday: number,
  calibration: WeekCalibration,
): { iso: string; certain: boolean } | null {
  if (calibration.weekOneMonday === null) return null;
  const firstDuplicate = calibration.duplicateWeeks[0];
  if (firstDuplicate !== undefined && weekNumber >= firstDuplicate) return null;

  const monday = addWeeks(calibration.weekOneMonday, weekNumber - 1);
  const d = new Date(`${monday}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + ((weekday - MONDAY + 7) % 7));
  return { iso: d.toISOString().slice(0, 10), certain: calibration.basis === "dated_anchor" };
}
