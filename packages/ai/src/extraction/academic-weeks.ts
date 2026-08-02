import type { TermBreak, TermCalendar, TermDayKind } from "@schoolquest/domain";

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

/**
 * One day of the term. This is the bedrock: everything else here is derived from it, and
 * everything a student or a pasted academic calendar supplies is normalised into it first.
 */
export interface TermDay {
  /** "YYYY-MM-DD". */
  date: string;
  /** 0 = Sunday. The real weekday, regardless of what schedule the day runs. */
  weekday: number;
  kind: TermDayKind;
  /** What the academic calendar called it, when it is not ordinary instruction. */
  label: string | null;
  /**
   * The weekday whose class schedule runs on this date, when the calendar says so. Equal to
   * `weekday` on an ordinary day; a Tuesday running a Friday schedule has `weekday: 2` and
   * `followsWeekday: 5`, and a Friday class does meet.
   */
  followsWeekday: number;
  /** Monday of the academic week this day belongs to. */
  weekStart: string;
  /**
   * True when classes meet: `instruction` and nothing else.
   *
   * Weekends are `instruction` too, meaning "an ordinary day, nothing marked about it". No
   * class meets on a Saturday because no meeting pattern names one, so nothing is lost — and
   * marking them `no_class` would make every single week read as containing a break.
   */
  hasClass: boolean;
}

export interface AcademicWeek {
  /** 1-based, counting every calendar week from the term's first Monday. */
  elapsedNumber: number;
  /**
   * 1-based, counting only weeks that contain at least one class day. Null for a week with
   * none — those have no instructional number.
   */
  instructionalNumber: number | null;
  /** Monday of the week, "YYYY-MM-DD". */
  start: string;
  /** Sunday of the week. */
  end: string;
  /** True when no day in the week holds class. */
  isBreak: boolean;
  /** The label of any non-instruction day in the week, first one wins. */
  breakName: string | null;
  /** The days themselves, so a caller never has to re-derive them. */
  days: TermDay[];
}

