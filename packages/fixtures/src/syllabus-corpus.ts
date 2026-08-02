import type { SyllabusPage } from "./syllabus-pages.js";

/**
 * Forty syllabuses across eight terms, built to exercise every gotcha in the log.
 *
 * ## What this is, and what it is not
 *
 * These are **constructed**, not collected. Every document here was written to carry a declared
 * set of structural faults, which buys one thing the three real syllabuses in
 * `syllabus-pages.ts` cannot give: **the answer key is exact by construction**. Recall and
 * precision can be measured across forty documents automatically, rather than against a key
 * hand-written from five.
 *
 * It also costs one thing, and the cost is the more important half: **a constructed corpus
 * cannot discover a gotcha nobody has thought of.** Every fault in here is one already in
 * `docs/10-syllabus-gotchas.md`, so this measures regression, not reality. The log's rule —
 * quote a real source — still applies to that document, and nothing here may be cited in it.
 *
 * Real syllabuses remain the more valuable corpus. See `README` in this package for how to add
 * one; the ingest path takes about two minutes per document and the coverage report will show
 * immediately whether it brought anything new.
 *
 * ## How the variety is generated
 *
 * Nothing is random — this package forbids `Math.random`, and a corpus that shuffled itself
 * would make a failing test unreproducible. Each course declares its faults, its shape, and
 * which term it belongs to; the text is composed from those. Two courses with the same faults
 * in different terms still differ, because the term calendars differ.
 *
 * The eight terms are deliberately unalike in the ways that have already caused bugs: which
 * weekday instruction starts on, whether there is a fall break and how long, whether
 * Thanksgiving is three days or five, whether reading days exist, where finals sit, and —
 * the one that broke a shipped fix — whether the school's syllabuses number their break weeks.
 */

/** Every fault a document here can carry, keyed to its entry in the gotchas log. */
export type GotchaCode =
  | "stale_year" // §1.1
  | "registrar_finals_week" // §1.3
  | "week_range_dates" // §1.4
  | "cross_month_range" // §1.5
  | "conflicting_dates" // §1.6
  | "no_year" // §1.7
  | "no_date_at_all" // §1.8
  | "holiday_collision" // §1.10
  | "weights_short" // §2.1
  | "weights_over" // §2.1
  | "weight_missing" // §2.1
  | "weights_in_prose" // §2.2
  | "points_and_percent" // §2.3
  | "count_not_stated" // §2.4
  | "category_without_items" // §2.5
  | "rule_not_listed" // §3.1
  | "described_twice" // §3.2
  | "grouped_by_category" // §3.3
  | "note_in_first_row" // §3.4
  | "title_carries_scope" // §3.5
  | "break_skips_number" // §3.6
  | "inconsistent_numbering" // §3.7
  | "weekday_not_a_class_day" // §5.1
  | "broken_list_numbering" // §5.3
  | "policy_cliff"; // §5.4

export interface CorpusBreak {
  name: string;
  /** Inclusive. A single day has the same start and end. */
  startDate: string;
  endDate: string;
}

export interface CorpusTerm {
  key: string;
  name: string;
  /** First day of instruction. */
  startDate: string;
  /** Last day of instruction. */
  endDate: string;
  breaks: CorpusBreak[];
  finals: { startDate: string; endDate: string };
  /** Reading/study days, which are not breaks: no class, and work very much expected. */
  readingDays: string[];
  /**
   * Whether this school's syllabuses keep counting week numbers through a break.
   *
   * `"inconsistent"` is the case that defeated a per-term boolean — a document that numbers
   * one break and skips another. Two of the three real syllabuses do it, so a corpus without
   * it would be easier than reality.
   */
  weekNumbering: "counts_breaks" | "skips_breaks" | "inconsistent";
}

export interface CorpusCourse {
  termKey: string;
  code: string;
  name: string;
  credits: number;
  /** 0 = Sunday. */
  meetingDays: number[];
  meetingStart: string;
  meetingEnd: string;
  gotchas: GotchaCode[];
}

/** One expected family of work, for scoring recall without hand-writing a key. */
export interface ExpectedFamily {
  family: string;
  count: number;
  /** Dates the document really states, when it states any. */
  statedDates: string[];
  /** True when the count has to be derived from the calendar rather than read. */
  derived: boolean;
}

export interface CorpusSyllabus {
  course: CorpusCourse;
  term: CorpusTerm;
  pages: SyllabusPage[];
  expected: ExpectedFamily[];
  /** Category name to weight, exactly as the document states it. Null where none is given. */
  expectedWeights: { name: string; weightPercent: number | null }[];
  /** What the weights actually total, which is not always 100 and is sometimes the point. */
  statedWeightTotal: number;
}

const DAY = 86_400_000;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const ABBREV = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function utc(dateOnly: string): number {
  return Date.parse(`${dateOnly}T00:00:00.000Z`);
}
function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}
function parts(dateOnly: string): { y: number; m: number; d: number; wd: number } {
  const t = new Date(utc(dateOnly));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), wd: t.getUTCDay() };
}

