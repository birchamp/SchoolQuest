/**
 * Turns a week range into a due date, once the student has told us which weekday.
 *
 * This closes the loop that extraction opens. Syllabi routinely schedule recurring work by
 * the week it falls in — "Sept. 8-11, 2026" — and state the weekday once, somewhere else
 * in prose: "Each Wednesday there will be a quiz." The extractor is forbidden from joining
 * those two facts, and rightly so; it is a two-step inference over separated text and
 * exactly the kind of guess that produces a confident wrong date.
 *
 * But the student knows. So the app asks once, and one answer resolves the whole set.
 *
 * No offset is applied. A syllabus lists each quiz in the row of the week it is *given*,
 * which is already the week after the material it covers — the Greek syllabus puts "QUIZ 1
 * (Chapters 1-3)" in the September 1-4 row, not the August 25-28 row. Resolving within the
 * row's own range is therefore correct, and adding a week would push every quiz late.
 *
 * Nothing here calls a model. It is date arithmetic over text the document really contains.
 */

import type { TermCalendar } from "@schoolquest/domain";
import { breakCovering, finalsWindow, lookupWeek, type TermWindow } from "./academic-weeks.js";
import { dateForWeek, type WeekCalibration } from "./calibrate.js";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Parses the date-range forms real syllabi and real PDF extraction actually produce:
 *
 *   "Sept. 8-11, 2026"              "September 1-4, 2026  2"   (trailing week number)
 *   "Sept. 29-Oct. 2, 2026"         "Nov. 3 – 6, 2026"         (en dash, spaces)
 *   "January 13–16"                 "Mar. 10th-15th"           (no year; ordinals)
 *   "April 28 – May 4"              "Mar 14-\n\nMar 18"        (split across lines)
 *
 * ## The year is optional, and making it mandatory was a real bug
 *
 * This required a four-digit year until it was run against twenty real syllabuses from
 * eighteen institutions, where it parsed **0 of 50** ranges. Every schedule table in that
 * corpus omits the year — it is in the document header, not in every row — and several use
 * ordinal suffixes or wrap a range across a line break.
 *
 * The three syllabuses this was originally validated against all came from one institution
 * and all happened to print years in their schedule rows. Four entries in
 * `docs/10-syllabus-gotchas.md` were marked HANDLED on the strength of that, and none of them
 * held outside that one house style. The general lesson is in the log; the specific one is
 * that a corpus of three from one source cannot establish a convention.
 *
 * `contextYear` supplies the year when the text omits it — the term's own start year, which
 * the caller always knows. Without it a yearless range still returns null, because inventing
 * a year is exactly the guess this module exists to refuse.
 */
export function parseDateRange(raw: string, contextYear?: number): DateRange | null {
  const text = raw
    // Normalize the dash variants PDF extraction leaves behind.
    .replace(/[‐-―−]/g, "-")
    // Collapse newlines too: a range can be split mid-way by a column break, and
    // "Mar 14-\n\nMar 18" is one range that used to read as two fragments.
    .replace(/\s+/g, " ")
    .trim();

  // Ordinals are decoration on a number: "Mar. 10th-15th" is the 10th to the 15th.
  const ordinal = String.raw`(?:st|nd|rd|th)?`;
  const pattern = new RegExp(
    String.raw`\b([A-Za-z]{3,9})\.?\s+(\d{1,2})${ordinal}\s*-\s*(?:([A-Za-z]{3,9})\.?\s*)?(\d{1,2})${ordinal}\s*(?:,?\s*((?:19|20)\d{2}))?`,
  );
  const match = pattern.exec(text);
  if (!match) return null;

  const startMonth = MONTHS[match[1]!.toLowerCase()];
  const endMonth = match[3] ? MONTHS[match[3].toLowerCase()] : startMonth;
  if (startMonth === undefined || endMonth === undefined) return null;

  const startDay = Number(match[2]);
  const endDay = Number(match[4]);
  const year = match[5] ? Number(match[5]) : contextYear;
  // No year in the text and none supplied: unresolvable, and guessing one would be the
  // invented date this whole module refuses to produce.
  if (year === undefined) return null;

  // A range running Dec -> Jan crosses into the next year.
  const endYear = endMonth < startMonth ? year + 1 : year;

  const start = toIso(year, startMonth, startDay);
  const end = toIso(endYear, endMonth, endDay);
  if (!start || !end || end < start) return null;

  return { start, end };
}

/**
 * The date of `weekday` inside a range, or null if the range does not contain that day.
 * A null return is meaningful: a Monday-only student asking for Saturday should get
 * nothing rather than a nearby guess.
 */
