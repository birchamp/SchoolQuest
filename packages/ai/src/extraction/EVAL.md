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