/** "September 7, 2026" */
function longDate(dateOnly: string, year = true): string {
  const p = parts(dateOnly);
  return `${MONTHS[p.m]} ${p.d}${year ? `, ${p.y}` : ""}`;
}
/** "Sept. 7, 2026" */
function shortDate(dateOnly: string): string {
  const p = parts(dateOnly);
  return `${ABBREV[p.m]} ${p.d}, ${p.y}`;
}
/**
 * "Aug. 24-28, 2026" or "Sept. 29-Oct. 2, 2026".
 *
 * `dash` varies the character on purpose: real PDF extraction yields hyphen, en dash and
 * spaced en dash from the same institution, and hand-tidied fixtures never caught those.
 */
function weekRange(monday: string, dash: string): string {
  const a = parts(monday);
  const b = parts(iso(utc(monday) + 4 * DAY));
  return a.m === b.m
    ? `${ABBREV[a.m]} ${a.d}${dash}${b.d}, ${b.y}`
    : `${ABBREV[a.m]} ${a.d}${dash}${ABBREV[b.m]} ${b.d}, ${b.y}`;
}

function mondayOnOrBefore(dateOnly: string): string {
  const t = utc(dateOnly);
  return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
}

function inBreak(dateOnly: string, term: CorpusTerm): boolean {
  const t = utc(dateOnly);
  return term.breaks.some((b) => utc(b.startDate) <= t && utc(b.endDate) >= t);
}

/** Mondays of every week from the term's first through its last instruction week. */
function termWeeks(term: CorpusTerm): string[] {
  const out: string[] = [];
  const last = utc(mondayOnOrBefore(term.endDate));
  for (let t = utc(mondayOnOrBefore(term.startDate)); t <= last; t += 7 * DAY) out.push(iso(t));
  return out;
}

/** Every date in the term falling on `weekday`, skipping days inside a break. */
function classDays(term: CorpusTerm, weekday: number): string[] {
  const out: string[] = [];
  const end = utc(term.endDate);
  let t = utc(term.startDate);
  while (new Date(t).getUTCDay() !== weekday && t <= end) t += DAY;
  for (; t <= end; t += 7 * DAY) {
    const date = iso(t);
    if (!inBreak(date, term)) out.push(date);
  }
  return out;
}

/**
 * The week numbers a syllabus prints beside each week, under this school's convention.
 *
 * `inconsistent` reproduces what LAN 200 and BIB301 both do: the first break keeps its number
 * and every later one does not, so the printed numbers agree with elapsed weeks up to the
 * second break and drift by one after it. No per-term setting can resolve a document like
 * that, which is exactly why the corpus contains some.
 */
function weekNumbers(term: CorpusTerm): (number | null)[] {
  const weeks = termWeeks(term);
  const out: (number | null)[] = [];
  let n = 0;
  let breaksSeen = 0;

  for (const monday of weeks) {
    const weekdaysOff = [0, 1, 2, 3, 4].filter((i) => inBreak(iso(utc(monday) + i * DAY), term));
    const isBreakWeek = weekdaysOff.length >= 5;
    if (!isBreakWeek) {
      out.push(++n);
      continue;
    }
    breaksSeen++;
    if (term.weekNumbering === "counts_breaks") out.push(++n);
    else if (term.weekNumbering === "skips_breaks") out.push(null);
    // Inconsistent: the first break week takes a number, later ones do not.
    else out.push(breaksSeen === 1 ? ++n : null);
  }
  return out;
}

/**
 * The eight terms.
 *
 * Different in the ways that have caused real bugs, not merely in their dates: a Tuesday start
 * and a Monday start, a one-day holiday and a two-day break, Thanksgiving as three days and as
 * five, reading days present and absent, finals adjacent to instruction and a weekend away,
 * and all three week-numbering conventions.
 */