export function weekdayWithinRange(range: DateRange, weekday: number): string | null {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);

  for (let time = start; time <= end; time += 86_400_000) {
    const date = new Date(time);
    if (date.getUTCDay() === weekday) return date.toISOString().slice(0, 10);
  }
  return null;
}

/** Resolves a raw week-range string directly to the weekday's date. */
export function resolveWeekdayInRange(raw: string, weekday: number): string | null {
  const range = parseDateRange(raw);
  return range ? weekdayWithinRange(range, weekday) : null;
}

/**
 * Reads a week-number reference: "Week 5", "week #5", "Wk 5", "during Week 11".
 * Returns null for anything else — including bare numbers, which are far too common in
 * ordinary text to treat as week references.
 */
export function weekNumberFromRaw(raw: string): number | null {
  const match = /\bw(?:ee)?k\s*#?\s*(\d{1,2})\b/i.exec(raw);
  if (!match) return null;
  const week = Number(match[1]);
  return week >= 1 && week <= 30 ? week : null;
}

/**
 * The Monday–Sunday span of week N, counting the week containing the term's first day as
 * week 1. A term starting Tuesday Aug 25 has "Week 1: Aug 25-28" and "Week 2: Sept 1-4", both
 * inside the Monday-anchored weeks this produces.
 *
 * **This counts every calendar week, including breaks, and that is only one of two readings.**
 * The docstring here used to claim breaks never shift the count — "syllabi number them too" —
 * and that was wrong. Two of the three real syllabi checked leave their Thanksgiving row
 * unnumbered and resume at the next number, and a third does it both ways inside one document.
 * The cost was MAT 205's Problem Set 6, dated 23 November, in a week with no class.
 *
 * Prefer `lookupWeek` from `academic-weeks.ts`, which reads the term's break calendar and says
 * when the two conventions disagree. This is kept for a term that has supplied no calendar,
 * where counting raw weeks is the only thing left to do.
 */
export function rangeForWeekNumber(week: number, termStartDate: string): DateRange | null {
  if (week < 1 || week > 30) return null;
  const start = Date.parse(`${termStartDate}T00:00:00Z`);
  if (Number.isNaN(start)) return null;

  const startDay = new Date(start).getUTCDay();
  // Step back to the Monday of the term's first week (Sunday counts as end of week).
  const offsetToMonday = (startDay + 6) % 7;
  const monday = start - offsetToMonday * 86_400_000 + (week - 1) * 7 * 86_400_000;

  return {
    start: new Date(monday).toISOString().slice(0, 10),
    end: new Date(monday + 6 * 86_400_000).toISOString().slice(0, 10),
  };
}

/**
 * The full resolver: turns whatever raw date text the extractor preserved into a real
 * date, given the weekday the student confirmed.
 *
 *   "Sept. 8-11, 2026"  + Wednesday            -> 2026-09-09   (explicit range)
 *   "Week 5"            + Wednesday + term set -> the Wednesday of term week 5
 *
 * Week numbers need the term start; without it they stay unresolved rather than guessed.
 */
export function resolveRawDate(
  raw: string,
  weekday: number,
  termStartDate?: string,
): string | null {
  // The term's own start year stands in when a schedule row omits the year, which in a corpus
  // of twenty real syllabuses is every schedule row.
  const explicit = parseDateRange(raw, termStartDate ? Number(termStartDate.slice(0, 4)) : undefined);
  if (explicit) return weekdayWithinRange(explicit, weekday);

  const week = weekNumberFromRaw(raw);
  if (week !== null && termStartDate) {
    const range = rangeForWeekNumber(week, termStartDate);
    if (range) return weekdayWithinRange(range, weekday);
  }

  return null;
}

/**
 * What a weekday answer is actually evidence *of*, for one claim.
 *
 * The student is asked one question — "these are listed by week; what day are they due?" — and
 * the answer is applied to every item in the document still listed that way. That is the whole
 * value of asking: thirteen quizzes get dated by one click instead of thirteen. It is also how
 * an answer about one kind of work reaches a different kind entirely, so the answer has to
 * carry with it what it can and cannot be trusted to have settled.
 *
 * The case that forced this is real, and it was found in the fixture semester's own data. MAT
 * 205 says "The final exam is scheduled by the registrar for finals week, December 14-18,
 * 2026." Answering "Monday" — about problem sets, which are due at the beginning of class —
 * dated the final exam to December 14 and marked it settled. Instruction ends December 11.
 * There are no class meetings in that span at all, so the weekday the student answered about
 * cannot possibly be a fact about the final. A student reading that screen has been told, at
 * full confidence, a date that is one of five and was never announced.
 */
