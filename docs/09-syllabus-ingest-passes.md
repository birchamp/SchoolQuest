# Syllabus ingest: passes, roles, and what happens when one fails

## Why this is not one call

Ingest is currently a single model call that reads a syllabus and returns everything at once:
course identity, meeting patterns, grading categories, every assignment, policies, and the
questions worth asking. It is asked to find structure, read content, do calendar arithmetic, and
decide what it does not know — simultaneously.

Two measured failures show the cost, and neither is subtle.

**Recall against a written answer key is 67%** — 28 of 84 assignments missing. Every single miss
is work stated as a *rule* ("a short response is due each Tuesday", "there are 14 logs") rather
than listed in a table. Work enumerated row by row came through perfectly. The model is not bad
at reading; it is bad at doing two different reading tasks in one pass, and the quieter one loses.

**One assessment landed eleven weeks from the date the syllabus printed.** PED 110 states
"Baseline assessment: September 2, 2026 in class" and the plan carried it on 20 November.

Both are failures of attention, and attention is what a pass boundary buys.

The decomposition is also not merely tidy: there is a hard data dependency in it. Expanding "each
Tuesday" into occurrences requires the term's start and end dates. A pass that reads rules
genuinely cannot run until a pass that reads the calendar has succeeded, or until the student has
supplied the dates. That dependency is why questions belong *between* passes rather than only at
the end.

## The passes

Each is one model call with one job. A pass that cannot be described in a sentence is doing two.

| | Pass | Role | Produces |
| --- | --- | --- | --- |
| **P1** | Survey | What is this document, and where is everything in it? | Course identity, term dates, meeting patterns, and an inventory of which pages enumerate work, which state rules, which state grading |
| **P2** | Grading | What is each thing worth? | Categories and weights |
| **P3** | Enumerated | The work the document lists item by item | Assignments with dates |
| **P4** | Rules | The work the document describes as a pattern | Recurrences, expanded against P1's term dates |
| **P5** | Reconcile | What does not add up, and what should we ask? | Contradictions, coverage gaps, questions for the student and for the professor |

P1 earns its place by producing an **inventory rather than content**. Knowing that page 3 lists
work and page 2 states a rule is cheap, checkable, and it is what lets a later failure be
described precisely — "the schedule table on page 3 was not captured" is actionable in a way that
"extraction failed" is not.

P3 and P4 are split because they are different reading tasks and the combined version
demonstrably drops the second one. P4's output is a rule; the occurrences are computed by
`expandRecurrence`, not by the model, because counting Tuesdays between two dates is arithmetic
and every date a model gets wrong is a day a student turns up on.

## Questions between passes

Two kinds, and they are not interchangeable.

**Questions for the student** are asked when the answer is something they know and the plan needs
before it can continue: "your syllabus does not give the term dates — when does the semester
end?" These block the passes that depend on them.

**Questions for the professor** are asked when the answer is something *nobody* has, because the
document does not say and the student cannot know either: "Exam 2 has no date — has it been
announced?" These never block. They are drafted as text the student can send, because the useful
output of "we cannot know this" is a message, not a warning icon.

## When a pass fails

The governing rule: **a failure invalidates what depends on it and nothing else.** Rerunning all
five passes because grading weights came back malformed throws away good work, costs four
unnecessary model calls, and — because the model is not deterministic — can lose facts that were
correct the first time. That last one matters most. A retry is not free of risk; it is a fresh
sample.

| Pass | On failure | Blast radius |
| --- | --- | --- |
| P1 | Retry once, then ask the student for term dates and meeting times directly | Everything. P3 can still run on page text, but P4 cannot expand without dates and P5 cannot check coverage. This is the only pass whose failure blocks. |
| P2 | Retry once, then continue with `gradingConfidence: "unknown"` and raise a question | Prioritisation and health readings degrade. Scheduling is unaffected. **Assignments are not discarded.** |
| P3 | Retry once, then report the shortfall against P1's inventory | The core. A student with no assignments has nothing, so this is the pass most worth a second attempt — and the one where a silent partial success is most dangerous. |
| P4 | Retry once, then raise questions naming the rule-bearing sections P1 found | Recurring work is missed. The student is told which sections were not expanded rather than left to discover it. |
| P5 | Retry once, then keep the model's own questions and skip the derived ones | No coursework is lost. Only the cross-checks and drafted questions. |

Nothing reruns the whole pipeline. The only upward fallback is P1, and it falls back to *asking a
person*, not to re-reading.

## The failure that does not raise an error

A pass that returns well-formed, plausible, wrong output is the dangerous case, and no retry
policy addresses it. Two defences, both already in the codebase and both cheap:

- **The evidence check.** Every claim quotes the page it came from, and a claim whose excerpt is
  not on that page is discarded (`validate.ts`). This is what stops a fabricated exam.
- **Counting against the inventory.** P1 says the schedule table has roughly fourteen rows; P3
  returns four. That is not an error, it is a number that disagrees with another number, and it
  is the only signal that catches a confidently incomplete read.

The second is the reason P1 produces an inventory at all.

## Resume

Ingest already persists per-claim rows rather than a single blob (`extraction.ts`), so partial
progress survives. The multi-pass version needs the same property at pass granularity: which
passes have completed, their outputs, and which questions are outstanding. A student who closes
the laptop while waiting on "when does the term end?" should return to that question, not to the
start of the upload.
