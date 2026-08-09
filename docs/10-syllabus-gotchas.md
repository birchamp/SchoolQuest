# Syllabus gotchas: a running log

A syllabus is not a data format. It is a document a person wrote once, edited over several
years, and printed through a word processor into a PDF that a text extractor then flattens into
one column. Every entry here is something a **real syllabus actually does** that breaks a
reasonable assumption about how coursework is described.

This is a log, not a spec. Add to it whenever a new one turns up. The rules:

- **Quote the source.** An entry without verbatim text from a syllabus is a hunch, and hunches
  have already cost this project one design document built on a failure that never happened.
- **Say where it was seen.** `LAN 200` / `BIB301` / `BIB 199` are three real anonymized Fall
  2026 syllabi (`packages/fixtures/src/syllabus-pages.ts`). `BIO 240` / `HIS 210` / `MAT 205` /
  `ENG 230` / `PED 110` are the five constructed ones (`fake-semester.ts`), where the oddities
  are planted deliberately and each one is a copy of something seen in the wild.
- **Say what the app does about it today** — handled, partial, or open. An entry with no status
  is a bug report nobody has triaged.
- **Say what it costs the student**, not what it costs the parser. "The date is ambiguous" is a
  parser problem. "They turn up on the wrong day for a final worth 30%" is the reason to care.

Status vocabulary: **HANDLED** (there is code and a test) · **PARTIAL** (detected, surfaced,
not resolved) · **OPEN** (nothing sees it yet).

---

## 1. Dates

### 1.1 A stale year left over from an earlier version — **HANDLED**

The single most common defect in a real syllabus, because the file is edited year to year and
the date strings are prose.

> "Mid-term Exam on October 31, **2025**" — LAN 200, in a term running Aug–Dec 2026
> "Dec. 16-19, **2025**  16" — LAN 200, the finals row
> "present it to the professor for approval on or before October 5, **2023**" — BIB301, in a
> syllabus whose own schedule table puts topic approval in October 2026

What it costs: a whole exam disappears from the plan, or lands eleven months early where
nothing will ever schedule it.

Handled by `DATE_OUTSIDE_TERM` and `DATE_YEAR_MISMATCH` in `validate.ts`. The year check is
deliberately *not* resolved automatically — the stated year may be the stale one or the model
may have "corrected" a year that was right, so the student is asked which.

### 1.2 Finals sit after the last day of instruction — **HANDLED**

> "Dates of instruction: August 25 – December 11, 2026" … "Dec. 15, 2026  16 / Finals Week /
> FINAL EXAM" — BIB301

Every one of the eight syllabuses does this. A naive "is this date inside the term" check flags
every final exam in the corpus as suspicious.

`FINALS_GRACE_DAYS = 21` in `resolve-dates.ts` for a term with no calendar. A term that has
supplied `finalsStartDate`/`finalsEndDate` uses those instead, which is exact rather than
approximately right — a school whose finals do not start the Monday after classes stop is not
served by a flat 21 days.

### 1.3 The registrar sets the finals day, so the syllabus gives a week — **HANDLED**

> "The final exam is scheduled by the registrar for finals week, **December 14-18, 2026**." —
> MAT 205

Nobody knows the day yet, including the instructor. This is not an ambiguity to resolve; it is
a fact that has not happened.

What it cost before the fix: the student answered a weekday question about *problem sets*, and
that answer dated the final exam to a Monday at `confirmed` confidence. See
`docs/09-syllabus-ingest-passes.md`. Now the item is dated to the **first day of the window** —
the only day you can prepare against and still be ready for the other four — marked
`DATE_SET_BY_REGISTRAR`, and a question is raised for the instructor.

### 1.4 Weekly work is dated by the week it falls in, not by a day — **HANDLED**

> "Aug. 25-28, 2026  1 … QUIZ 1" — LAN 200
> "Sept. 29 – Oct. 2, 2026 … Quiz 5" — BIB 199
> "Problem Set 1 due Week 3, Problem Set 2 due Week 5" — MAT 205

All eight syllabuses schedule recurring work this way. The weekday is stated once, in prose,
somewhere else entirely, and joining the two is a two-step inference the extractor is forbidden
to make.

`resolveWeekdayForClaim` plus one clarification question the student answers once. Thirteen
quizzes get dated by one click.

### 1.5 A week range that spans two different months — **HANDLED**

> "Sept. 29 – Oct. 2, 2026  6" — LAN 200
> "April 28 – May 4" — NC State MATH 241 *(no year — see below)*

`parseDateRange` reads the second month when it is given and carries a Dec→Jan range into the
next year.

### 1.5a A schedule row does not repeat the year — **HANDLED, after being wrong**

> "January 13–16" · "January 31–February 6" — Richland MATH 122
> "Mar. 10th-15th" · "May 7th-13th" — TAMUSA ENGL 1300 *(ordinals)*
> "Mar 14-\n\nMar 18" — NC State MATH 241 *(wrapped mid-range by the PDF)*