export const CORPUS_TERMS: CorpusTerm[] = [
  {
    key: "f26",
    name: "Fall 2026",
    startDate: "2026-08-24",
    endDate: "2026-12-11",
    breaks: [
      { name: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07" },
      { name: "Fall Break", startDate: "2026-10-12", endDate: "2026-10-13" },
      { name: "Thanksgiving Recess", startDate: "2026-11-25", endDate: "2026-11-27" },
    ],
    finals: { startDate: "2026-12-14", endDate: "2026-12-18" },
    readingDays: ["2026-12-12"],
    weekNumbering: "skips_breaks",
  },
  {
    key: "s27",
    name: "Spring 2027",
    startDate: "2027-01-11",
    endDate: "2027-04-30",
    breaks: [
      { name: "Martin Luther King Jr. Day", startDate: "2027-01-18", endDate: "2027-01-18" },
      { name: "Spring Break", startDate: "2027-03-08", endDate: "2027-03-12" },
    ],
    finals: { startDate: "2027-05-03", endDate: "2027-05-07" },
    readingDays: [],
    weekNumbering: "counts_breaks",
  },
  {
    key: "f27",
    name: "Fall 2027",
    // A Tuesday start, like LAN 200 — week 1 is short and its Monday is before instruction.
    startDate: "2027-08-24",
    endDate: "2027-12-10",
    breaks: [
      { name: "Labor Day", startDate: "2027-09-06", endDate: "2027-09-06" },
      { name: "Reading Week", startDate: "2027-10-11", endDate: "2027-10-15" },
      { name: "Thanksgiving Break", startDate: "2027-11-22", endDate: "2027-11-26" },
    ],
    finals: { startDate: "2027-12-13", endDate: "2027-12-17" },
    readingDays: [],
    weekNumbering: "inconsistent",
  },
  {
    key: "s28",
    name: "Spring 2028",
    startDate: "2028-01-10",
    endDate: "2028-04-28",
    breaks: [
      { name: "Presidents Day", startDate: "2028-02-21", endDate: "2028-02-21" },
      { name: "Spring Recess", startDate: "2028-03-13", endDate: "2028-03-17" },
    ],
    finals: { startDate: "2028-05-01", endDate: "2028-05-05" },
    readingDays: ["2028-04-29"],
    weekNumbering: "skips_breaks",
  },
  {
    key: "f28",
    name: "Fall 2028",
    startDate: "2028-08-28",
    endDate: "2028-12-08",
    // No fall break at all: the term that makes a break-aware reader prove it handles none.
    breaks: [
      { name: "Labor Day", startDate: "2028-09-04", endDate: "2028-09-04" },
      { name: "Thanksgiving", startDate: "2028-11-22", endDate: "2028-11-24" },
    ],
    finals: { startDate: "2028-12-11", endDate: "2028-12-15" },
    readingDays: [],
    weekNumbering: "counts_breaks",
  },
  {
    key: "s29",
    name: "Spring 2029",
    startDate: "2029-01-08",
    endDate: "2029-04-27",
    breaks: [{ name: "Spring Break", startDate: "2029-03-12", endDate: "2029-03-16" }],
    finals: { startDate: "2029-04-30", endDate: "2029-05-04" },
    readingDays: [],
    weekNumbering: "inconsistent",
  },
  {
    key: "f29",
    name: "Fall 2029",
    startDate: "2029-08-27",
    endDate: "2029-12-07",
    breaks: [
      { name: "Labor Day", startDate: "2029-09-03", endDate: "2029-09-03" },
      { name: "Fall Recess", startDate: "2029-10-15", endDate: "2029-10-16" },
      // Five full days, unlike Fall 2026's three: the difference decides whether that week
      // is a break week at all, and therefore whether its number is skipped.
      { name: "Thanksgiving Recess", startDate: "2029-11-19", endDate: "2029-11-23" },
    ],
    finals: { startDate: "2029-12-10", endDate: "2029-12-14" },
    readingDays: ["2029-12-08"],
    weekNumbering: "skips_breaks",
  },
  {
    key: "s30",
    name: "Spring 2030",
    startDate: "2030-01-14",
    endDate: "2030-05-03",
    breaks: [
      { name: "Martin Luther King Jr. Day", startDate: "2030-01-21", endDate: "2030-01-21" },
      { name: "Spring Break", startDate: "2030-03-11", endDate: "2030-03-15" },
      { name: "Study Day", startDate: "2030-04-19", endDate: "2030-04-19" },
    ],
    finals: { startDate: "2030-05-06", endDate: "2030-05-10" },
    readingDays: [],
    weekNumbering: "counts_breaks",
  },
];

/**
 * Forty courses, five per term.
 *
 * The fault assignments are deliberate rather than spread evenly: the faults that have cost
 * real money — a week number after a break, a weekday that is not a class day, recurring work
 * stated as a rule — appear many times and in combination, because a reader that handles one
 * in isolation and fails when two coincide is the failure this corpus exists to catch.
 */
export const CORPUS_COURSES: CorpusCourse[] = [
  // --- Fall 2026 -------------------------------------------------------------
  { termKey: "f26", code: "BIO 101", name: "Principles of Biology", credits: 4, meetingDays: [1, 3, 5], meetingStart: "09:00", meetingEnd: "09:50",
    gotchas: ["week_range_dates", "rule_not_listed", "weights_short", "note_in_first_row", "registrar_finals_week"] },
  { termKey: "f26", code: "MTH 141", name: "Calculus I", credits: 4, meetingDays: [1, 2, 3, 4], meetingStart: "11:00", meetingEnd: "11:50",
    gotchas: ["holiday_collision", "break_skips_number", "no_date_at_all", "points_and_percent"] },
  { termKey: "f26", code: "ENG 105", name: "Composition and Rhetoric", credits: 3, meetingDays: [2, 4], meetingStart: "13:00", meetingEnd: "14:15",
    gotchas: ["rule_not_listed", "count_not_stated", "no_year", "described_twice"] },
  { termKey: "f26", code: "HIS 220", name: "The American Century", credits: 3, meetingDays: [1, 3], meetingStart: "10:00", meetingEnd: "11:15",
    gotchas: ["stale_year", "conflicting_dates", "grouped_by_category", "title_carries_scope"] },
  { termKey: "f26", code: "MUS 110", name: "Concert Band", credits: 1, meetingDays: [1, 3, 5], meetingStart: "16:00", meetingEnd: "17:30",
    gotchas: ["category_without_items", "weight_missing", "policy_cliff"] },

  // --- Spring 2027 -----------------------------------------------------------
  { termKey: "s27", code: "CHM 210", name: "Organic Chemistry I", credits: 4, meetingDays: [1, 3, 5], meetingStart: "08:00", meetingEnd: "08:50",
    gotchas: ["week_range_dates", "weekday_not_a_class_day", "rule_not_listed", "cross_month_range"] },
  { termKey: "s27", code: "PHL 150", name: "Introduction to Logic", credits: 3, meetingDays: [2, 4], meetingStart: "09:30", meetingEnd: "10:45",
    gotchas: ["weights_in_prose", "broken_list_numbering", "count_not_stated"] },
  { termKey: "s27", code: "CSC 240", name: "Data Structures", credits: 3, meetingDays: [1, 3], meetingStart: "14:00", meetingEnd: "15:15",
    gotchas: ["points_and_percent", "no_date_at_all", "described_twice", "weights_over"] },
  { termKey: "s27", code: "SPN 202", name: "Intermediate Spanish II", credits: 4, meetingDays: [1, 2, 3, 4], meetingStart: "12:00", meetingEnd: "12:50",
    gotchas: ["rule_not_listed", "holiday_collision", "title_carries_scope"] },
  { termKey: "s27", code: "PSY 101", name: "General Psychology", credits: 3, meetingDays: [3], meetingStart: "18:00", meetingEnd: "20:45",
    gotchas: ["grouped_by_category", "weights_short", "registrar_finals_week"] },

  // --- Fall 2027 (Tuesday start, inconsistent numbering) ---------------------
  { termKey: "f27", code: "ECO 201", name: "Principles of Microeconomics", credits: 3, meetingDays: [2, 4], meetingStart: "09:30", meetingEnd: "10:45",
    gotchas: ["inconsistent_numbering", "week_range_dates", "rule_not_listed", "weights_short"] },
  { termKey: "f27", code: "ART 130", name: "Drawing I", credits: 3, meetingDays: [1, 3], meetingStart: "13:00", meetingEnd: "15:45",
    gotchas: ["category_without_items", "no_date_at_all", "weight_missing"] },
  { termKey: "f27", code: "BIO 240", name: "Human Anatomy", credits: 4, meetingDays: [1, 3, 5], meetingStart: "10:00", meetingEnd: "10:50",
    gotchas: ["inconsistent_numbering", "title_carries_scope", "note_in_first_row", "conflicting_dates"] },
  { termKey: "f27", code: "POL 110", name: "American Government", credits: 3, meetingDays: [2, 4], meetingStart: "11:00", meetingEnd: "12:15",
    gotchas: ["weekday_not_a_class_day", "stale_year", "policy_cliff"] },
  { termKey: "f27", code: "MTH 120", name: "Introductory Statistics", credits: 3, meetingDays: [1, 3, 5], meetingStart: "14:00", meetingEnd: "14:50",
    gotchas: ["inconsistent_numbering", "break_skips_number", "registrar_finals_week", "no_year"] },

  // --- Spring 2028 -----------------------------------------------------------
  { termKey: "s28", code: "NUR 210", name: "Health Assessment", credits: 4, meetingDays: [2, 4], meetingStart: "08:00", meetingEnd: "09:50",
    gotchas: ["rule_not_listed", "points_and_percent", "described_twice"] },
  { termKey: "s28", code: "HIS 101", name: "World Civilisations I", credits: 3, meetingDays: [1, 3, 5], meetingStart: "09:00", meetingEnd: "09:50",
    gotchas: ["week_range_dates", "grouped_by_category", "cross_month_range", "weights_over"] },
  { termKey: "s28", code: "PHY 211", name: "General Physics I", credits: 4, meetingDays: [1, 2, 3, 4], meetingStart: "11:00", meetingEnd: "11:50",
    gotchas: ["holiday_collision", "count_not_stated", "weights_short"] },
  { termKey: "s28", code: "COM 210", name: "Public Speaking", credits: 3, meetingDays: [2, 4], meetingStart: "15:30", meetingEnd: "16:45",
    gotchas: ["no_date_at_all", "weight_missing", "broken_list_numbering"] },
  { termKey: "s28", code: "REL 205", name: "World Religions", credits: 3, meetingDays: [4], meetingStart: "18:00", meetingEnd: "20:45",
    gotchas: ["weights_in_prose", "rule_not_listed", "weekday_not_a_class_day"] },

  // --- Fall 2028 (no fall break) --------------------------------------------
  { termKey: "f28", code: "ACC 201", name: "Financial Accounting", credits: 3, meetingDays: [1, 3, 5], meetingStart: "08:00", meetingEnd: "08:50",
    gotchas: ["week_range_dates", "points_and_percent", "note_in_first_row"] },
  { termKey: "f28", code: "ENG 230", name: "Creative Writing", credits: 3, meetingDays: [2, 4], meetingStart: "13:00", meetingEnd: "14:15",
    gotchas: ["rule_not_listed", "count_not_stated", "described_twice", "no_year"] },
  { termKey: "f28", code: "GEO 105", name: "Physical Geography", credits: 4, meetingDays: [1, 3], meetingStart: "10:00", meetingEnd: "11:15",
    gotchas: ["holiday_collision", "conflicting_dates", "weights_short"] },
  { termKey: "f28", code: "SOC 101", name: "Introduction to Sociology", credits: 3, meetingDays: [2, 4], meetingStart: "09:30", meetingEnd: "10:45",
    gotchas: ["grouped_by_category", "category_without_items", "policy_cliff"] },
  { termKey: "f28", code: "CSC 110", name: "Programming Fundamentals", credits: 4, meetingDays: [1, 3, 5], meetingStart: "15:00", meetingEnd: "15:50",
    gotchas: ["no_date_at_all", "registrar_finals_week", "title_carries_scope"] },

  // --- Spring 2029 (one break, inconsistent numbering) ----------------------
  { termKey: "s29", code: "BIO 320", name: "Genetics", credits: 4, meetingDays: [1, 3, 5], meetingStart: "09:00", meetingEnd: "09:50",
    gotchas: ["inconsistent_numbering", "week_range_dates", "rule_not_listed", "weights_over"] },
  { termKey: "s29", code: "MTH 250", name: "Linear Algebra", credits: 3, meetingDays: [2, 4], meetingStart: "11:00", meetingEnd: "12:15",
    gotchas: ["break_skips_number", "no_date_at_all", "points_and_percent"] },
  { termKey: "s29", code: "ENG 310", name: "Shakespeare", credits: 3, meetingDays: [2, 4], meetingStart: "14:00", meetingEnd: "15:15",
    gotchas: ["stale_year", "title_carries_scope", "grouped_by_category", "count_not_stated"] },
  { termKey: "s29", code: "EDU 200", name: "Foundations of Education", credits: 3, meetingDays: [3], meetingStart: "17:00", meetingEnd: "19:45",
    gotchas: ["weights_in_prose", "category_without_items", "weekday_not_a_class_day"] },
  { termKey: "s29", code: "KIN 150", name: "Fitness and Wellness", credits: 2, meetingDays: [1, 3], meetingStart: "07:00", meetingEnd: "07:50",
    gotchas: ["rule_not_listed", "weight_missing", "no_year"] },

  // --- Fall 2029 (five-day Thanksgiving) ------------------------------------
  { termKey: "f29", code: "CHM 101", name: "General Chemistry", credits: 4, meetingDays: [1, 3, 5], meetingStart: "08:00", meetingEnd: "08:50",
    gotchas: ["break_skips_number", "week_range_dates", "rule_not_listed", "note_in_first_row"] },
  { termKey: "f29", code: "BUS 300", name: "Organisational Behaviour", credits: 3, meetingDays: [2, 4], meetingStart: "10:00", meetingEnd: "11:15",
    gotchas: ["described_twice", "weights_short", "broken_list_numbering"] },
  { termKey: "f29", code: "ANT 210", name: "Cultural Anthropology", credits: 3, meetingDays: [1, 3], meetingStart: "13:00", meetingEnd: "14:15",
    gotchas: ["grouped_by_category", "conflicting_dates", "policy_cliff"] },
  { termKey: "f29", code: "MTH 090", name: "Intermediate Algebra", credits: 3, meetingDays: [1, 2, 3, 4, 5], meetingStart: "12:00", meetingEnd: "12:50",
    gotchas: ["holiday_collision", "count_not_stated", "points_and_percent"] },
  { termKey: "f29", code: "THE 120", name: "Acting I", credits: 3, meetingDays: [2, 4], meetingStart: "16:00", meetingEnd: "17:45",
    gotchas: ["no_date_at_all", "category_without_items", "registrar_finals_week"] },

  // --- Spring 2030 -----------------------------------------------------------
  { termKey: "s30", code: "PHY 212", name: "General Physics II", credits: 4, meetingDays: [1, 3, 5], meetingStart: "09:00", meetingEnd: "09:50",
    gotchas: ["week_range_dates", "cross_month_range", "weights_over", "rule_not_listed"] },
  { termKey: "s30", code: "HIS 340", name: "The Civil War", credits: 3, meetingDays: [2, 4], meetingStart: "11:00", meetingEnd: "12:15",
    gotchas: ["stale_year", "described_twice", "title_carries_scope"] },
  { termKey: "s30", code: "CSC 330", name: "Databases", credits: 3, meetingDays: [1, 3], meetingStart: "14:00", meetingEnd: "15:15",
    gotchas: ["no_date_at_all", "points_and_percent", "weights_in_prose"] },
  { termKey: "s30", code: "SPN 101", name: "Elementary Spanish I", credits: 4, meetingDays: [1, 2, 3, 4], meetingStart: "10:00", meetingEnd: "10:50",
    gotchas: ["rule_not_listed", "holiday_collision", "weekday_not_a_class_day"] },
  { termKey: "s30", code: "PHL 320", name: "Ethics", credits: 3, meetingDays: [4], meetingStart: "18:00", meetingEnd: "20:45",
    gotchas: ["grouped_by_category", "weight_missing", "no_year", "policy_cliff"] },
];

/** Boilerplate every syllabus carries, so the page cap and evidence matching see real noise. */
const BOILERPLATE = `ACADEMIC INTEGRITY
Cheating and plagiarism are violations of the student conduct code. Plagiarism exists when one
gives the impression that another person's words or ideas are their own, whether intentionally
or not. A student who breaks this standard will be reported to the Dean of Students.

STUDENTS WITH DISABILITIES
Any student requiring accommodation should contact the Office of Student Access during the
first week of the semester, or as soon as the need becomes apparent.

ARTIFICIAL INTELLIGENCE
Work generated by an AI program may not be submitted as your own. Material that includes
AI-generated content must be cited like any other source, with a note explaining how the tool
was used.`;

function gradingScale(): string {
  return `GRADING SCALE
93-100 A   87-89 B+   77-79 C+   67-69 D+
90-92 A-   83-86 B    73-76 C    63-66 D
           80-82 B-   70-72 C-   0-62 F`;
}

function meetingLine(course: CorpusCourse): string {
  const days = course.meetingDays.map((d) => WEEKDAY_NAMES[d]).join(", ");
  return `Course schedule:  ${days}\nTime:  ${course.meetingStart}-${course.meetingEnd}`;
}

/**
 * The grading section, in one of three layouts.
 *
 * Layout is not decoration. LAN 200 has no grading table at all — its weights are trailing
 * numbers on prose paragraphs — and a reader tuned to tables finds nothing there.
 */
function gradingSection(
  course: CorpusCourse,
  weights: { name: string; weightPercent: number | null; points?: number }[],
): string {
  const has = (g: GotchaCode) => course.gotchas.includes(g);

  if (has("weights_in_prose")) {
    // §2.2: the weight ends a paragraph, and one of them trails a sentence about failing.
    const numbered = has("broken_list_numbering") ? [1, 2, 4, 4, 5] : [1, 2, 3, 4, 5];
    return `COURSE REQUIREMENTS\n${weights
      .map((w, i) => {
        const body =
          i === 0
            ? `Attendance is expected at every meeting. Missing more than four classes will lower this portion of your grade substantially.`
            : `${w.name} are assessed throughout the term and averaged at the end of the semester.`;
        return `${numbered[i] ?? i + 1}. ${w.name}: ${body} ${w.weightPercent === null ? "" : `${w.weightPercent}%`}`.trimEnd();
      })
      .join("\n")}`;
  }

  if (has("points_and_percent")) {
    // §2.3: category weights as percentages and individual work in raw points, in one
    // document, describing the same grade twice in two units that need not agree.
    return `GRADING\n${weights
      .map((w) => `${w.name.padEnd(24)} ${w.weightPercent === null ? "(see below)" : `${w.weightPercent}%`}`)
      .join("\n")}\n\nPOINTS\nEach assignment is scored out of a fixed number of points:\n${weights
      .filter((w) => w.points)
      .map((w) => `  ${w.name}: ${w.points} points each`)
      .join("\n")}\nThe total points available in the course is ${weights.reduce((s, w) => s + (w.points ?? 0) * 4, 0)}.`;
  }

  return `GRADING\n${weights
    .map((w) => `${w.name.padEnd(24)} ${w.weightPercent === null ? "" : `${w.weightPercent}%`}`.trimEnd())
    .join("\n")}`;
}

/** The weights a course states, shaped by whichever weight fault it carries. */
function weightsFor(course: CorpusCourse): { name: string; weightPercent: number | null; points?: number }[] {
  const has = (g: GotchaCode) => course.gotchas.includes(g);
  const base = [
    { name: "Quizzes", weightPercent: 20, points: 20 },
    { name: "Assignments", weightPercent: 30, points: 50 },
    { name: "Midterm Exam", weightPercent: 20, points: 100 },
    { name: "Final Exam", weightPercent: 30, points: 150 },
  ];

  if (has("weights_short")) return [...base.slice(0, 3), { ...base[3]!, weightPercent: 20 }];
  if (has("weights_over")) return [...base, { name: "Extra Credit", weightPercent: 10, points: 25 }];
  if (has("weight_missing")) return [...base.slice(0, 3), { ...base[3]!, weightPercent: null }];
  if (has("category_without_items"))
    return [
      { name: "Attendance and Participation", weightPercent: 25, points: 0 },
      { name: "Study Groups", weightPercent: 10, points: 0 },
      { name: "Assignments", weightPercent: 35, points: 50 },
      { name: "Final Exam", weightPercent: 30, points: 150 },
    ];
  return base;
}

/**
 * The schedule table, in one of three layouts.
 *
 * The default prints a date range and a week number per row, which is what BIO 240 and HIS 210
 * do and what makes a document self-calibrating. `grouped_by_category` prints no table at all
 * and lists work by kind instead, which is what leaves a student unable to tell what is next.
 */
function scheduleSection(course: CorpusCourse, term: CorpusTerm): { text: string; expected: ExpectedFamily[] } {
  const has = (g: GotchaCode) => course.gotchas.includes(g);
  const weeks = termWeeks(term);
  const numbers = weekNumbers(term);
  const dash = has("cross_month_range") ? " – " : has("week_range_dates") ? "-" : "–";
  const expected: ExpectedFamily[] = [];

  // The weekday quizzes are given on. Deliberately wrong for `weekday_not_a_class_day`.
  const statedWeekday = has("weekday_not_a_class_day")
    ? [0, 1, 2, 3, 4, 5, 6].find((d) => !course.meetingDays.includes(d) && d !== 0 && d !== 6)!
    : course.meetingDays[0]!;

  const quizDays = classDays(term, course.meetingDays[0]!);
  const rows: string[] = [];
  /**
   * Collected as the rows are written rather than sliced off `quizDays` afterwards.
   *
   * The slice version was wrong for a term starting on a Tuesday: week one holds no Monday
   * class, so `quizDays[0]` is week *two*'s date and dropping it lost one. Building the key
   * from the same loop that writes the text is the only version that cannot drift from it.
   */
  const quizDates: string[] = [];
  let quiz = 0;

  rows.push(`Dates  Week  Topic  Assignments Due`);
  for (let i = 0; i < weeks.length; i++) {
    const monday = weeks[i]!;
    const number = numbers[i];
    const weekdaysOff = [0, 1, 2, 3, 4].filter((k) => inBreak(iso(utc(monday) + k * DAY), term));

    if (weekdaysOff.length >= 5) {
      const name = term.breaks.find((b) => utc(b.startDate) <= utc(monday) + 4 * DAY && utc(b.endDate) >= utc(monday))?.name ?? "Break";
      rows.push(`${weekRange(monday, dash)}  ${number ?? "***"}  ${name}  no class`);
      continue;
    }

    const quizDate = quizDays.find((d) => mondayOnOrBefore(d) === monday);
    let due = "none";
    if (quizDate && i > 0) {
      quiz++;
      quizDates.push(quizDate);
      due = has("title_carries_scope")
        ? `Quiz ${quiz}\nover Chapters ${quiz * 2 - 1}-${quiz * 2}`
        : `Quiz ${quiz}`;
    }
    if (i === 0 && has("note_in_first_row")) {
      // §3.4: a term-wide policy parked in week one's assignment cell, saying the opposite
      // of the column it sits in.
      due = "No Quiz\nAll quizzes are cumulative; a chapter listed for one week may appear in\nany later quiz.";
    }
    rows.push(`${weekRange(monday, dash)}  ${number ?? "***"}  Unit ${i + 1}  ${due}`);
  }

  if (quiz > 0) expected.push({ family: "quizzes", count: quiz, statedDates: quizDates, derived: false });

  const finalsLine = has("registrar_finals_week")
    ? `FINAL EXAM: scheduled by the registrar during finals week, ${weekRange(mondayOnOrBefore(term.finals.startDate), dash)}.`
    : `FINAL EXAM: ${longDate(term.finals.startDate)}`;
  expected.push({ family: "finalExam", count: 1, statedDates: [term.finals.startDate], derived: false });

  /**
   * §5.1: the weekday the document *says* quizzes happen on.
   *
   * For `weekday_not_a_class_day` this is deliberately a day the class does not meet, which is
   * what BIB301 does (meets Tuesday, says quizzes are each Thursday) and HIS 210 does (meets
   * Tue/Thu, says each Friday). Both facts are extractable and nothing compares them, so a
   * student answering the weekday question in good faith dates a whole quiz series to a day
   * they have no class.
   */
  const weekdayLine = `Quizzes are given each ${WEEKDAY_NAMES[statedWeekday]} at the start of class.`;

  if (has("grouped_by_category")) {
    // §3.3: no table. Work listed by kind, with no ordering a student can read forwards.
    return {
      text: `ASSIGNMENTS BY CATEGORY\n\n${weekdayLine}\n\nQuizzes: ${quiz} quizzes are given over the term, one most weeks.\nMidterm Exam: given in class at the midpoint of the term.\nFinal Exam: during the university examination period.\n\n${finalsLine}`,
      expected,
    };
  }

  return { text: `COURSE OUTLINE\n${weekdayLine}\n${rows.join("\n")}\n${finalsLine}`, expected };
}

/** The prose rules: recurring work stated as a sentence rather than listed row by row. */
function proseRules(course: CorpusCourse, term: CorpusTerm): { text: string; expected: ExpectedFamily[] } {
  const has = (g: GotchaCode) => course.gotchas.includes(g);
  const expected: ExpectedFamily[] = [];
  const chunks: string[] = [];

  if (has("rule_not_listed")) {
    // §3.1. The count comes from the calendar, and the calendar has breaks in it.
    const weekday = course.meetingDays.at(-1)!;
    const days = classDays(term, weekday);
    const stated = has("count_not_stated") ? null : days.length;
    chunks.push(
      `HOMEWORK\nA short written response to the assigned reading is due each ${WEEKDAY_NAMES[weekday]} in class.` +
        (stated === null ? "" : ` There are ${stated} responses over the term; the lowest two scores are dropped.`),
    );
    expected.push({
      family: "responses",
      count: stated ?? days.length,
      statedDates: days,
      derived: stated === null,
    });
  }

  if (has("holiday_collision")) {
    // §1.10. A weekly deadline written against a weekday that hits a one-day holiday.
    const weekday = course.meetingDays[0]!;
    const holiday = term.breaks.find(
      (b) => b.startDate === b.endDate && parts(b.startDate).wd === weekday,
    );
    chunks.push(
      `PROBLEM SETS\nProblem sets are due at the beginning of class each ${WEEKDAY_NAMES[weekday]}.` +
        (holiday ? ` Note that ${longDate(holiday.startDate)} is ${holiday.name}.` : ""),
    );
  }

  if (has("category_without_items")) {
    // §2.5. Real weekly work, worth real credit, that appears nowhere in the schedule.
    chunks.push(
      `STUDY GROUPS\nStudents will meet in groups of three outside of class for one hour each week while class is in session. Study group participation is worth 10% of the course grade.`,
    );
  }

  if (has("no_date_at_all")) {
    chunks.push(`SECOND EXAM\nThe date of the second exam will be announced on the course portal.`);
    expected.push({ family: "unscheduledExam", count: 1, statedDates: [], derived: false });
  }

  if (has("no_year")) {
    const d = iso(utc(term.endDate) - 3 * DAY);
    chunks.push(`PORTFOLIO\nThe final portfolio is due ${longDate(d, false)} and is worth 25% of the grade.`);
    expected.push({ family: "portfolio", count: 1, statedDates: [d], derived: false });
  }

  if (has("stale_year")) {
    // §1.1. A year left over from an earlier edition of the same document.
    const d = iso(utc(term.startDate) + 45 * DAY);
    const stale = `${MONTHS[parts(d).m]} ${parts(d).d}, ${parts(d).y - 1}`;
    chunks.push(`MIDTERM\nThe midterm examination will be held in class on ${stale}.`);
    expected.push({ family: "midterm", count: 1, statedDates: [d], derived: false });
  }

  if (has("conflicting_dates")) {
    // §1.6. The schedule table and the prose disagree by a day, which is not a duplicate.
    const a = iso(utc(term.endDate) - 10 * DAY);
    const b = iso(utc(term.endDate) - 9 * DAY);
    chunks.push(
      `TERM PAPER\nThe term paper is due ${longDate(a)}. Late papers lose 10% per day.\nSee also the course outline, which lists the paper on ${shortDate(b)}.`,
    );
    expected.push({ family: "termPaper", count: 1, statedDates: [a, b], derived: false });
  }

  if (has("described_twice")) {
    // §3.2. The same item in two places with different facts in each, neither complete.
    chunks.push(
      `RESEARCH PROJECT\nEach student completes a research project. The project is described in the schedule as "Project" and here in full: 8-10 pages, double spaced, with at least five sources.`,
    );
    expected.push({ family: "project", count: 1, statedDates: [], derived: false });
  }

  if (has("policy_cliff")) {
    // §5.4. A grade consequence that is not a date and not a weight.
    chunks.push(
      `ATTENDANCE POLICY\nIf you miss more than six class meetings, excused or unexcused, you will fail the course regardless of your other work.`,
    );
  }

  return { text: chunks.join("\n\n"), expected };
}

/** Compose one syllabus and the key that goes with it. */
export function buildCorpusSyllabus(course: CorpusCourse): CorpusSyllabus {
  const term = CORPUS_TERMS.find((t) => t.key === course.termKey)!;
  const weights = weightsFor(course);
  const schedule = scheduleSection(course, term);
  const prose = proseRules(course, term);

  const pages: SyllabusPage[] = [
    {
      page: 1,
      text: `RIVERBEND COLLEGE\n${course.code}: ${course.name}\nSyllabus ${term.name}\nInstructor:  Staff\nEmail:  staff@example.edu\n${meetingLine(course)}\nDates of instruction:  ${longDate(term.startDate)} – ${longDate(term.endDate)}\nCredits:  ${course.credits} semester hours\n\nCOURSE DESCRIPTION\nAn introduction to the subject, its methods, and its place in the wider curriculum. Students\nwill develop the ability to read critically, argue clearly, and work independently.\n\n${gradingSection(course, weights)}\n\n${gradingScale()}`,
    },
    { page: 2, text: `${prose.text}\n\n${BOILERPLATE}` },
    { page: 3, text: schedule.text },
  ];

  return {
    course,
    term,
    pages,
    expected: [...schedule.expected, ...prose.expected],
    expectedWeights: weights.map(({ name, weightPercent }) => ({ name, weightPercent })),
    statedWeightTotal: weights.reduce((s, w) => s + (w.weightPercent ?? 0), 0),
  };
}

/** The whole corpus: forty syllabuses across eight terms. */
export const SYLLABUS_CORPUS: CorpusSyllabus[] = CORPUS_COURSES.map(buildCorpusSyllabus);

/** Every gotcha the corpus exercises, and how many documents carry each. */
export function corpusCoverage(): Map<GotchaCode, number> {
  const counts = new Map<GotchaCode, number>();
  for (const course of CORPUS_COURSES) {
    for (const g of course.gotchas) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
}
