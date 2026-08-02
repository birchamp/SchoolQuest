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

`parseDateRange` reads the second month when it is given and carries a Dec→Jan range into the
next year.

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

Ten per cent of the grade is unaccounted for and the document does not say so. Raised as
`CATEGORY_WEIGHTS_DO_NOT_SUM`.

### 2.2 The weight is glued to the end of a prose paragraph — **OPEN**

> "3. Quizzes: Each Wednesday there will be a quiz for each chapter of the textbook. Quizzes are
> cumulative and may include vocabulary, translation, and grammatical questions. **30%**" —
> LAN 200

There is no grading *table* in LAN 200 at all. The weights are trailing numbers at the end of
four numbered paragraphs, and one of them ("…attend all classes. 20%") sits after a sentence
about failing the course for absences. A reader looking for a table finds nothing.

### 2.3 Points and percentages mixed in one document — **OPEN**

Not present in the current corpus, and worth watching for: a syllabus that gives a percentage
weight per *category* and raw points per *assignment* ("Quiz 1 — 20 pts") describes the same
grade twice in two units. `pointsPossible` and `weightPercent` are both in the schema and
nothing reconciles them, so a course can end up with 100% of weight assigned and a points total
that disagrees.

**Wanted:** a real syllabus doing this, to seed the fixture with.

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

### 5.4 Course-wide policy stated as a grade consequence — **OPEN**

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
| Checking §3.6 | LAN 200 numbers one break and skips the other, defeating the per-term flag | Open (§3.7) — pinned by a test |
| Writing §5.4 | Policy claims are stored and rendered nowhere | Open — pinned by a test |
| Reading D1 | A weekday answer dating a registrar-scheduled final | Fixed (§1.3) |
