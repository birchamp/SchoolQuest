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

/**
 * Inlined rather than imported from JSON.
 *
 * `import ... with { type: "json" }` parses under vitest and fails under the Worker build —
 * esbuild 0.21 does not accept import attributes, and this package is in the Worker bundle
 * through planning-engine. The failure only appeared on `wrangler dev`, which is the reason
 * the real server gets started rather than trusted.
 */
export const REAL_DATE_STRINGS: RealDateStrings = {
  "ranges": [
    {
      "src": "ncsu_math241_spring2022",
      "raw": "April 28 – May 4"
    },
    {
      "src": "ncsu_math241_spring2022",
      "raw": "Mar 14-\n\nMar 18"
    },
    {
      "src": "ncsu_math241_spring2022",
      "raw": "Apr 26-\n\nApr 27"
    },
    {
      "src": "ncsu_math241_spring2022",
      "raw": "Apr 28-\n\nMay 4"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "January 13–16"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "January 17–23"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "January 24–30"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "January 31–February 6"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "February 7–13"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "February 14–20"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "February 21–27"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "February 28–March 6"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "March 7–13"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "March 14–20"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "March 21–27"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "March 28–April 3"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "April 4–10"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "April 11–17"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "April 18–24"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "April 25–May 1"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "May 2–8"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "May 9–13"
    },
    {
      "src": "cf_sls1122_fall2022",
      "raw": "Aug. 15 - Dec. 8"
    },
    {
      "src": "cf_sls1122_fall2022",
      "raw": "Nov. 23-27"
    },
    {
      "src": "cf_sls1122_fall2022",
      "raw": "Dec. 2-4"
    },
    {
      "src": "cf_sls1122_fall2022",
      "raw": "Dec. 2-8"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "January 17–22"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Jan 23-Feb 3"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "January 23–29"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "January 30–February 5"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "February 6–12"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "February 13–19"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "February 20–26"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "February 27–March 5"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "March 6–12"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "March 13-19"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "March 20–26"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "March 27–April 2"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "April 3–9"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "April 10–16"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "April 17–23"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "April 24–30"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "May 1–7"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "May 8–13"
    },
    {
      "src": "unc_geog062_spring2023",
      "raw": "Mar 13-17"
    },
    {
      "src": "tamuc_chem1305_fall2024",
      "raw": "December 12-16"
    },
    {
      "src": "tamusa_engl1300_spring2025",
      "raw": "Mar. 10th-15th"
    },
    {
      "src": "tamusa_engl1300_spring2025",
      "raw": "May 7th-13th"
    }
  ],
  "weekHeaders": [
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 0, January 13–16"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 1, January 17–23"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 2, January 24–30"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 3, January 31–February 6"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 4, February 7–13"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 5, February 14–20"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 6, February 21–27"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 7, February 28–March 6"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 8, March 7–13"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 9, March 14–20"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 10, March 21–27"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 11, March 28–April 3"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 12, April 4–10"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 13, April 11–17"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 14, April 18–24"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 15, April 25–May 1"
    },
    {
      "src": "richland_math122_spring2022",
      "raw": "Week 16, May 2–8"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 1, January 17–22"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 2, January 23–29"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 3, January 30–February 5"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 4, February 6–12"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 5, February 13–19"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 6, February 20–26"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 7, February 27–March 5"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 8, March 6–12"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 9, March 13-19"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 10, March 20–26"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 10, March 27–April 2"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 11, April 3–9"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 12, April 10–16"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 13, April 17–23"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 14, April 24–30"
    },
    {
      "src": "richland_math104_spring2023",
      "raw": "Week 15, May 1–7"
    }
  ],
  "numericDates": [
    {
      "src": "uf_sta2023_fall2021",
      "raw": "8/23"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "8/31"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "8/25"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "8/27"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "8/30"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/01"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/02"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/03"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/07"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/06"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/08"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/09"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/10"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/13"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/14"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/15"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/16"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/17"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/20"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/21"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/22"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/23"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/24"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/27"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/28"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/29"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "9/30"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/01"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/04"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/06"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/11"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/08"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/12"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/13"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/14"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/15"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/18"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/19"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/20"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/21"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/22"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/25"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/26"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/27"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/28"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "10/29"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/01"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/02"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/03"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/04"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/05"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/08"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/10"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/11"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/12"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/15"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/16"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/17"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/18"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/19"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/29"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/22"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/24"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/26"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "11/30"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "12/01"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "12/02"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "12/03"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "12/06"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "12/08"
    },
    {
      "src": "uf_sta2023_fall2021",
      "raw": "12/11"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "1/19"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "1/21"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "1/24"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "1/25"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "1/26"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "1/28"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "1/31"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/1"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/2"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/4"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/7"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/8"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/9"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/11"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/14"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/15"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/16"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/18"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/21"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/22"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/23"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/25"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "2/28"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/2"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/4"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/7"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/8"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/9"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/11"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/21"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/22"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/23"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/25"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/28"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/29"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "3/30"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/1"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/4"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/6"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/8"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/11"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/12"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/13"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/15"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/18"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/19"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/20"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/22"
    },
    {
      "src": "illinois_mse304_spring2022",
      "raw": "4/25"
    }
  ]
};