export type WeekdayBasis =
  /** The span is inside instruction: the answer names a real class meeting. */
  | "class_meeting"
  /** The span sits after the last day of instruction — a registrar's finals window. */
  | "registrar_window"
  /** The date resolved outside the term entirely; the year is likely left over. */
  | "stale_year"
  /**
   * "Week N" after a break, in a term that has not said whether its syllabi count through
   * breaks. Two dates a week apart are equally defensible and neither is a reading.
   */
  | "week_number_ambiguous"
  /** The stated weekday is not a day this class meets — the syllabus contradicts itself. */
  | "not_a_class_day";

export interface ResolvedWeekdayDate {
  iso: string;
  basis: WeekdayBasis;
  /** The other candidate date, set only for `week_number_ambiguous`. */
  alternativeIso?: string;
}

/**
 * Resolves one claim's raw date against a weekday answer, and says how far that answer goes.
 *
 * A finals window is dated to the *first* day of the span rather than to the answered weekday.
 * Neither is the announced date, and neither pretends to be — but the first day is the one a
 * student can prepare against and still be ready for every other day in the span, and the
 * answered weekday is not even that. It is a floor, not a guess.
 */
export function resolveWeekdayForClaim(
  raw: string,
  weekday: number,
  term: {
    startDate: string;
    endDate: string;
    calendar?: TermCalendar;
    /** This document's own week numbering, when its headers gave enough to work it out. */
    calibration?: WeekCalibration;
  },
): ResolvedWeekdayDate | null {
  const window: TermWindow = {
    termStartDate: term.startDate,
    termEndDate: term.endDate,
    ...(term.calendar ? { calendar: term.calendar } : {}),
  };

  // A stated finals window beats inferring one from "after instruction ends". Both readings
  // agree on the fixture term; only the stated one is right for a school whose finals do not
  // start the Monday after classes stop.
  const finals = finalsWindow(window);
  const range = parseDateRange(raw, Number(term.startDate.slice(0, 4)));
  if (range && ((finals && range.start >= finals.start && range.start <= finals.end) ||
      (!finals && range.start > term.endDate && isWithinTerm(range.start, term.startDate, term.endDate)))) {
    return { iso: range.start, basis: "registrar_window" };
  }

  // An explicit range in the document outranks any arithmetic over week numbers.
  if (range) return classify(weekdayWithinRange(range, weekday), term, window, weekday);

  const week = weekNumberFromRaw(raw);
  if (week !== null) {
    /**
     * The document's own numbering beats the term's, when the document said enough to work it out.
     *
     * `lookupWeek` counts from the term's first Monday, which is all there is when a syllabus
     * prints nothing but "Week 10" — and it is wrong whenever the course's week 1 is not the
     * term's, which is most of the time once a student's institution and their term row disagree.
     *
     * Measured: TAMU-Texarkana COSC 1315 numbers spring break as its week 9 and prints no dates
     * anywhere. Counted against the term, its week 10 assignment resolved to 17 March — *inside*
     * spring break, caught only because a separate check noticed the collision. Calibrated
     * against the break the document itself numbers, it is 24 March, the Friday after.
     *
     * `dateForWeek` returns null rather than guessing when nothing calibrated the document, and
     * for any week at or past a duplicated number — after "Week 10" appears twice the number no
     * longer identifies a week, and being a week early in silence is what this replaces.
     */
    if (term.calibration) {
      const calibrated = dateForWeek(week, weekday, term.calibration);
      if (calibrated) return classify(calibrated.iso, term, window, weekday);
    }

    const lookup = lookupWeek(week, window);
    if (!lookup) return null;
    const iso = weekdayWithinRange({ start: lookup.start, end: lookup.end }, weekday);
    if (iso === null) return null;

    // The two conventions disagree and nobody has said which this school uses. Returning the
    // instructional reading with the other one attached is the whole point: this is the shape
    // that put Problem Set 6 in Thanksgiving week when it was silently a single answer.
    if (lookup.ambiguous && lookup.alternative) {
      const other = weekdayWithinRange(lookup.alternative, weekday);
      return {
        iso,
        basis: "week_number_ambiguous",
        ...(other ? { alternativeIso: other } : {}),
      };
    }
    return classify(iso, term, window, weekday);
  }

  return null;
}

function classify(
  iso: string | null,
  term: { startDate: string; endDate: string },
  window: TermWindow,
  _weekday: number,
): ResolvedWeekdayDate | null {
  if (iso === null) return null;
  if (!isWithinTerm(iso, term.startDate, term.endDate)) return { iso, basis: "stale_year" };
  // Landing inside a break means the answer cannot be describing a class meeting, whatever
  // else is true about it.
  if (breakCovering(iso, window) !== null) return { iso, basis: "not_a_class_day" };
  return { iso, basis: "class_meeting" };
}