export interface TermWindow {
  /** "YYYY-MM-DD", first day of instruction. */
  termStartDate: string;
  /** "YYYY-MM-DD", last day of instruction. */
  termEndDate: string;
  /** The bedrock's source data. Absent means "nobody has said". */
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
 * Materialise every day of the term.
 *
 * Runs from the Monday of the first instruction week through the Sunday of the last, so weeks
 * are always whole and a caller can slice by week without special-casing the ends. Days
 * outside the exceptions list are ordinary instruction, which is the right default: a calendar
 * lists what is *unusual*, and treating an unlisted day as a holiday would empty the term.
 *
 * Weekends inside the term are `instruction` too. That looks odd stated baldly and is correct
 * for what this is used for — it means "an ordinary day, nothing special about it", and no
 * class meets on a Saturday anyway because no meeting pattern names one. Marking weekends
 * `no_class` would make every week look like a break to `academicWeeks`, which is why that
 * function reads weekdays only.
 */
export function termDays(term: TermWindow): TermDay[] {
  const byDate = new Map(
    (term.calendar?.exceptions ?? []).map((e) => [e.date, e]),
  );

  // Runs through the last week holding anything the calendar names, not merely the last week
  // of instruction — finals sit after instruction ends, and a finals window materialised
  // outside the range is a finals window nothing can see.
  const lastNamed = (term.calendar?.exceptions ?? [])
    .map((e) => e.date)
    .reduce((a, b) => (a > b ? a : b), term.termEndDate);

  const first = toUtc(mondayOnOrBefore(term.termStartDate));
  const last = toUtc(mondayOnOrBefore(lastNamed)) + 6 * DAY;

  const days: TermDay[] = [];
  for (let time = first; time <= last; time += DAY) {
    const date = iso(time);
    const weekday = new Date(time).getUTCDay();
    const exception = byDate.get(date);
    const kind: TermDayKind = exception?.kind ?? "instruction";
    days.push({
      date,
      weekday,
      kind,
      label: exception?.label ?? null,
      followsWeekday: exception?.followsWeekday ?? weekday,
      weekStart: mondayOnOrBefore(date),
      hasClass: kind === "instruction",
    });
  }
  return days;
}

/**
 * Every week of the term, with both numberings and the days each one holds.
 *
 * Weeks are Monday-anchored because every syllabus checked writes its rows that way, including
 * ones whose term starts on a Tuesday: LAN 200 begins 25 August and its own table calls
 * "Aug. 25-28" week 1.
 */
export function academicWeeks(term: TermWindow): AcademicWeek[] {
  const weeks = new Map<string, TermDay[]>();
  for (const day of termDays(term)) {
    weeks.set(day.weekStart, [...(weeks.get(day.weekStart) ?? []), day]);
  }

  const out: AcademicWeek[] = [];
  let instructional = 0;
  let elapsed = 0;

  for (const [start, days] of [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    elapsed++;
    /**
     * A week is a break when no *weekday* in it holds class.
     *
     * Weekdays only, and the first draft of this got it wrong: Thanksgiving runs Monday to
     * Friday, its Saturday and Sunday are ordinary unlabelled days, and asking whether *every*
     * day lacked class meant a Monday-to-Friday recess never read as a break at all. No class
     * meets at the weekend regardless, so weekends cannot be evidence either way.
     *
     * HIS 210's "no class Thursday" week still meets on Monday, so it stays an instructional
     * week and keeps its number — dropping any week merely touched by a break would delete a
     * real week of the term.
     */
    const weekdays = days.filter((d) => d.weekday >= 1 && d.weekday <= 5);
    const isBreak = weekdays.length > 0 && weekdays.every((d) => !d.hasClass);
    if (!isBreak) instructional++;

    out.push({
      elapsedNumber: elapsed,
      instructionalNumber: isBreak ? null : instructional,
      start,
      end: iso(toUtc(start) + 6 * DAY),
      isBreak,
      breakName: days.find((d) => d.label !== null)?.label ?? null,
      days,
    });
  }

  return out;
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
 *
 * Note the limit, recorded in `docs/10-syllabus-gotchas.md` §3.7: a per-term convention cannot
 * be right for a document that numbers one break and skips another, and two of the three real
 * syllabi do exactly that. Calibrating against the week/date pairs a document prints for
 * itself is the fix, and this is the fallback for documents that print none.
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

/** The day record for a date, or null when it falls outside the term. */
export function dayAt(dateOnly: string, term: TermWindow): TermDay | null {
  return termDays(term).find((d) => d.date === dateOnly) ?? null;
}

/**
 * The label of the break covering a date, or null when class meets that day.
 *
 * Reads the bedrock rather than a range list, so a one-day holiday is exactly as visible as a
 * week-long recess — which was the point of going by day.
 */
export function breakCovering(dateOnly: string, term: TermWindow): string | null {
  const day = dayAt(dateOnly, term);
  if (!day || day.hasClass) return null;
  return day.label ?? kindLabel(day.kind);
}

function kindLabel(kind: TermDayKind): string {
  if (kind === "finals") return "Finals";
  if (kind === "reading") return "Reading day";
  return "No class";
}

/**
 * The finals window, derived from the days marked `finals`.
 *
 * Preferred over inferring it from "after the last day of instruction", which is only a
 * heuristic and wrong for a school whose finals do not start the Monday after classes stop.
 */
export function finalsWindow(term: TermWindow): { start: string; end: string } | null {
  const finals = termDays(term).filter((d) => d.kind === "finals");
  if (finals.length === 0) return null;
  return { start: finals[0]!.date, end: finals.at(-1)!.date };
}

/**
 * Contiguous runs of non-class days, for display.
 *
 * The day calendar is the truth; this is the human-readable summary of it, so a setup screen
 * can say "Thanksgiving Recess, 23–27 November" rather than listing five dates.
 */
export function breaksFromCalendar(term: TermWindow): TermBreak[] {
  const out: TermBreak[] = [];
  let run: TermBreak | null = null;

  for (const day of termDays(term)) {
    // Finals are not a break — work very much happens — and weekends are ordinary days, so
    // neither starts or extends a run.
    const isBreakDay = day.kind === "no_class";
    if (!isBreakDay) {
      run = null;
      continue;
    }
    const name = day.label ?? "Break";
    if (run && run.name === name && toUtc(day.date) - toUtc(run.endDate) === DAY) {
      run.endDate = day.date;
    } else {
      run = { name, startDate: day.date, endDate: day.date };
      out.push(run);
    }
  }
  return out;
}

/**
 * Turn ranges into the day exceptions the bedrock stores.
 *
 * The normalisation point for anything that arrives as a range — a student typing "fall break,
 * 12 to 13 October", or a model reading an academic calendar that writes recesses as spans.
 * Nothing downstream sees ranges.
 */
export function exceptionsFromRange(
  range: { startDate: string; endDate: string; label?: string | null; kind?: TermDayKind },
): { date: string; kind: "no_class" | "reading" | "finals"; label: string | null; followsWeekday: number | null }[] {
  const kind = range.kind && range.kind !== "instruction" ? range.kind : "no_class";
  const out: ReturnType<typeof exceptionsFromRange> = [];
  for (let t = toUtc(range.startDate); t <= toUtc(range.endDate); t += DAY) {
    out.push({ date: iso(t), kind, label: range.label ?? null, followsWeekday: null });
  }
  return out;
}
