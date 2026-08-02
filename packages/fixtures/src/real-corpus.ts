import strings from "./real-corpus/date-strings.json" with { type: "json" };

/**
 * Every date string twenty real syllabuses actually print, harvested verbatim.
 *
 * Twenty documents from eighteen institutions — UF, OU, Rutgers, WKU, Georgia Tech, Illinois,
 * NC State, Richland, College of Central Florida, Houston Law, TAMUT, UNC, Washburn, CCSNH,
 * TAMUC, Pitt, TAMUSA and Utah — across eight terms from Fall 2021 to Spring 2025.
 *
 * Only the strings are kept, not the documents: this is what the parsers have to cope with, and
 * a parser test does not need the surrounding prose. Nothing here is tidied. The line breaks
 * inside `"Mar 14-\n\nMar 18"` are what NC State's schedule table really produces through
 * pdf.js, and that string is the reason `parseDateRange` now collapses whitespace.
 *
 * The three real syllabuses in `syllabus-pages.ts` are still the corpus for *discovering*
 * gotchas — they are whole documents with their contradictions intact. This is narrower and
 * answers one question: does the arithmetic work on more than one institution's house style?
 * It did not. It parsed 0 of 50.
 */
export interface RealDateString {
  /** The document it came from, for tracing a failure back to a page. */
  src: string;
  raw: string;
}

export interface RealDateStrings {
  /** Month-day ranges: "January 13–16", "Mar. 10th-15th", "April 28 – May 4". */
  ranges: RealDateString[];
  /** Schedule-table week headers: "Week 0, January 13–16". */
  weekHeaders: RealDateString[];
  /** Numeric dates: "01/02/24", "12/06", "11/29". */
  numericDates: RealDateString[];
}

export const REAL_DATE_STRINGS = strings as RealDateStrings;
