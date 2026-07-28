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
