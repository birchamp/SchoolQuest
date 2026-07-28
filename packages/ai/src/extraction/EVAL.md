# Extraction evaluation harness

Measures how well a model actually reads a syllabus, using the production prompt and the
production validator. Nothing here judges whether an answer "looks right" — it reports
what the validator caught, which is the only signal that matters
(docs/06-ai-system-spec.md §11).

## Running it

```bash
cd packages/ai
pnpm eval:build ./eval          # writes <case>.prompt.md — exactly what the provider sends
# run each prompt through the model, save its raw JSON to <case>.output.json
pnpm eval:score ./eval          # parses, validates, and reports
```

`eval:build` imports the real prompt and schema rather than copying them, so the harness
cannot drift from what production sends.

Once `OPENROUTER_API_KEY` is available you can skip the manual step and call
`extractSyllabus` directly against the same fixtures — the scoring half is unchanged.

## What the report tells you

- **claimed vs survived vs rejected** — rejections mean the model quoted text that is not
  in the document. Any number above zero is a fabrication signal, and the rate is the
  single most important number here.
- **issue histogram** — which defenses fired. A healthy run on these fixtures shows
  `TIME_NOT_STATED` often (syllabi rarely state times), `AMBIGUOUS_DATE` for week-range
  work, and `DATE_YEAR_MISMATCH` on the documents that contain stale years.
- **dates resolved** — how many assignments got a real calendar date. Low is not
  automatically bad: two of the three fixtures genuinely list most work by week range, and
  refusing to invent those dates is correct behaviour.
- **questions** — should be a short, grouped list, not one per assignment.

## The fixtures

Three real Fall 2026 syllabi, anonymized, in `@schoolquest/fixtures`. They were chosen
because they contain genuine mistakes:

| Document | Trap |
|---|---|
| Greek I | "Mid-term Exam on October 31, **2025**" and "Dec. 16-19, **2025**" in a 2026 term; 13 quizzes given only as week ranges |
| Systematic Theology I | Paper topic due "on or before October 5, **2023**" while the schedule table says October 2026; quizzes stated as "each Thursday" though the class meets Tuesday |
| The Revelation | Position paper due **December 10** in the schedule table, **December 11, 2026** in the grading section |

A fluent model will smooth all of these over. Catching them is the point.

## Measured results

Run over all three fixtures with Claude Sonnet standing in for the configured provider,
which was not reachable from the build environment. Extraction is configured to run on
`x-ai/grok-4.5`, a comparable frontier model, so these numbers should transfer reasonably
— but they were not produced by the configured model, and that gap closes only by
re-running with a real `OPENROUTER_API_KEY`.

Note the results below would look materially worse on a cheap model: several of them turn
on the extractor noticing that two parts of a document disagree, which is exactly the
capability that thins out at the low end. That asymmetry is why extraction does not share
the coach's model.

| | prompt v1 | prompt v2 |
|---|---|---|
| Claims rejected by evidence check | 0 / 46 | 0 / 17 (Theology re-run) |
| Theology dates resolved | 2 / 16 | **17 / 17** |
| Real contradictions surfaced | all | all |

**Fabrication was never the problem.** Across 46 claims not one quoted text that was
absent from the document, and every genuine inconsistency in these syllabi was raised as a
question — including one the hand-written ground truth had missed, a final exam dated
after the term ends.

The v1→v2 jump came from a single prompt fix. v1 let the model read "something about this
item is contradictory" as "I cannot give a date", so it nulled dates that were printed
plainly in the schedule table. Separating those two ideas — an explicit date always fills
`iso`, ambiguity is how doubt is raised — took Theology from 2 usable dates to 17.

Under v2 the model reports a genuinely disputed item once per date it found, each with its
own evidence, and the validator reconciles them: Theology's topic-approval deadline comes
back as both 2026-10-13 (schedule table) and 2023-10-05 (prose), flagged
`CONFLICTING_DATE_FOR_SAME_ITEM` and `DATE_OUTSIDE_TERM`, with the stale one rated
`low_inference`.

### Known gap

Greek and Revelation list every quiz against a week range ("Sept. 8-11, 2026") and never a
due date, so `iso` is correctly null for all of them. The model asks the right question —
*"the syllabus says quizzes happen each Wednesday; is each quiz due the Wednesday in its
week?"* — but answering it currently resolves nothing. One answer should date thirteen
quizzes. Until that loop closes, those two courses arrive with usable assignments and no
usable dates.

## Reading a bad result

- **Rejections above ~5%** — the prompt's evidence rule is not landing. Check whether the
  model is paraphrasing excerpts instead of quoting them.
- **Many `DATE_NOT_IN_SOURCE`** — the model is computing dates from week numbers. The
  validator strips them, so this is safe, but it means wasted questions for the student.
- **Zero `DATE_YEAR_MISMATCH` on Greek or Theology** — suspicious. Those documents really
  do contain stale years; silence means either the model dropped those items or the year
  check regressed.
- **Schema failure** — the provider's structured-output mode was not applied, or the model
  wrapped its JSON in prose.