The year is in the document header, not in every row. Almost no schedule table repeats it.

**This entry is here because §1.5, §4.1 and §4.4 were all marked HANDLED on evidence that could
not support them.** `parseDateRange` required a four-digit year. Run against **twenty real
syllabuses from eighteen institutions it parsed 0 of 50 ranges** — not a regression, it had
never worked outside one house style. The three syllabuses it was validated against all came
from the same institution and all happened to print years.

§1.3's registrar-finals branch was collateral: `resolveWeekdayForClaim` reaches it only through
a successful `parseDateRange`, so on real documents it was structurally unreachable, and the
corpus is full of exactly the case it exists for — *"Final Exam: April 28 – May 4"*, *"Finals
week is December 12-16"*, *"TBD, Week of December 12th"*.

The year is now optional and supplied by the caller from the term's own start year; a yearless
range with no context still returns null, because inventing one is the guess this module
refuses. Pinned by `real-corpus.test.ts`, which runs the parsers over every date string the
corpus prints rather than over hand-picked examples.

**The general lesson, which is the reason this entry is kept rather than folded into §1.5:** a
corpus of three documents from one source cannot establish a convention, and four log entries
said HANDLED on exactly that.

### 1.6 The same item dated twice, differently, in the same document — **PARTIAL**

> Schedule table: "Research Paper due December 4, 2026"
> Grading section: "due on or before December 4, **2025**" — HIS 210
> Schedule: position paper December 10; grading section: "DUE ON OR BEFORE December 11, 2026" —
> BIB 199

Two dates for one thing is *not* a duplicate — it is the syllabus contradicting itself, and
collapsing the two cases would hide the more important one.

`CONFLICTING_DATE_FOR_SAME_ITEM` is raised and the student is asked. Partial because nothing
prefers the schedule table over prose, which is the convention most instructors actually follow.

### 1.7 A date with no year at all — **PARTIAL**

> "The portfolio is due December 9" — ENG 230

Flagged `AMBIGUOUS_DATE` with a question. Partial: for a term that does not cross a year
boundary the year is genuinely inferable, and asking is more caution than the case needs.

### 1.8 No date anywhere — **PARTIAL**

> "The date of Exam 2 will be announced on the course portal." — MAT 205

Honest and unschedulable. The item is kept, flagged `MISSING_DATE`, and left undated rather
than guessed. 8 of 61 items in the fixture semester are here. Partial: it is surfaced but the
instructor-facing question is not generated yet — that is the next piece of work.

### 1.9 A due *time* is almost never stated — **HANDLED**

Only PED 110 says "by 9:00 pm". Everything else gives a day. `TIME_NOT_STATED` records that
end-of-day is an assumption rather than a reading.

---

## 2. Weights, points, and how a grade is built

### 2.1 The weights do not add up to 100 — **HANDLED**

> Laboratory Reports 25% · Exams 40% · Quizzes 15% · Participation 10% = **90%** — BIO 240

Ten per cent of the grade is unaccounted for and the document does not say so.

This entry read as one fault and is three, with three different costs. Probing the validator
across the shapes showed it was reporting the least useful thing about each — and missing the
most important one entirely.

| Shape | What it means | What it costs |
| --- | --- | --- |
| **Short of 100** (BIO 240, 90%) | A category is *missing* from the list | Work the student is never shown |
| **Over 100** (e.g. 115%) | Something is double counted — or one of them is extra credit, which is not a fault at all | A skewed standing, or a false alarm |
| **A category with no weight** | The number was never printed | Everything the other two cost, invisibly |

The third was **silent**. A null weight was filtered out before summing, so a syllabus reading
"Exams 50%, Papers 50%, Participation" — no number beside participation — totalled 100 and
passed without a word.

Worse than a plain miss: `course-health.ts` *does* check for missing weights and raises
`GRADE_STRUCTURE_INCOMPLETE`. So the student was told, weeks later, from the dashboard —
rather than at ingest, at the one moment they are looking at the syllabus and could still fix
it. Two layers disagreeing, and the earlier one was the weaker.

All three now produce distinct warnings and distinct questions. Short of 100 asks *"What makes
up the other 10% of your grade?"*, because the actionable fact is a missing category, not a
suspect arithmetic. A ±1 tolerance keeps three categories of 33.3% from being reported as a
defect — a warning that fires on correct input trains the student to ignore the one that
matters.

**Also removed:** `CATEGORY_WEIGHTS_DO_NOT_SUM` was declared in the `ClaimIssue` union and
given a label in the review UI's `ISSUE_TEXT`, and **nothing ever raised it**. The same
pattern as §5.4 — code that looks handled from every angle except the one that matters. The
warning and question path is what actually reaches the student, so the dead member is gone.

### 2.2 The weight is glued to the end of a prose paragraph — **OPEN**