/**
 * Reads one date out of free text a student typed.
 *
 * This exists because answering a clarification question used to do nothing. The screen asked
 * "What date should X use?", took a string, marked the question answered, removed it from the
 * screen — and left the claim exactly as undated as before. Every question the app raises
 * except the weekday one was a dead end, which made the review step a guaranteed pass on any
 * document.
 *
 * Deliberately narrow. It reads a date and refuses everything else, so "I don't know", "ask
 * the professor" and "sometime in week 3" all return null and are recorded as text rather than
 * coerced into a deadline. A wrong date the student appears to have confirmed is worse than no
 * date at all.
 */
export function parseStatedDate(raw: string, contextYear?: number): string | null {
  const text = raw.replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();

  // ISO first: a date input or a careful typist.
  const isoMatch = /\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (isoMatch) {
    return toIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  // "December 4, 2023" / "Dec. 4" / "4 December" — the year optional, as in a schedule row.
  const named = new RegExp(
    String.raw`\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*((?:19|20)\d{2}))?`,
  ).exec(text);
  if (named) {
    const month = MONTHS[named[1]!.toLowerCase()];
    if (month !== undefined) {
      const year = named[3] ? Number(named[3]) : contextYear;
      if (year !== undefined) return toIso(year, month, Number(named[2]));
    }
  }

  const dayFirst = new RegExp(
    // "the 4th of December" is as common as "4 December" when a person types a date.
    String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?(?:\s*,?\s*((?:19|20)\d{2}))?`,
  ).exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]!.toLowerCase()];
    if (month !== undefined) {
      const year = dayFirst[3] ? Number(dayFirst[3]) : contextYear;
      if (year !== undefined) return toIso(year, month, Number(dayFirst[1]));
    }
  }

  // "12/4/2023", "12/4/23", "12/04" — the numeric form half the corpus uses.
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (numeric) {
    const raw3 = numeric[3];
    const year =
      raw3 === undefined
        ? contextYear
        : raw3.length === 2
          ? 2000 + Number(raw3)
          : Number(raw3);
    if (year !== undefined) return toIso(year, Number(numeric[1]), Number(numeric[2]));
  }

  return null;
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Abbreviations people actually type. Spelled out rather than derived by prefix matching,
 * because the common ones are not prefixes: "Weds" is not a prefix of "Wednesday", and
 * "Thurs" is not a prefix of anything shorter than "Thursday". A prefix rule silently
 * fails on both.
 */
const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0, sundays: 0,
  mon: 1, monday: 1, mondays: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5,
  sat: 6, saturday: 6, saturdays: 6,
};

/** Accepts "Wednesday", "wed", "Weds.", or a plain 0-6. Returns null if unrecognized. */
export function parseWeekday(input: string | number): number | null {
  if (typeof input === "number") {
    return Number.isInteger(input) && input >= 0 && input <= 6 ? input : null;
  }

  const text = input.trim().toLowerCase().replace(/[.\s]/g, "");
  if (/^[0-6]$/.test(text)) return Number(text);

  // Unrecognized input returns null so the caller can ask again. Never fall back to a
  // default weekday: silently resolving thirteen quizzes to the wrong day is far worse
  // than leaving them undated.
  return WEEKDAY_ALIASES[text] ?? null;
}

/**
 * Finals sit after the last day of instruction, so a term's end date does not bound its
 * coursework. Every real syllabus checked does this: one lists instruction ending
 * December 11 with its final exam on December 15, another ends December 18 with finals
 * week running December 16-19.
 */
export const FINALS_GRACE_DAYS = 21;

/**
 * Whether a date falls inside the term, allowing for finals after instruction ends.
 *
 * Shared by the extraction validator and the week-range resolver so the two cannot drift:
 * a date the validator would flag must not become trusted just because the student
 * answered a weekday question.
 */
export function isWithinTerm(
  iso: string,
  termStartDate: string,
  termEndDate: string,
  graceDays: number = FINALS_GRACE_DAYS,
): boolean {
  // Before the term started is the signal that actually matters — that is what a stale
  // date left over from a previous year's syllabus looks like.
  if (iso < termStartDate) return false;

  const graceEnd = new Date(Date.parse(`${termEndDate}T00:00:00Z`));
  graceEnd.setUTCDate(graceEnd.getUTCDate() + graceDays);
  return iso <= graceEnd.toISOString().slice(0, 10);
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates like February 30, which JS would otherwise roll forward.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
