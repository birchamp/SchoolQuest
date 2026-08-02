import type { TermCalendar } from "@schoolquest/domain";

/**
 * The term's real calendar: which weeks hold class, and what a syllabus means by "Week 14".
 *
 * ## Why this has to exist before a syllabus can be read
 *
 * A syllabus describes work in three ways that are all relative to a calendar nobody stated in
 * the syllabus:
 *
 *   "Problem Set 6 due Week 14"                    — MAT 205
 *   "A short response is due each Tuesday in class" — ENG 230
 *   "The final exam is scheduled by the registrar for finals week" — MAT 205
 *
 * Reading any of those requires knowing when the term's breaks are, and the syllabus is not
 * where that comes from. Both mechanisms were measurably wrong without it:
 *
 * - `rangeForWeekNumber` put MAT 205's Problem Set 6 on **23 November**, Thanksgiving week,
 *   for work due "at the beginning of class". The other two courses in the same term print
 *   week 14 as 30 November, because neither numbers its break.
 * - `expandRecurrence` produced **sixteen** ENG 230 reading responses including one due
 *   Tuesday 24 November, in a week with no Tuesday class. The right answer is fifteen.
 *
 * ## The two conventions, and why guessing between them is not good enough
 *
 * A syllabus that numbers its weeks either keeps counting through a break or does not, and the
 * two readings differ by exactly one week for everything after the first break. In the corpus:
 *
 *   BIO 240   Thanksgiving row unnumbered, next row is 14  → skips
 *   HIS 210   Thanksgiving row unnumbered, next row is 14  → skips
 *   BIB301    Research Week numbered 8, Thanksgiving not   → both, in one document
 *
 * So it cannot be assumed, and `breaksTakeWeekNumbers: null` — nobody has said — is a real
 * state that has to survive to the caller rather than being defaulted away. What a caller does
 * with an unknown convention is its own decision; what it must not do is pick one silently.
 */

export interface AcademicWeek {
  /** 1-based, counting every calendar week from the term's first Monday. */
  elapsedNumber: number;
  /**
   * 1-based, counting only weeks that contain instruction. Null for a week that is entirely
   * break — those have no instructional number.
   */
  instructionalNumber: number | null;
  /** Monday of the week, "YYYY-MM-DD". */
  start: string;
  /** Sunday of the week. */
  end: string;
  /** True when a break covers every day of this week. */
  isBreak: boolean;
  /** The break's name, when one overlaps this week at all. */
  breakName: string | null;
}

export interface TermWindow {
  /** "YYYY-MM-DD", first day of instruction. */
  termStartDate: string;
  /** "YYYY-MM-DD", last day of instruction. */
  termEndDate: string;
  /** Breaks, finals, and the week-numbering convention. Absent means "nobody has said". */
  calendar?: TermCalendar;
}

const DAY = 86_400_000;

function toUtc(dateOnly: string): number {
  return Date.parse(`${dateOnly}T00:00:00.000Z`);
}

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** The Monday on or before a date. Sunday counts as the end of its week, not the start. */
export function mondayOnOrBefore(dateOnly: string): string {
  const time = toUtc(dateOnly);
  const day = new Date(time).getUTCDay();
  return iso(time - ((day + 6) % 7) * DAY);
}

/**
 * Every week of the term, with both numberings and what the break calendar says about it.
 *
 * Weeks are Monday-anchored because every syllabus checked writes its rows that way, including
 * ones whose term starts on a Tuesday: LAN 200 begins 25 August and its own table calls
 * "Aug. 25-28" week 1.
 */