> "3. Quizzes: Each Wednesday there will be a quiz for each chapter of the textbook. Quizzes are
> cumulative and may include vocabulary, translation, and grammatical questions. **30%**" —
> LAN 200

There is no grading *table* in LAN 200 at all. The weights are trailing numbers at the end of
four numbered paragraphs, and one of them ("…attend all classes. 20%") sits after a sentence
about failing the course for absences. A reader looking for a table finds nothing.

### 2.3 A course graded in points, not percentages — **HANDLED**

> "Grading: … Course grades will be based upon a point system. Your grade will be based upon:
> • Class Participation: **Maximum of 20 points**; • Midterm / Project: **Maximum of 40
> points**; • Final Examination: **Maximum of 40 points**." — Washburn, Family Law

This entry sat OPEN for a day with the note *"Wanted: a real syllabus doing this, to seed the
fixture with."* A corpus of twenty real syllabuses arrived with two.

20/40/40 of a hundred is a complete grading scheme, stated as plainly as any percentage table.
The category schema had nowhere to put points, so it came back as three nulls and the student
was told **"No weight was found for Class Participation, Midterm / Project, Final Examination.
The rest add up to 0%"** — a false alarm on a document that states everything.

Categories now carry `pointsPossible`, and the share is computed **only when every category
states points and none states a percentage**. A document giving both is describing the same
grade twice in two units that need not agree; averaging them would hide a contradiction worth
surfacing, so the stated percentages are left alone and the missing ones still reported.

The derivation is announced rather than silent — *"This course is graded out of 100 points
rather than percentages"* — because a student seeing "40%" beside a syllabus that says "40
points" deserves to know which they are looking at.

**Still wanted:** a syllabus using *both* units for different categories, which the corpus does
not have and which is the case the refusal above is written for.

### 2.4 Nothing states how many of a recurring thing there are — **PARTIAL**

> "Quizzes will be given each Thursday throughout the semester" — BIB301, and the schedule
> table lists thirteen

