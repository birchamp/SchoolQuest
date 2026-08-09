# Field guide: what real syllabi actually do

Every entry here comes from a real syllabus that broke a reasonable assumption. This is the
distilled version of a running log kept while building a syllabus-ingestion pipeline against
a corpus of ~28 real documents from ~20 institutions. Read it before extracting; check
against it before delivering.

The recurring meta-lesson: **three documents from one institution cannot establish a
convention.** A date parser validated against three same-school syllabi parsed 0 of 50 date
ranges from the wider corpus, because that school happened to print four-digit years and
almost nobody else does. Hold every "syllabi always..." belief loosely.

## 1. Dates

- **Stale years are the single most common defect.** The file is edited year to year and
  the dates are prose. "Mid-term Exam on October 31, 2025" in a term running Aug-Dec 2026;
  a paper due "on or before October 5, 2023" while the same document's schedule table says
  October 2026. Never auto-correct: the stated year may be stale, or it may be right and
  your correction wrong. Ask.
- **Schedule rows rarely repeat the year.** "January 13-16", "Mar. 10th-15th" (ordinals),
  ranges wrapped mid-range by the PDF ("Mar 14-\n\nMar 18"). The year lives in the document
  header. Supply it from the term; carry a Dec-Jan range into the next year. A range that
  spans two months states the second month explicitly ("Sept. 29 - Oct. 2").
- **Finals sit after the last day of instruction.** Every syllabus does this. "Dates of
  instruction: August 25 - December 11" ... "FINAL EXAM Dec. 15". Do not flag finals as
  outside the term.
- **The registrar sets the finals day, so the syllabus gives a week.** "The final exam is
  scheduled by the registrar for finals week, December 14-18." Nobody knows the day yet,
  including the instructor -- this is not an ambiguity to resolve but a fact that has not
  happened. Date it to the first day of the window, label it registrar-set, and route the
  real question to the instructor. Never let a weekday answer about *other* items date it.
- **Weekly work is dated by the week it falls in, not by a day.** "Aug. 25-28, 2026 ...
  QUIZ 1"; "Problem Set 1 due Week 3". The weekday is stated once, in prose, somewhere
  else entirely. One clarifying question ("what day are these due?") dates the whole
  series -- then verify the answer against the meeting pattern (see section 5).
- **The same item dated twice, differently, in the same document.** Schedule table says
  December 4, grading section says December 4 *2025*, or Dec 10 vs Dec 11. This is not a
  duplicate -- it is the syllabus contradicting itself. Show both, with sources; the
  schedule table is usually (not always) the better authority.
- **Some items have no date at all**, honestly: "The date of Exam 2 will be announced on
  the course portal." Keep the item, leave it undated, put it on the instructor question
  list. In one real corpus 8 of 61 items were like this.
- **A due *time* is almost never stated.** End-of-day is an assumption, not a reading;
  note it once rather than flagging every item.
- **Recurring work can land on a single-day holiday.** "Due Week 3 at the beginning of
  class" where week 3's Monday is Labor Day: there is no class for it to be due at. This
  is only visible if the calendar is stored by day, not by week.
- **Things that look like dates and are not**: literal placeholders the instructor never
  filled in ("Feb xx/16"); windows ("any time between May 10 and May 13" -- which end?);
  assigned/due pairs in one cell ("Feb 21/28 [assigned/due]"); an assignment date with no
  due date ("assigned April 27"). Each needs its own question, not a generic weekday one.

## 2. Grading weights

- **Weights that do not sum to 100 are three different faults.** Short of 100 (25+40+15+10
  = 90): a category is *missing* -- ask what makes up the rest, because work the student
  is never shown is the cost. Over 100: possibly double-counted, possibly extra credit,
  which is not a fault at all -- ask before alarming. A category with *no printed number*:
  the silent one -- do not filter it out before summing, or "Exams 50%, Papers 50%,
  Participation" passes clean. Allow ±1 tolerance so three 33.3% categories don't fire a
  false alarm; false alarms teach readers to ignore the real one.
- **Some courses grade in points, not percentages.** "Class Participation: maximum of 20
  points; Midterm: 40 points; Final: 40 points" is a complete scheme. Convert to shares
  only when *every* category states points and *none* states a percentage; a document
  using both units is contradicting itself -- surface that rather than averaging. Announce
  the conversion ("graded out of 100 points, shown here as percentages").
- **Weights may be glued to the end of prose paragraphs.** Some syllabi have no grading
  table at all -- just four numbered paragraphs each ending in a bare "30%". Look for
  trailing percentages anywhere requirements are described.
- **A category can exist with no schedulable items.** "Attendance & Participation 25%"
  schedules nothing and that is correct. But "Study Teams ... one hour each week ... 10%"
  is real recurring work hiding in the same shape -- read the sentence, not just the
  weight. Represent committed weekly effort in the schedule.
- **Counts are derived, not stated.** "Quizzes will be given each Thursday" -- how many?
  Count the qualifying days on the calendar. A drop rule ("lowest grade dropped") changes
  what each is worth without changing the count; record it in the grading table.
- **The grading list's own numbering can be broken** (two items numbered 4, no item 3).
  Never trust ordinals for structure; count the items themselves.

## 3. Where the work is written down

- **Recurring work stated as a rule collapses to nothing if you only read tables.** "A
  weekly fitness log is due each Sunday by 9:00 pm ... There are 14 logs." In one real
  course this form carried 40% of the grade. Expand rules into dated instances by
  arithmetic; skip instances falling in breaks and say you did.
