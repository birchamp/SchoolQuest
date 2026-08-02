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
 *   "Sept. 1 – Sept. 4, 2026"       "Dec. 15-18, 2026 (Finals Week)"
 *
 * Returns null when the text is not a range, which is the common case for prose dates and
 * must never be coerced into one.
 */
export function parseDateRange(raw: string): DateRange | null {
  const text = raw
    // Normalize the dash variants PDF extraction leaves behind.
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const pattern = new RegExp(
    String.raw`\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*-\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2})\s*,?\s*((?:19|20)\d{2})`,
  );
  const match = pattern.exec(text);
  if (!match) return null;

  const startMonth = MONTHS[match[1]!.toLowerCase()];
  const endMonth = match[3] ? MONTHS[match[3].toLowerCase()] : startMonth;
  if (startMonth === undefined || endMonth === undefined) return null;

  const startDay = Number(match[2]);
  const endDay = Number(match[4]);
  const year = Number(match[5]);

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
 * week 1. This is the convention every syllabus checked uses: a term starting Tuesday
 * Aug 25 has "Week 1: Aug 25-28" and "Week 2: Sept 1-4", both inside the Monday-anchored
 * weeks this produces. Breaks and research weeks do not shift the count — syllabi number
 * them too ("Week 8: Research Week").
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
  const explicit = parseDateRange(raw);
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
  | "stale_year";

export interface ResolvedWeekdayDate {
  iso: string;
  basis: WeekdayBasis;
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
  term: { startDate: string; endDate: string },
): ResolvedWeekdayDate | null {
  const range = parseDateRange(raw);

  // Entirely after instruction ends, but still close enough to be this term's finals.
  if (range && range.start > term.endDate && isWithinTerm(range.start, term.startDate, term.endDate)) {
    return { iso: range.start, basis: "registrar_window" };
  }

  const iso = resolveRawDate(raw, weekday, term.startDate);
  if (iso === null) return null;

  return {
    iso,
    basis: isWithinTerm(iso, term.startDate, term.endDate) ? "class_meeting" : "stale_year",
  };
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
