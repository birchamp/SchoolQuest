---
name: syllabus-parser
description: >-
  Parse a course syllabus (PDF, Word, pasted text, or image scan), ask the clarifying
  questions the document cannot answer itself, and regenerate it as a standardized syllabus
  with a comprehensive chronological schedule at the end and the original document appended
  in full. Use this skill whenever the user provides a syllabus, course outline, or class
  schedule and wants it cleaned up, restructured, summarized, turned into a schedule or
  calendar, or checked for errors -- even if they never say the word "syllabus". Also use it
  when a user asks "when is everything due in this course" or wants course dates, grading
  weights, or assignments extracted from a course document.
---

# Syllabus Parser

Turn a messy, human-written syllabus into a standardized document a student can actually
plan from, without silently inventing anything the original does not say.

A syllabus is not a data format. It is a document a person wrote once, edited over several
years, and printed through a word processor into a PDF that a text extractor flattens into
one column. It will contain stale years, contradictions between its own sections, weights
that do not add up, and work stated as a rule ("a quiz every Thursday") rather than a list.
This skill's job is to read it faithfully, surface every place where the document is
ambiguous or self-contradictory, resolve what can be resolved by asking, and mark honestly
what cannot.

**The prime directive: never smooth over a defect.** A fluent reader's instinct is to
silently fix the stale year, pick one of two conflicting dates, or assume the missing 10%
of the grade doesn't matter. Every one of those instincts costs the student real points --
an exam they show up for on the wrong day, work they never knew existed. When the document
is wrong or unclear, say so; when you had to choose, show your choice and mark it.

## Workflow

Work through these five steps in order. The ordering matters: relative dates ("Week 14",
"each Tuesday", "finals week") can only be resolved against a calendar, so the calendar
must be settled before extraction is finalized.

### Step 1 -- Read the original

Get the full text of the document. For a PDF, extract the text (expect table rows to arrive
as interleaved single-column lines -- see the "What extraction does to the text" section of
`references/gotchas.md`). For an image or scan, OCR it. Keep the original text verbatim and
untouched; it is appended to the output in full, and it is the only ground truth you have.

While reading, note the page or section each fact comes from. Any fact you extract should
be traceable to a continuous run of text that actually appears in the document -- never to
words gathered from different places on a page and assembled into a sentence. Assembled
quotes are how invented assignments get past a careful reader.

### Step 2 -- Establish the term calendar

Before resolving a single relative date, establish:

1. **First and last day of instruction** (the syllabus usually states this).
2. **Breaks and single-day holidays**, by day, not by week. A one-day holiday (Labor Day)
   sits inside an otherwise ordinary week and silently swallows a "due at the beginning of
   class" deadline.
3. **The finals window**, which sits *after* the last day of instruction -- do not flag
   finals as "outside the term".
4. **Whether this document's week numbers count break weeks.** Do not assume a convention:
   real syllabi number one break and skip another *in the same document*. If the schedule
   table pairs week numbers with date ranges anywhere ("Nov. 17-20, 2026  13"), calibrate
   from those printed pairs -- the mapping is stated, not derived. If it never pairs them,
   this becomes a clarifying question.

Take the calendar from the syllabus where stated, but if breaks or the term window are
missing, **ask the user** -- breaks are the thing users never think to supply and the thing
that silently mis-dates the most work. Never infer term dates from a different syllabus or
from what a typical academic calendar looks like.

### Step 3 -- Extract, against the field guide

Read `references/gotchas.md` before extracting -- it is a distilled catalog of what real
syllabi actually do, organized as: dates, grading weights, where work is written down,
what PDF extraction does to text, and contradictions between sections. Extract:

- **Course identity**: code, title, term, instructor, contact, meeting days/times, location.
  Beware: page one may contain copy-paste leftovers naming a *different* course or an
  earlier term. Prefer the identity that matches the schedule table's dates.
- **Grading structure**: every category with its weight (or points -- some courses grade
  in points, and 20/40/40 points out of 100 is a complete scheme, not missing data).
  Check the sum. Capture drop rules ("lowest quiz dropped").
- **Every piece of gradable work**, dated or not. Work appears in two forms: listed rows
  in a schedule table, and *rules* in prose ("a weekly fitness log is due each Sunday").
  Expand rules into dated instances by arithmetic against the calendar -- counting
  Tuesdays between two dates is math, not inference -- and skip instances that land on
  breaks. But when the schedule table itself dates two or more items of the series, the
  table wins and the rule is *not* expanded: the prose is a summary of an irregular
  reality, and the rows are what the student is graded against (details, including the
  "every class meeting" case, in the field guide). The same assignment is usually
  described in two places with different detail (and sometimes different dates); merge
  into one item and flag any date conflict.