- **"At every class meeting" is not a weekly rule.** "A short quiz at the start of every
  class" in a class meeting twice a week is two quizzes a week, and "which day is it
  due?" has no correct answer -- the answer is both. Take the days from the stated
  meeting pattern, and number the occurrences in date order *across* the days: expanding
  one weekday at a time makes "Quiz 2" the second Monday instead of the first Wednesday,
  so every number the student reads names the wrong day. A syllabus that never states its
  meeting times leaves this genuinely unanswerable -- those instances stay undated,
  because an admitted gap beats an invented weekday.
- **When prose states a rule and the schedule enumerates the items, the schedule wins.**
  The same syllabus that says "a quiz at the start of every class" can show, in its own
  table, quizzes that run weekly at first, skip some weeks, and sometimes fall on the
  second class day. The rule is a summary of an irregular reality; expanding it fills the
  term with confident wrong dates -- strictly worse than a question, because a wrong date
  looks like an answer and nothing contradicts it. Where two or more *dated* items share
  a base title ("Quiz 1", "Quiz 3"), do not expand the rule: the rows are the truth, and
  prose-vs-table disagreement here is the normal case, not a contradiction to flag. One
  dated row is not enough to suppress expansion -- a lone "Quiz 1" is as likely an
  example as a schedule.
- **Everything important is described twice**: a schedule-table row (date, terse title)
  and a grading-section paragraph (length, topic, rubric, often a different date).
  Neither is complete. Merge into one item carrying both sets of facts; flag date
  conflicts rather than picking silently.
- **Titles encode scope, not identity.** "QUIZ 1 OVER DISM Intro & Ch. 1" -- the covered
  material is part of the title. Separate the name (Quiz 1) from the scope (what it
  covers) or the same quiz will appear as two different items.
- **A term-wide policy can be parked in the first schedule row.** A week-1 cell reading
  "No Quiz / All Quizzes are Accumulative, even though a specific chapter is listed..."
  is half schedule entry, half policy applying to all thirteen quizzes -- and it says the
  *opposite* of the column it sits in. Read cells for what they say, not where they sit.
- **Week numbering around breaks is inconsistent even within one document.** Real syllabi
  number Research Week 8 and then give Thanksgiving no number at all, so printed week
  numbers drift from elapsed weeks partway through the term -- and no single
  counts-breaks/skips-breaks setting can be right for such a document. The fix:
  **calibrate per document** from rows that pair a week number with a date range; those
  pairings are stated facts. A document that numbers its break ("spring break is week 9")
  also anchors its own week 1. Only when the document never pairs them is "do break weeks
  count?" an honest question. Weeks before the first break are never ambiguous.

## 4. What extraction does to the text

If the input is a PDF (or OCR), the text you receive has been flattened:

- **Table rows arrive as separate lines in column order**, with dates split across line
  breaks and nothing marking where one row ends and the next begins. Reconstructing rows
  is a reading-comprehension task; do it from meaning, not position.
- **A trailing bare integer after a date range is the week-number column** ("September
  1-4, 2026  2"), not a day. Conversely, never read a bare number as a week reference.
- **Dash variants everywhere**: en dash, em dash, non-breaking hyphen, "Sept. 8- 11" with
  a space on one side. Treat them all as range separators.
- **Two-column layouts interleave** ("98-100 A+  73-77 C" -- a grading scale reading as
  nonsense). Recognize the pattern before parsing the content.
- **Ligatures shatter**: "every e ff ort". Harmless in prose, fatal to exact quote
  matching -- one reason quote verification should tolerate small noise but not word
  salad.

## 5. Contradictions between sections

- **The stated quiz weekday vs the meeting pattern.** "Course schedule: Tuesday" ...
  "Quizzes will be given each Thursday." One of them is wrong and the document cannot
  tell you which. Always cross-check any resolved weekday against the meeting days --
  it is the single highest-value validation, and it also catches a subtler failure: a
  real date paired with the wrong item (evidence checks cannot see that; a
  day-of-week-vs-meeting-pattern check can).
- **Page one may name the wrong course.** A copy-paste leftover: "Family Law | Spring
  2023 | ... | Community Property | Fall Semester 2022" -- a different course and an
  earlier term in the same header. Prefer the identity consistent with the schedule
  table's dates.
- **Policies stated as grade consequences** ("miss more than 7 classes and you fail",
  "late work not accepted beyond one week, no exceptions") are cliffs, not dates or
  weights. They are the easiest thing to extract and then silently drop. They must
  appear in the output where the student will see them.

## 6. Failures of the reading itself

These are defects in the reader, not the document -- the ones a careful process exists to
prevent:

- **An invented assignment quoted in words the page really contains.** Every word of
  "Feb 14 Problem session Homework 1.3 Hydrostatic Force Review Test 1" appeared on the
  page; the assignment did not exist. A quote is only evidence if it is one *continuous*
  run of text. Words gathered from across a dense schedule page and assembled prove
  nothing -- on a page full of month names and assignment nouns, any word salad "matches".
- **A real quote paired with the wrong fact.** Evidence "Feb 21 Test 2", verbatim; due
  date reported Feb 18. Quote verification passes it. The defense is cross-checking
  (weekday vs meeting pattern, date vs the week the row sits in), not better quote
  matching.
- **Confidence laundering.** A student's answer to one question ("problem sets are due
  Mondays") must not upgrade items it merely brushed against -- in one real case it dated
  a registrar-scheduled final to a Monday at the highest confidence level. An answer
  applies only to items it is actually *about*, and derived dates stay derived.
- **Guessing instead of leaving blank.** A yearless range with no term context, an item
  with no date: returning nothing is correct. Inventing a plausible value is the one
  unrecoverable failure, because it looks exactly like success.