export function academicWeeks(term: TermWindow): AcademicWeek[] {
  const breaks = term.calendar?.breaks ?? [];
  const firstMonday = toUtc(mondayOnOrBefore(term.termStartDate));
  const lastDay = toUtc(term.termEndDate);

  const weeks: AcademicWeek[] = [];
  let instructional = 0;

  for (let start = firstMonday, n = 1; start <= lastDay; start += 7 * DAY, n++) {
    const end = start + 6 * DAY;
    const overlapping = breaks.find(
      (b) => toUtc(b.startDate) <= end && toUtc(b.endDate) >= start,
    );

    // "Entirely break" means every weekday the class could have met is inside it. A break that
    // covers Wednesday to Friday still leaves Monday and Tuesday, and a class that meets
    // Monday does meet that week — so a partial break does not consume the week's number.
    const isBreak =
      overlapping !== undefined &&
      toUtc(overlapping.startDate) <= start + 4 * DAY &&
      toUtc(overlapping.endDate) >= start + 4 * DAY &&
      toUtc(overlapping.startDate) <= start;

    if (!isBreak) instructional++;

    weeks.push({
      elapsedNumber: n,
      instructionalNumber: isBreak ? null : instructional,
      start: iso(start),
      end: iso(end),
      isBreak,
      breakName: overlapping?.name ?? null,
    });
  }

  return weeks;
}

export interface WeekLookup {
  start: string;
  end: string;
  /**
   * True when the two numbering conventions disagree about this week number and the term has
   * not said which one its syllabi use. The date is a coin flip, and the caller has to treat
   * it as an open question rather than a reading.
   */
  ambiguous: boolean;
  /** The other candidate when `ambiguous`, so a question can name both. */
  alternative: { start: string; end: string } | null;
}

/**
 * What a syllabus means by "Week N", read against the term's real calendar.
 *
 * Returns null for a week number the term does not have. Returns `ambiguous: true` when the
 * term contains a break before week N and nobody has said whether the school's syllabi count
 * through breaks — because in that case the honest answer is two dates a week apart, and
 * picking one is how Problem Set 6 ended up in Thanksgiving week.
 */
export function lookupWeek(week: number, term: TermWindow): WeekLookup | null {
  if (week < 1 || week > 30) return null;

  const weeks = academicWeeks(term);
  const byElapsed = weeks.find((w) => w.elapsedNumber === week) ?? null;
  const byInstructional = weeks.find((w) => w.instructionalNumber === week) ?? null;

  const convention = term.calendar?.breaksTakeWeekNumbers ?? null;
  if (convention === true) return byElapsed && plain(byElapsed);
  if (convention === false) return byInstructional && plain(byInstructional);

  // Nobody has said. If the two agree there is nothing to be uncertain about — which is the
  // case for every week before the term's first break, and for every term without one.
  if (byElapsed && byInstructional && byElapsed.start === byInstructional.start) {
    return plain(byElapsed);
  }

  const primary = byInstructional ?? byElapsed;
  const other = byInstructional ? byElapsed : null;
  if (!primary) return null;

  return {
    start: primary.start,
    end: primary.end,
    ambiguous: other !== null,
    alternative: other ? { start: other.start, end: other.end } : null,
  };
}

function plain(week: AcademicWeek): WeekLookup {
  return { start: week.start, end: week.end, ambiguous: false, alternative: null };
}

/** Whether a date falls inside a break, and which one. */
export function breakCovering(dateOnly: string, term: TermWindow): string | null {
  const time = toUtc(dateOnly);
  const hit = (term.calendar?.breaks ?? []).find(
    (b) => toUtc(b.startDate) <= time && toUtc(b.endDate) >= time,
  );
  return hit?.name ?? null;
}

/**
 * The finals window, when the term has one.
 *
 * Preferred over inferring it from "after the last day of instruction", which is what
 * `resolveWeekdayForClaim` does today and is only a heuristic. A stated finals window makes
 * the registrar case exact instead of approximately right.
 */
export function finalsWindow(term: TermWindow): { start: string; end: string } | null {
  const start = term.calendar?.finalsStartDate;
  const end = term.calendar?.finalsEndDate;
  return start && end ? { start, end } : null;
}
