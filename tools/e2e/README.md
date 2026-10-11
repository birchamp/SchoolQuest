# End-to-end checks

## Writing a journey

Every journey builds on `harness.mjs`, which owns the parts that are the same everywhere: `api()`,
`signUp(label)` for a fresh account through the dev sign-in link, the pinned clock (`TODAY`, `at`,
`dateFrom`), `openApp(browser, token, { now, viewMode, landOn, shell, context })`, `check()`, and
`runJourney(noun, body)`, which starts the servers (or attaches with `--attach`), launches
Chromium, and exits non-zero on any failed check, a journey that throws, or a run that recorded no
checks at all. `journey()` wraps one of several independent stories so one that throws does not
stop the rest. A new journey is only its story; see the example at the top of `harness.mjs`.

Before trusting a new journey, break the behaviour it guards and watch it fail.

## The acceptance journey (runs on every push)

`pnpm test:acceptance` starts both halves, drives the release acceptance list from
`docs/02-prd.md` §7 through a real browser against the real Worker, and stops them again:
sign in, add a course and an assignment and see them appear, start and stop a session,
move and lock a block from the hour calendar, have a bad move refused, give up a day and
read what moved, record a grade, switch themes, and ask the coach without a key. Every step
is asserted from the DOM, and the job fails on any of them. `--attach` uses servers that are
already running. `.github/workflows/ci.yml` runs it, then `contrast.mjs` per theme.

It exists because the primary button on Today was dead for a month and nothing could
notice: every other test in the repository is a pure function.

It plans from nine in the morning today, whatever the clock says, so a run near midnight
still has a today to book. Each run signs up a fresh `acceptance-<timestamp>@example.edu`
account in whichever database the Worker is using; on a developer's machine that is the
local one, and those accounts are harmless but do accumulate.

## The scheduling journey (runs on every push)

`pnpm test:scheduling` asks the question the app is built to answer: does every assignment
coming due get time on the calendar? It walks a real browser and the real Worker through an
ordinary week, the week after it, a skipped block, the morning after a missed block, "needs more
time", a student whose browser is in Honolulu, and a week with more work than hours. Each ends in
the same audit. Every piece of work due before the plan's horizon closes either has its minutes
booked ahead of its deadline or is named in a risk saying it does not. In a week with room to
spare, a warning does not count.

It was written for a report that the app "isn't scheduling time to work on all of the
assignments that are coming due", and its first run found seven separate reasons:

- **The plan never moved on.** A plan was generated only when none existed, so once its week
  ended the app showed it forever, with nothing on Today. The app now replans on the first
  load of a new day.
- **A skipped or missed block's time was gone.** "Not now" reloaded the plan instead of
  replanning. Now it replans, and the declined hour counts as taken.
- **"Needs more time" finished the assignment.** Estimate minus minutes worked hit zero, and
  zero read as done.
- **"Now" was Greenwich time** while every stored time is the student's wall clock, so in
  Chicago the afternoon was over by mid-morning. The server now reads the student's zone, and
  the app reports it.
- **A deadline buffer before any free time** made work due the next morning unplaceable.
- **Work shorter than the minimum session** could never be placed at all.
- **Greedy placement** spent the only day an urgent item could use on work due later in the
  week. Now work short of its deadline may displace work due later.

`--attach` uses servers that are already running; `--verbose` prints each audit as a table.
Remember that `wrangler dev` does not reload when only `packages/` changes, so restart the
servers after editing the planning engine, or the journey will test the old one.

## The intake journey (runs on every push)

`pnpm test:intake` is a new student from the first screen to a planned week, all through the
browser: choose a theme, name the term, set study hours, save an OpenRouter key, add spring
break to the calendar by hand, add two courses, upload each syllabus, answer what the review
asks, confirm, and check that the open questions and the plan follow. The other journeys set all
of that up through the API, so until this one none of those screens was rendered by a test.

