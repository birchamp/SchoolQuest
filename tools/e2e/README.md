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