The count has to be derived from the calendar, and a drop rule ("the lowest grade will be
dropped", BIB 199) changes what the total is worth without changing the count.
`expandRecurrence` handles the count-from-calendar case; the drop rule is captured but nothing
downstream uses it.

### 2.5 A category exists in the grading section with no items in the schedule — **OPEN**

> "Attendance & Class Participation 25%" — BIB301, BIB 199, LAN 200 (as "Attendance and
> Participation 20%")
> "Study Teams … one hour each week … 10%" — LAN 200

A quarter of the grade with nothing to schedule against it.

The study-teams one is worse than inert. Read the sentence: it is **one hour of committed work
every week for the whole term**, worth 10%, and the only shapes the extractor has to put it in
are "a grading category" (a weight with no items, scheduling nothing) or "an assignment" (one
item, once). Neither is a weekly hour. It is real work with a real weight and the data model has
nowhere to keep it.

Attendance is the same shape and the opposite conclusion — it needs no study time at all, so a
category with no items is exactly right for it. Telling the two apart is the open question.

---

## 3. Where the work is written down

### 3.1 Recurring work stated as a rule instead of listed — **HANDLED**

> "A weekly fitness log is due each Sunday by 9:00 pm … There are 14 logs" — PED 110
> "A short response to the assigned reading is due each Tuesday in class." — ENG 230

Work in a schedule table came through perfectly; work stated as a sentence collapsed to a single
undated item. That was **28 of 84 pieces of work** — 40% of one course's grade and 15% of
another's — arriving on screen as two small things.

`expandRecurrence` turns the rule into instances, and the dates are computed rather than
generated because counting Tuesdays between two dates is arithmetic.

### 3.2 The same assignment described in two places, in two ways — **PARTIAL**

Every one of the eight syllabuses does this. The schedule table has the row; the grading section
has the paragraph with the length requirement, the topic, the rubric reference and often a
different date. Neither is complete.

Currently produces two claims and a `DUPLICATE_OF_EARLIER_CLAIM` or a conflict. It should
produce one item with both facts merged.

### 3.3 Work grouped by category rather than ordered by date — **OPEN**

The grading section is organised by *kind* — all the quizzes, then the paper, then the exam —
while the schedule table is organised by *week*. A student reading the grading section has no
idea what is due next; a student reading the table has no idea what anything is worth.

Reconciling the two is precisely what this app is for, and the reconciliation is currently
"whatever order the model emitted".

### 3.4 A note that applies to every row, parked in the first row — **OPEN**

> "Aug. 25-28, 2026  1 … **No Quiz** / All Quizzes are Accumulative, even though a specific
> chapter is listed for quiz any previous chapters can be found in the quiz for that week." —
> LAN 200

A cell that is half a schedule entry and half a term-wide policy. Read as an assignment it is a
quiz called "All Quizzes are Accumulative"; read as a policy it belongs to all thirteen. It also
says the *opposite* of the column it sits in: the "Assignments Due" cell for week 1 says there
is no assignment.

### 3.5 A title that encodes scope, not identity — **PARTIAL**

> "QUIZ 1 OVER DISM Intro & Ch. 1" — BIB301
> "Quiz 3 / Over Introduction to Patterson's Book, Chapter 1 of Revelation, and comments by
> Patterson" — BIB 199

The reading it covers is in the title, spanning several lines. Titles come through long and the
covered material is not separated from the name, so `Quiz 3` and `Quiz 3 Over Chapters 2 & 3`
do not match each other across sections.

### 3.6 A break stops the week count, and week-N resolution did not — **HANDLED**

> "Oct. 13, 2026 / **Research Week** / 8 / *** / ***" — BIB301 *(numbered)*
> "**Thanksgiving Break** / Nov. 24, 2026 / *** / NONE / ***" — BIB301 *(not numbered)*
> "Nov. 23-27, 2026  Thanksgiving Break  no class" then "Nov. 30-Dec. 4, 2026  **14**" — BIO 240
> "Nov. 24, 2026  Thanksgiving Break  no class Thursday" then "Dec. 1 & 3, 2026  **14**" — HIS 210

Break rows are in the table, and whether they consume a week number is entirely up to the
person who wrote it. BIB301 numbers Research Week 8 and then gives Thanksgiving no number at
all — **inconsistent within a single document**.

`rangeForWeekNumber` counts Monday-anchored weeks from the term start. That is right for a
syllabus that numbers its breaks and wrong for one that skips them, and there is no way to tell
which from the week number alone.

**This was not hypothetical. It had already mis-dated real work.** MAT 205 says "Problem Set 6
due Week 14", and the ingested semester carried:

```
Problem Set 1 | raw "Week 3"  -> 2026-09-07
Problem Set 2 | raw "Week 5"  -> 2026-09-21
Problem Set 3 | raw "Week 7"  -> 2026-10-05
Problem Set 4 | raw "Week 10" -> 2026-10-26
Problem Set 5 | raw "Week 12" -> 2026-11-09
Problem Set 6 | raw "Week 14" -> 2026-11-23   <- Thanksgiving week
```

Five of six are right, because they all fall before the break. The sixth is a week early, due
"at the beginning of class" in a week with no class. Both other courses in the same term put
week 14 at 30 November. Nothing flags it.

**Fixed by making the term calendar a prerequisite** (`termCalendar` on the term,
`academic-weeks.ts`). Knowing the break turns one guess into two derivable readings:

- `breaksTakeWeekNumbers: false` — Problem Set 6 resolves to **30 November**, matching what
  both other courses in the same term print. Verified through the running Worker.
- `breaksTakeWeekNumbers: true` — 23 November, which is right for BIB301's Research Week.
- `null`, nobody has said — the date is still planned from the instructional reading, but it
  carries `WEEK_NUMBER_AMBIGUOUS`, drops to `low_inference`, and says so on screen: *"Week 14"
  is after a break. Counting break weeks gives 2026-11-23; not counting them gives 2026-11-30.*

Only weeks after the term's first break can be ambiguous, so weeks 1–12 stay clean.

---

## 4. What the PDF does to the text

Everything below is `pdf.js` flattening a table, and it is what the extractor actually receives.

### 3.7 A syllabus's week numbers are wrong by its own convention — **PARTIAL**

Not "two conventions exist" (§3.6). One document using **both**, so no single setting can make
it right.

LAN 200 numbers its Research Week and skips its Thanksgiving:

> "Oct. 13-16, 2026 / Research Week / **8**"      *(a break week, numbered)*
> "Thanksgiving Break / Nov. 24-27, 2026 / ***"   *(a break week, not numbered)*
> "December 1-4, 2026 / **14**"

Its printed numbers track strict elapsed weeks exactly through week 13, then drift by one for
the last three rows:

```
2026-11-17  printed 13  strict 13
2026-12-01  printed 14  strict 15   <- drift
2026-12-08  printed 15  strict 16   <- drift
```

BIB301 does the same thing — Research Week numbered 8, Thanksgiving unnumbered — so this is
**two of the three real syllabi**, not one careless author.

**This defeats `breaksTakeWeekNumbers`.** A per-term boolean has no value that is right for
LAN 200: `true` puts week 14 at 23 November, `false` puts it at 30 November, and the syllabus
means 1 December. The flag added in §3.6 is correct for a document that is internally
consistent and cannot help one that is not.

**The fix that does work**: calibrate per document. LAN 200 prints the week number *and* its
date range on fifteen rows — `"Nov. 17-20, 2026  13"` — so the mapping is stated, not derived,
and a bare "Week 14" elsewhere in the same document should be read against it. The term
calendar stays the fallback for a document that never pairs them (MAT 205 says only "Week 3",
"Week 5" in prose), and that is exactly the case where a clarification question is honest.

### 4.1 The week number lands after the date, on the same line — **HANDLED**

> "September 1-4, 2026  2" · "Sept. 8-11, 2026  3" · "Dec. 15-18, 2026 (Finals Week)"

A trailing bare integer that is a column, not a day. `parseDateRange` tolerates the suffix;
`weekNumberFromRaw` deliberately refuses to read a bare number as a week reference for the same
reason.

### 4.2 A row's cells arrive as separate lines, in column order — **PARTIAL**

> ```
> Sept. 1 – Sept. 4,
> 2026
> 2
> Introduction to the
> Revelation
> Okonkwo & Christian
> Chapters 5-9
> Quiz 1
> Over Okonkwo &
> Christian Chapters
> 1-4
> ```
> — BIB 199, one table row

The date itself is split across a line break. Nothing marks where one row ends and the next
begins. This is why extraction is a language-model job rather than a regex job.

### 4.3 A two-column grading scale interleaved onto one line — **HANDLED (by ignoring it)**

> "98-100 A+  73-77 C" · "93-97 A  70-72 C-" — LAN 200

Reads as nonsense and is not needed. Worth an entry because a future "capture the grading scale"
feature will walk straight into it.

### 4.4 Dash variants and doubled spaces — **HANDLED**

En dash, em dash, non-breaking hyphen, `"Sept. 8– 11, 2026"`, `"Nov. 3 – 6, 2026"`. Normalised
in `parseDateRange`. Hand-tidied test fixtures would not have caught these, which is why the
fixtures are verbatim.

### 4.5 Ligatures survive the extraction — **OPEN**

> "make every e ff ort to inform me" — LAN 200

`ff` extracted as a separate glyph run with spaces. Harmless in prose; it would break an exact
evidence-excerpt match if the model quoted that sentence, and evidence matching is what stops
fabricated assignments.

---

## 5. Contradictions between sections

### 5.1 The stated quiz weekday is not a day the class meets — **OPEN**

> "Course schedule: **Tuesday**" … "Quizzes will be given each **Thursday** throughout the
> semester" — BIB301
> "the class meets Tue/Thu" … "Reading quizzes are given each **Friday**" — HIS 210

One of the two is wrong and the document gives no way to tell which. Nothing cross-checks a
stated weekday against the meeting pattern, so a student answering the weekday question in good
faith can date thirteen quizzes to a day they have no class.

**This is the highest-value open item in the log.** The meeting pattern is already extracted,
the weekday is already extracted, and comparing them is one line — it is simply not done.

### 5.2 Two dates for the same exam, in table and prose — **PARTIAL**

> Midterm dated October 14 in the table, October 15 in prose — BIO 240

Same machinery as §1.6.

### 5.3 The grading list's own numbering is broken — **OPEN**

> "1. Attendance & Class Participation 25% … 2. Quizzes 25% … **4.** Research Paper 25% … **4.**
> Final Exam 25%" — BIB301

Two items numbered 4 and no item 3. Any structure-recovery that trusts the ordinal will merge
or drop one. The weights still sum to 100, so the §2.1 check does not catch it.

### 5.4 Course-wide policy stated as a grade consequence — **PARTIAL**

> "If you miss more than 7 classes (excused or unexcused) you will fail the course" — LAN 200
> "Late assignments will not be accepted one week beyond the original due date, no exceptions."
> — BIB301, BIB 199

A cliff that is not a date and not a weight. It changes what "late" costs and it should reach
the student's prioritisation.

Checked rather than assumed, and it is worse than "nothing reads them": policy claims are
extracted, validated, and written to `extraction_claims` — and then the confirm route promotes
only `grading_category`, `meeting_pattern` and `assignment` (`extraction.ts`), and the review
screen renders only those three plus questions (`ExtractionReview.tsx`). **A policy is stored
and never shown to anyone.** The one about failing the course for seven absences is sitting in
the database of every account that uploaded LAN 200.

**Half-closed.** Policies now appear on the "Still unanswered" card (`OpenQuestions.tsx`), one
line per policy, with a sentence asking the instructor to confirm it — three of them on the test
term, each of which had never been on a screen. So the student sees them.

Still open is the harder half: a policy is read, and it changes nothing. "No late portfolios are
accepted" should make the portfolio's deadline harder than one that costs 10% a day, and the
priority model has no input for it. Showing it is not the same as acting on it.

---

## 6. What the model itself gets wrong

Everything above is a defect in the *document*. This section is for defects in the *reading* —
things a fluent model does to a syllabus that no amount of careful parsing will catch, because
the parser is downstream of the lie.

### 6.1 An invented assignment quoted in words the page really contains — **HANDLED**

> "Feb 14 Problem session Homework 1.3 Hydrostatic Force Review Test 1"

Every one of those words is printed on page 7 of a real calculus schedule. None of them appear
in that order, and the assignment described does not exist.

The evidence contract is the whole basis for trusting extraction: every claim carries the page
and the literal text it came from, and `verifyEvidence` checks the text is really there. Exact
substring is the primary test; a near-miss fell back to token overlap, because pdf.js does drop
and transpose words and a legitimate quote should not die over one mangled ligature.

That fallback asked whether 80% of the quoted content words appeared **somewhere** on the page,
in any order, as a substring of anything. On a five-month schedule table — every month
abbreviation, every day number, every assignment noun already printed — that is close to free.
The sentence above scored 100%. So did `"Test Homework session"`, three words long.

Found by writing `packages/ai/src/extraction/hostile-model.test.ts`, which authors extraction
JSON the way a hallucinating model would and asks what survives. Nothing had ever confirmed the
check rejected anything at all.

Fixed in two parts:

- **Locality.** Overlap is now measured inside a window of the page — twice the quote's
  content-word count, floor sixteen tokens — so the matched words have to cluster the way a real
  quotation does. Word salad has to find its words wherever they happen to be printed, which on
  a schedule table is tens of rows apart.
- **A floor on length.** Under five content words the fallback is refused outright. A three-word
  quote reaches 100% on almost any dense page, so the ratio carries no information. Short quotes
  that are genuinely present still pass — on the exact match, which is where they should pass.

Residual tolerance, measured and asserted: an eight-word real quote can carry **two** invented
words before rejection, down from four. That is deliberate, not leftover — a check that survives
no noise at all will discard real work the first time pdf.js drops a word.

Verified against the full corpus: no legitimate claim in any existing test lost its evidence.

### 6.2 A real date attached to the wrong item — **OPEN, and outside this check**

> Evidence `"Feb 21 Test 2"`, verbatim from the page. Due date reported as Feb 18.

The excerpt is real, the date is real, the pairing is invented. `verifyEvidence` passes it,
`dateAppearsInSource` passes it, and the only issue raised is `TIME_NOT_STATED` — which every
dateless-time claim gets and says nothing about truth. A wrong date at high confidence with no
signal anywhere.

This is the structural limit of a per-claim evidence check and it should not be papered over by
loosening one. The defence is §5.1: compare the resolved weekday against the meeting pattern the
same document states. Pinned as the known limit in `hostile-model.test.ts` so closing §5.1 has a
test waiting for it.

---

## Where this bites hardest

Ordered by what it costs the student, not by how hard it is to fix:

1. **§3.7** — two of three real syllabi number one break and skip another, which no per-term
   setting can resolve. Per-document calibration is the fix and is not built.
2. **§5.1** — a weekday contradiction would date a whole quiz series to a day with no class.
   Both facts are already extracted; comparing them is one line and is not done.
3. **§2.5** — LAN 200's study teams: an hour a week, every week, worth 10%, with no shape in the
   data model to hold it.
4. **§1.8** — 8 of 61 items undated, with no instructor question generated yet.
5. **§3.3** — category-ordered grading vs date-ordered schedule, reconciled by nothing.
6. **§5.4** — policy claims stored and rendered nowhere.

### 1.10 A weekly deadline lands on a single-day holiday — **HANDLED**

Not a break week: one Monday.

MAT 205 says "Problem Set 1 due Week 3", and problem sets are due "at the beginning of class".
Week 3's Monday in the fixture term is **7 September — Labor Day**. There is no class, so there
is no beginning of class to hand it in at.

Found by pasting a real academic calendar through the running Worker, and it is the case a
range-based break list cannot see: Labor Day is one day, and the week around it is an entirely
ordinary week. It only becomes visible once the calendar is stored by day, which is why the
bedrock is by day. `DATE_IN_BREAK` now fires: *"That lands inside a break, when there is no
class."*

The same run showed the flip side. That calendar's Thanksgiving is 25–27 November, Wednesday
to Friday — **not** the whole week — so Monday and Tuesday still hold class, that week is an
ordinary instructional week, and the §3.6 numbering ambiguity does not arise at all. Week 14
is 23 November under both conventions and nothing is flagged. The right answer depends on the
real calendar, which is the entire argument for having one.

### The ordering this log actually argues for

Two of the three worst entries (§3.6, §1.3) came down to the same thing, and it is not a
parsing problem: **the term's calendar has to be known before a syllabus can be read.** A
syllabus says "Week 14", "each Tuesday in class", "finals week" — every one of those is
relative to a calendar the syllabus does not contain, and getting it wrong is silent.

So ingest has a real prerequisite, and it runs in this order:

1. **Term calendar** — first and last day of instruction, breaks, finals window, and whether
   this school's syllabi number break weeks. From the student or the registrar's academic
   calendar, *not* from a syllabus.
2. **Syllabus ingest** — everything relative can now be resolved, and what cannot be is a
   question with both candidate answers rather than a coin flip.

Breaks are the part students will not think to supply, and the part that silently breaks the
most. Whatever collects the calendar has to ask for them explicitly.

### Things this log has already caught

Kept so the log's own value is measurable rather than assumed.

| Found by | Entry | Outcome |
| --- | --- | --- |
| Writing §3.6 | Problem Set 6 dated to Thanksgiving week | **Fixed** — term calendar |
| Writing §3.6 | ENG 230 expanded to 16 reading responses, one on Thanksgiving Tuesday. The answer key said 16 too, for the same reason. | **Fixed** — 15, and the key corrected |
| Adversarial review | **Answering a clarification question did nothing.** The text was stored, the question flipped to "answered" and vanished, and nothing anywhere read it. Every review looked clean regardless of what was settled. | **Fixed** — answers now apply a date, or say plainly that they did not |
| Adversarial review | The weekday resolver had no Sunday or Saturday button; one corpus syllabus makes its weekly logs due "every Sunday by midnight" | **Fixed** |
| Real corpus | `parseDateRange` parsed 0 of 50 real ranges — four log entries said HANDLED on three documents from one institution | **Fixed** (§1.5a) |
| Real corpus | Washburn states its weights in points; the app reported "add up to 0%" | **Fixed** (§2.3) |
| Checking §2.1 | A grading category with no weight passed silently when the others summed to 100 | **Fixed** — and a dead issue code removed |
| Checking §3.6 | LAN 200 numbers one break and skips the other, defeating the per-term flag | Open (§3.7) — pinned by a test |
| Writing §5.4 | Policy claims are stored and rendered nowhere | Open — pinned by a test |
| Reading D1 | A weekday answer dating a registrar-scheduled final | Fixed (§1.3) |
| Writing the hostile-model test | The evidence check had never been shown to reject anything, and its near-miss fallback accepted a sentence assembled from words scattered across a whole schedule page — and any three-word excerpt | **Fixed** (§6.1) — locality window and a length floor |
| Writing the hostile-model test | A verbatim excerpt paired with a real date belonging to a different row raises no issue at all | Open (§6.2) — pinned by a test, and closing §5.1 closes it |
| Building the open-questions card | BIO 240's grading weights add up to 90%. Every category was read, weighted and accepted, and nothing anywhere told the student a tenth of the grade was unaccounted for | **Fixed** — the card asks, and the message is drafted |
| Reading the drafted email | The model wrote "Do these grading categories and weights look right?" — a question aimed at the review screen, unanswerable by a professor, and it went into the email | **Fixed** — unsendable questions are shown but left out of the draft; the prompt now asks for questions that stand alone |
| Reading the drafted email | "3 items have dates that contradict the syllabus. Which is right?" was sent without naming the three items, which were on the claim all along — and listed one of them twice | **Fixed** — the names are appended, deduplicated |

---

## 7. What a whole real semester turned up

Section 6 is about the model. This is about running four genuine Spring 2023 syllabi —
Richland MATH 104, TAMU-Texarkana COSC 1315, UNC GEOG 062 and WSU Family Law — through the
real Worker from upload to finals, week by week (`tools/e2e/semester4/`).

### 7.1 A syllabus with no dates collapses the term into its first third — **FIXED**

> "A schedule will be given to the class that is designed to help spread things out and set a
> pace for you." — Richland MATH 104, which then never gives one

Fifty-eight pieces of graded work, no dates. With no deadline there is nothing to defer
against, so all fifty-eight were eligible in week one and the week filled with whatever ranked
highest.

**What the first week of the semester told the student to do: sit Chapter exam 14, the
Comprehensive final exam, the Mid-Term exam and the Final Examination.** The term's work was
finished by week thirteen; the last six weeks, both finals weeks among them, were empty.

Fixed by capping how many undated items may *start* per course per week — with `n` left and `w`
weeks of term to go, about `n/w` begin — recomputed every replan so a missed week pushes the
rest along. Deferred items are recorded at `WAITING_ITS_TURN`, not dropped.

Pacing the *minutes* was tried first and made it strictly worse: smaller slices meant more
items fitted per week and the term collapsed into six weeks instead of thirteen. The lever is
how many become eligible, not how long each takes. Worth remembering — it is the intuitive fix
and it is backwards.

### 7.2 Undated work was reported as at risk of missing a deadline it does not have — **FIXED**

Forty-nine items in week one at `at_risk`: "No available window fits this before it is due."
Every one had no due date at all. Same family as §6.2's sibling — an alarm whose sentence
describes a deadline the item does not have. Now `INSUFFICIENT_CAPACITY` at watch level: it
lost the week to work that *does* have a deadline, which is the scheduler being right.

### 7.3 The API could not be walked across a term — **FIXED**

The engine takes `now` as a parameter everywhere, deliberately, so a whole term can be
simulated. The API then called `new Date()`. Planning January 2023 returned an empty plan and
126 at-risk items for no reason except that the date is in the past.

So the engine was walked across sixteen weeks and the API never was — and snapshot loading,
session carry-over and persistence live only in the API path. `POST /plans/generate` now
accepts `now`, honoured only where there is no mail provider: the same signal that already
decides whether magic links are echoed instead of sent.

### 7.4 A syllabus could be ingested with no academic calendar — **FIXED**

The UI discouraged it. Discouraged is not prevented, and the wrong dates it produces are the
kind nobody notices until the deadline has passed. `POST /documents/:id/extract` now returns
409 `TERM_CALENDAR_REQUIRED`, so the rule holds for every client rather than for the one screen
that remembered it.

### 7.5 A week number is only as good as the term start — **OPEN**

COSC 1315 gives seventeen numbered weeks, no dates, and numbers spring break as week 9. Answered
"Friday", Assignment 5 (week 10) resolved to **17 March — inside spring break**. The app caught
it (`DATE_IN_BREAK`) rather than accepting it silently, which is the defence working.

But the date is still wrong, and the document contains everything needed to fix it: it says
week 9 is the break, and the calendar says the break is the week of 13 March, so *this
document's* week 1 is 16 January. Both facts are held and neither is used. This is §3.7's
per-document calibration, now with a second real case.

### 7.6 The weekday answer only works on week numbers — **OPEN**

Answering "which weekday?" dated 10 of 10 items in COSC 1315 and **0 of 8** everywhere else,
because the raw text was not a week number:

> "any time between May 10 and May 13" — Richland's final, a four-day window
> "Feb 21/28 [assigned/due]" — UNC's midterm, two dates in one cell
> "assigned April 27, 2023" — WSU's final, an assignment date and no due date

Each is answerable by a different question the app does not ask: *which end of the window?*,
*assigned or due?*, *how long after it is assigned?* The student answered and got nothing.

### 7.7 A schedule row with a literal placeholder — **OPEN**

> "Feb xx/16" and "Apr 04/xx" — UNC GEOG 062

The instructor never filled them in. Nothing reads `xx` as a placeholder; it simply fails to
parse, which is the safe outcome, but the student is never told the syllabus has a hole in it.

### 7.8 The wrong course and term on page one — **OPEN**

> "Family Law | Spring 2023 | Professor Andrew McKeown | ... | Community Property | Fall
> Semester 2022" — WSU

A copy-paste leftover naming a different course *and* a term a year earlier. §1.1 is about a
stale year beside a date; this is a stale year beside the course identity, and if a model reads
the second line the whole document lands in the wrong term.

---

## 8. The ingestion harness this log argues for

Sections 1–7 are findings. This is what they add up to, and where each piece lives.

**The prompt** (`prompt.ts`, `syllabus-extract-v3`) gained a section per class of failure the
corpus produced: things that look like dates and are not (placeholders, windows, assigned/due
pairs, an assignment date, a schedule the document only points at); the rule that excerpts must
quote one continuous run of a page rather than words gathered from across it; the instruction to
copy every week header down verbatim and leave the arithmetic alone; and a warning that page one
may name the wrong course in the wrong year.

**The organising is code, not a second model.** Three things, all pure and all testable without
a provider:

- `reconcile.ts` — several readings of one document reduced to one answer. Set arithmetic over
  claim identities, so the same runs always reduce the same way and the merge cannot itself
  hallucinate. Keeps the union, because a dropped assignment is invisible and a doubtful one is a
  line in the review queue. Agreement measures **stability, not accuracy** — three runs that read
  a table wrong the same way agree perfectly, and `verifyEvidence` remains the check on truth.
- `followup.ts` — what a second look could still settle, chosen from the issues the validator
  raised rather than by asking the model what to ask next. That is what stops the loop deciding
  it is finished. `MISSING_DATE` is deliberately *not* re-asked: re-reading cannot conjure a date
  the document never printed, and spending a pass on it teaches the loop to churn.
- `calibrate.ts` — what *this* document means by "Week 10", from the headers it printed and the
  break the calendar knows. Closes §3.7 and §7.5.

**Status.** `calibrateWeeks` is proven against the real anchors of both week-numbered documents
in the corpus — MATH 104 from its own printed dates, COSC 1315 from its numbered break — and the
two land on the same Monday from different evidence, which is the check on the arithmetic. It is
**not yet wired into `resolve-weekday`**, so the semester run still reports Assignment 5 landing
on 17 March. The test that will confirm the fix is already written.

### A quiz at every class meeting, in a class that meets twice a week

**Status: handled.**

> "A short quiz at the start of every class."

The recurrence model held a single `dayOfWeek`, so a rule that fires twice a week could not be
expressed at all. The model put null there, the validator raised "which day of the week is this
due?", and that question has no correct answer -- the answer is both. Seen live: the student
entered every quiz of the term by hand.

The fix is not a better guess. The same syllabus states its own meeting pattern and the same
extraction already reads it, so `everyClassMeeting` marks the rule and the days come from the
meeting days. A course meeting twice gets twice as many occurrences, and nobody is asked
anything.

Occurrences are numbered in date order across the days rather than one weekday at a time -- the
naive version makes "Quiz 2" the second Monday instead of the first Wednesday, so every number a
student reads names the wrong day.

A syllabus that never states its meeting times leaves this genuinely unanswerable, and those
occurrences stay undated rather than being guessed.