The model is the only thing replaced. The journey starts a mock OpenRouter on 9099 that serves
the committed `semester4/` extractions (Math 104 and GEOG 062), and points the Worker at it for
this run only through `SQ_WORKER_VARS`, which `tools/dev.mjs` turns into `wrangler dev --var`.
Nothing in `.dev.vars` is touched. The syllabus is a real .docx, built from `semester4/pages.json`
with a page break between pages, picked through the file input, and read to page text by the
app's own reader. So the checks cover what reached the model, which key paid for it, the
evidence check against the page text, and what the review shows.

With `--attach`, the Worker has to already be running with the var. The journey prints the
command for that.

Its first run found that "Still unanswered" on Setup only loaded on mount. After a student
confirmed a syllabus on that same page, the card went on saying nothing was open.

# End-to-end semester test

Drives the complete student journey through the real Worker API: fresh account,
onboarding, five courses, a 12-hour work week, meals, five syllabus extractions,
clarification answers, confirmation, the first weekly plan, and the coach guardrail.

The five syllabi live in `@schoolquest/fixtures` (`fake-semester.ts`) and carry planted
inconsistencies observed in real documents. Extraction output is produced offline by a
strong model following the production prompt (`pnpm --filter @schoolquest/ai eval:build`),
then served to the Worker through `mock-openrouter.mjs` via `OPENROUTER_BASE_URL` — so the
entire production path runs unmodified.

```bash
# 1. Generate prompts, produce <case>.output.json for each with a model of your choice
pnpm --filter @schoolquest/ai eval:build ./eval-out

# 2. Serve them
node tools/e2e/mock-openrouter.mjs ./eval-out 9099

# 3. Worker pointed at the mock (in apps/api/.dev.vars):
#    OPENROUTER_API_KEY=sk-or-mock
#    OPENROUTER_BASE_URL=http://127.0.0.1:9099
pnpm dev:api

# 4. Run the journey
python3 tools/e2e/e2e-semester.py
```

Last full run: 58 claims across five syllabi, 0 rejected by the evidence check, every
planted trap surfaced (90% weights, stale 2025 date, dual-dated midterm, Friday-quiz
contradiction), 56 work items confirmed (48 dated), 31 sessions planned at 1530/1545
minutes of capacity, coach grounded, homework request refused at the prefilter.

## The other half: a whole term, week by week

The journey above proves the app can *take in* a semester. It says nothing about whether the app
survives one, which is a different question and the one that matters more — the failures worth
finding appear on the seventh replan, not the first.

That half lives in `packages/planning-engine/src/semester-walk.test.ts` and runs with the ordinary
test suite:

```bash
pnpm vitest run packages/planning-engine/src/semester-walk.test.ts
```

It walks sixteen weeks of the ingested semester. Each week it plans from the real scheduler,
"attends" the plan imperfectly — 72% completed, some of those cut short, the rest missed —
advances seven days, and replans on top of what actually happened. It prints a table of the term
and asserts the invariants on every step: nothing scheduled into the past, nothing over capacity,
nothing booked for finished work, no two blocks over the same minutes, no block left stranded in
the past still marked planned, and work getting *done* rather than accumulating.

It needs no clock seam. Nothing in the engine reads a clock except through `now`, which is what
makes a sixteen-week simulation a test rather than a project.

The semester it walks is `packages/fixtures/src/ingested-semester.ts` — the seeded account dumped
out of the Worker after the journey above. Not `buildSeedSemester`, which is two courses whose
work runs dry around week fourteen; a walk driven by that reported the planner failing in the
last weeks when the fixture had simply run out, and a test that cannot tell those two apart is
worse than no test.

Three defects it found on its first complete run, none of them visible to a test that fixes a
single moment:

- **Past-due work was silently unschedulable.** Five pieces of work went past their dates in the
  first month and were never scheduled again for the remaining seven weeks, while the terrain
  went on burning them red.
- **Work due inside its own deadline buffer was unschedulable too** — the most urgent work being
  the least bookable.
- **Nothing stopped work starting arbitrarily early.** A quiz due 2 December was booked in
  August, and a five-course term finished in nine weeks with the last seven planning nothing.