- **Course-wide policies with grade consequences**: attendance cliffs ("miss more than 7
  classes and you fail"), late-work rules, academic integrity penalties. These change
  what a deadline costs and must appear in the output, not be dropped as boilerplate.
- **Readings and topics per week**, for the schedule.

Mark every extracted date with a confidence level:

| Confidence | Meaning |
| --- | --- |
| **stated** | The document prints this exact date for this exact item |
| **derived** | Computed by arithmetic from stated facts (recurrence expansion, week-number calibration) |
| **inferred** | Required a judgment call -- record what the call was |
| **unresolved** | The document does not contain it and no question has settled it |

An answer from the user upgrades confidence, but a clarification answer applied across
many items ("quizzes are on Wednesdays") stays **derived** on each item it touched -- it
sits on top of a machine reading and cannot come out more certain than that reading.

### Step 4 -- Ask clarifying questions

Collect every ambiguity into **one batch** and ask once -- do not drip questions. For each
question, present the candidate answers you can already see, so the user picks rather than
composes. Only ask what the document genuinely cannot settle. Typical questions worth
asking (details and phrasing guidance in `references/gotchas.md`):

- A stale year ("Mid-term Exam on October 31, 2025" in a Fall 2026 term): ask which year
  is right rather than auto-correcting -- the stated year may be the stale one, or your
  correction may be wrong.
- Weekly work dated only by week range: "These 13 quizzes are listed by week. What day of
  the week are they due?" -- one answer dates the whole series. But check the answer
  against the stated meeting pattern: a quiz weekday that is not a class day means one of
  the two document statements is wrong, and that contradiction goes back to the user.
- Weights that sum short of 100: ask "what makes up the other N% of your grade?" -- the
  actionable fact is a *missing category*, not suspect arithmetic. (Over 100 may just be
  extra credit; ask before flagging it as an error.)
- The same item dated twice, differently: show both dates with their sources and ask.
- Week numbers after the term's first break, when the document never pairs a week number
  with a date range: ask whether break weeks count.

Two kinds of question deserve different handling. Some are answerable by the student
("what day are quizzes due?"); some only the **instructor** can answer ("the exam date
says 'announced later' -- ask your instructor when Exam 2 is"). Do not ask the student
things only the instructor knows; instead, list those in the output's Open Questions
section, phrased so the student can forward them verbatim.

Some facts are not ambiguities but **facts that have not happened yet** -- "the final is
scheduled by the registrar for finals week, December 14-18". Do not ask which day. Date
the item to the *first* day of the window (the only day you can prepare against and still
be ready for the rest), mark it clearly as a registrar-set window, and put the real date
on the instructor question list.

If the user is unavailable or declines to answer, proceed: use the most defensible reading
for each open item, mark it **inferred** or **unresolved**, and list every skipped
question under Open Questions. An unresolved date is left visibly undated -- never guessed.

### Step 5 -- Regenerate

Produce the standardized syllabus using the exact structure in
`references/output-template.md`. The non-negotiable properties:

1. **Standard section order**, whatever order the original used.
2. **A comprehensive chronological schedule at the end** of the regenerated portion: every
   dated item -- classes, readings, quizzes, exams, papers, expanded recurring work,
   breaks, and the finals window -- in strict date order, with confidence and flags per
   row. This table is the deliverable; everything else supports it.
3. **Open Questions** listing every unresolved item and every instructor-facing question.
4. **A changes-and-corrections note** summarizing what was fixed, resolved by question, or
   left flagged -- so the reader can audit your reading against the source.
5. **The original document appended in full** below a clear divider, verbatim, with a link
   to (or the path/name of) the original file. The regenerated syllabus is a reading of
   the original, and the reader must always be able to check the reading against the text.
6. **Source links embedded throughout the generated text**, not only at the bottom. Give
   each page (or section) of the appended original an anchor heading, and link every
   extracted fact -- each schedule row, each grading weight, each policy -- to the anchor
   for the page it came from, so one click jumps from any claim to the text that supports
   it. Where the original lives at a URL or file path, link the anchor headings back to it
   too. The template shows the exact mechanics.

Write output as Markdown by default; produce a Word or PDF version only if asked (the
relevant document skills handle that -- keep this same content structure).

## Self-checks before delivering

- Every date in the schedule either appears verbatim in the original or is marked
  derived/inferred with its basis. Spot-check a few by searching the original text.
- The grading table's weights sum to 100 (or the discrepancy is explicitly called out).
- Count check: if the document says "there are 14 logs" or lists 13 quiz rows, your
  schedule contains exactly that many -- minus any that fall on breaks, which the
  changes note explains.
- No item appears twice under two names (watch titles that embed scope: "Quiz 3" and
  "Quiz 3 Over Chapters 2 & 3" are the same quiz).
- Every policy with a grade consequence made it into the output.
- The original text at the bottom is complete and untouched.
