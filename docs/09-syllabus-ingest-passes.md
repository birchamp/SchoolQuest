# Syllabus ingest: passes, roles, and what happens when one fails

## What this document got wrong the first time

The first version of this argued for splitting ingest into five model calls, and rested that
argument on two measured failures. Both have since been checked properly and neither survives.

**"Recall is 67%, and every miss is work stated as a rule."** The first half is a real number
and the second half is a real diagnosis — but it is a measurement of a *committed fixture file*
(`INGESTED_SEMESTER`), dumped before `expandRecurrence` existed. Both missing families are
exactly what expansion produces instances for now. The gap the design was built to close had
already been closed by arithmetic, in the pass before.

**"One assessment landed eleven weeks from the date the syllabus printed."** This did not
happen. The extraction claim for PED 110's baseline assessment reads `2026-09-02` at
`high_inference`, which is precisely what the syllabus says. The 20 November in the fixture was
typed by a screenshot run: `tools/e2e/workflows.mjs` signs into the same account and exercises
the assignments table's date editor, and the fixture is dumped from those rows. No number of
model passes would have improved a date a test script typed.

Keeping this section rather than deleting the document is the point. The failure mode is worth
naming: **a design premised on measurements nobody re-derived**, where both measurements came
from files rather than from the running pipeline. What actually found the bug below was reading
the database.

## What reading the database found instead

The weekday clarification loop — the student is asked "these are listed by week, what day are
they due?" and one answer dates the whole set — had applied a *correct* answer to a claim it
had no business touching.

MAT 205 says, verbatim:

> The final exam is scheduled by the registrar for finals week, December 14-18, 2026.

The student was asked about **problem sets**, which the same syllabus says are "due at the
beginning of class". They answered Monday. Every undated week-ranged claim in the document was
resolved against that answer, so the final exam was dated 14 December and written
`confidenceStatus: "confirmed"` — the highest trust the app has, on a date the registrar has not
published, in a course where the final is 30% of the grade.

Instruction ends 11 December. There is no class meeting anywhere in 14–18 December for a
weekday answer to be *about*.

Twenty of the twenty-one claims that answer touched were right, which is why this survived: the
feature works, and it is worth having. One click dating thirteen quizzes is exactly the work the
app exists to remove. The defect was never the reach — it was that the answer arrived carrying
no record of how far it could be trusted.

## The fix

`resolveWeekdayForClaim` (`packages/ai/src/extraction/resolve-dates.ts`) now returns a basis
alongside the date:

| Basis | When | Date used | Written as |
| --- | --- | --- | --- |
| `class_meeting` | The span sits inside instruction | The answered weekday | `high_inference` |
| `registrar_window` | The span sits entirely after the last day of instruction | The **first day** of the span | `low_inference` + `DATE_SET_BY_REGISTRAR` |
| `stale_year` | Resolves outside the term | The answered weekday | `low_inference` + `DATE_OUTSIDE_TERM` |

Three things follow from it.

**Nothing is written `confirmed` any more.** The confirm route deliberately writes
`high_inference` for exactly this reason — "the student vouched for the item existing, but the
underlying reading was still a machine's". A weekday answer sits *on top of* that reading and
cannot come out more certain than the thing it modifies.

**A finals window is dated to its first day, whatever weekday was answered.** Not because that
is the exam's date — nobody knows the exam's date — but because it is the only day in the span
a student can prepare against and still be ready for the other four. It is a floor, and the
issue code says so on the review screen.

**The question goes back on the board.** A `missing_date` clarification question is raised
naming the affected items, phrased as something to ask the instructor. Deliberately not a
`relative_date` question: that kind renders weekday buttons, and clicking one is what caused
this.

## What a pass boundary would still buy

The multi-pass argument is not dead, but it needs to be made from evidence that exists.

The one hard data dependency in ingest is real: expanding "each Tuesday" into occurrences
requires the term's start and end dates. Today that dependency is satisfied because the term
window is **user-confirmed input**, gathered during onboarding before any syllabus is read.

That matters more than it looks. `validate.ts` exempts `derived_recurrence` dates from the
source-verification check — the check that discards any date the document does not actually
print. The exemption is safe *only* because the arithmetic behind those dates runs on dates a
person typed. A survey pass that read term dates out of the syllabus and fed them into that
exemption would put model output through the one path built to trust it, and the failure would
be silent: sixteen plausible dates, no warning, on the wrong sixteen days.

So if ingest becomes multi-pass, the ordering constraint is the opposite of the obvious one.
The passes that need term dates must read them from the student, not from a pass.

Before writing that design again, the measurements it rests on need to come from a run:

- Regenerate `INGESTED_SEMESTER` against current code and re-score recall. The 67% is a
  baseline, not a present-tense fact.
- Count what is *actually* missed after expansion, per course, from that run.
- Measure the cost of the current single call against a split, in tokens and in wall time, on
  the same five syllabuses.

## Resume, if it does become multi-pass

Ingest already persists per-claim rows rather than a single blob (`extraction.ts`), so partial
progress survives today. A multi-pass version needs the same property at pass granularity:
which passes completed, their outputs, and which questions are outstanding. A student who
closes the laptop while waiting on "when does the term end?" should return to that question,
not to the start of the upload.
