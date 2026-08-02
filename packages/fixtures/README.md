# Test corpora

Three kinds of syllabus live here, and the difference between them matters.

| | What it is | What it is for | Count |
| --- | --- | --- | --- |
| `syllabus-pages.ts` | **Real**, anonymised | Discovering gotchas nobody thought of | 3 |
| `fake-semester.ts` | Hand-written, one coherent term | End-to-end walks through the whole app | 5 |
| `syllabus-corpus.ts` | Generated from declared faults | Regression, at scale, with an exact key | 40 |

## Why the constructed corpus cannot replace real ones

`syllabus-corpus.ts` builds forty documents across eight terms, each carrying a declared set of
faults, so the answer key is exact by construction and recall can be scored automatically. That
is worth having — it is the difference between measuring extraction against five hand-keyed
documents and against forty.

It buys nothing in the direction that matters most. **Every fault in it is one already in
`docs/10-syllabus-gotchas.md`.** A constructed corpus measures regression; it cannot discover.
Every genuinely new gotcha this project has found came from reading a real document or a real
database, and the log's rule — quote a real source — exists to keep that honest. Nothing from
the generated corpus may be cited there.

## Adding a real syllabus

The corpus that needs growing is `syllabus-pages.ts`. Adding one takes a few minutes.

1. **Get the page text the way the app does.** The desktop app parses PDFs client-side with
   `pdf.js`; `apps/web/src/lib/pdf-text.ts` is the same code. Extract to an array of
   `{ page, text }` and keep it **verbatim** — the ligatures, the doubled spaces, the en
   dashes, the week number stranded on its own line. Every one of those has caught a real bug,
   and a hand-tidied fixture would have caught none of them.

2. **Anonymise, structurally untouched.** Replace the institution, instructor name and email.
   Leave every date, weight, assignment name and inconsistency exactly as printed — including
   the stale years and the contradictions, which are the reason the document is worth keeping.

3. **Append to `syllabus-pages.ts`** with a one-line note in the header docstring saying what
   is odd about it.

4. **Run the coverage report** and see whether it brought anything new:

   ```
   npx vitest run packages/fixtures/src/syllabus-corpus.test.ts
   npx vitest run packages/ai/src/extraction/gotchas.test.ts
   ```

5. **If it did, add an entry to `docs/10-syllabus-gotchas.md`** — quoting the line, saying what
   it costs the student, and marking it HANDLED / PARTIAL / OPEN. Pin whatever is checkable in
   `gotchas.test.ts` so the entry cannot quietly stop being true.

## Wanted

Gaps the current corpus cannot fill, in order of value:

- **Points and percentages in one document** (§2.3). The only entry in the log with no real
  evidence behind it. A syllabus giving category weights as percentages *and* individual
  assignments in raw points describes the same grade twice in two units that need not agree.
- **A grading category with no assignments anywhere in the schedule** (§2.5). Greek's study
  teams — an hour a week, worth 10%, appearing in no table.
- **A syllabus whose week numbers disagree with its own dates** beyond the break-drift case
  (§3.7) — a renumbering after a row was inserted, say.
- **Anything from a school whose finals do not start the Monday after instruction ends**, which
  is the assumption `FINALS_GRACE_DAYS` falls back on.
