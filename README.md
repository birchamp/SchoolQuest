# SchoolQuest

A semester scheduling gamified homework tracker.

SchoolQuest turns syllabi, recurring commitments, deadlines, and grades into a weekly plan
a student can actually act on — and re-plans calmly when life changes. It answers two
questions at once:

> **What should I work on right now?** and **if I do that, will everything else still get done?**

Built for students who find planning itself hard: executive-function difficulty, time
blindness, weak task initiation. The design principles behind every decision are in
[`docs/01-product-brief.md`](docs/01-product-brief.md).

---

## Two apps, one codebase

| | Desktop app (Tauri) | Companion PWA |
|---|---|---|
| Today's next action | ✅ | ✅ |
| Start / complete / skip a session | ✅ | ✅ |
| AI planning coach | ✅ | ✅ |
| Week map | ✅ | ✅ |
| **Syllabus upload** | ✅ | ✗ — points you to the desktop app |
| Course & term setup | ✅ | ✗ |

Both shells load the same React bundle from `apps/web`. The split is one `isDesktop` check
(`apps/web/src/lib/api.ts`), so following the plan feels identical on a phone and a laptop,
while setup work stays where a real file picker exists.

## Stack

- **Frontend** — Vite + React + TypeScript SPA, installable as a PWA via `vite-plugin-pwa`
- **Desktop** — Tauri v2 wrapping that same bundle (~10 MB, native file dialogs)
- **API** — Hono on Cloudflare Workers
- **Database** — Cloudflare D1 (SQLite) with Drizzle
- **Files** — Cloudflare R2 (syllabus PDFs, grade screenshots)
- **AI** — OpenRouter, pinned to `x-ai/grok-4.1-fast` (~$0.20/M in, $0.50/M out)
- **Auth** — passwordless email magic links, HMAC-hashed tokens in D1

Everything runs on Cloudflare's **free tier**. No Queues — syllabus processing is designed
to run inline; the job boundary is isolated so moving to Queues later is a small change.

## Repository layout

```
apps/
  web/         Vite React SPA — serves both the PWA and the Tauri window
  api/         Hono Worker: D1 schema, routes, auth, coach endpoint
  desktop/     Tauri v2 shell
packages/
  domain/          Theme-neutral entities, Zod schemas, grade math
  planning-engine/ Pure scheduler: priority scoring, placement, replanning
  ai/              OpenRouter provider, coach prompt, scope guardrail
  theme-language/  Semantic key → Quest / Mission / Plain labels
  fixtures/        The reference semester used by tests and the demo seed
docs/          The original product specification (8 documents)
```

Three rules hold this together:

1. **The planning engine never calls an LLM.** Same inputs and seed → same plan, every time.
   It is fully testable without a network.
2. **The LLM never writes to academic records.** The coach emits typed *proposed actions*;
   the student's click is what calls the API.
3. **No themed word appears in the domain or the database.** Metaphor lives only in
   `packages/theme-language`, applied at render time.

## Getting started

```bash
pnpm install

# 1. Create the Cloudflare resources (one time)
npx wrangler d1 create schoolquest        # paste the id into apps/api/wrangler.toml
npx wrangler r2 bucket create schoolquest-documents

# 2. Local database
pnpm db:migrate:local
pnpm db:seed:local                        # loads the reference semester

# 3. Secrets for local dev — apps/api/.dev.vars
cat > apps/api/.dev.vars <<'EOF'
OPENROUTER_API_KEY=sk-or-v1-...
AUTH_SECRET=<openssl rand -hex 32>
EOF

# 4. Run it
pnpm dev:api      # Worker on :8787
pnpm dev:web      # SPA on :5173 (proxies /api to the Worker)
pnpm dev:desktop  # Tauri window (starts the web dev server itself)
```

With no `RESEND_API_KEY` set, the sign-in endpoint returns the magic link in its response
and the sign-in screen shows it — local development needs no mail account.

### Deploying

```bash
cd apps/api
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put AUTH_SECRET
npx wrangler secret put RESEND_API_KEY     # optional; without it, no emails are sent
npx wrangler d1 migrations apply schoolquest --remote
npx wrangler deploy
```

Then set `APP_URL` in `wrangler.toml` to your deployed web origin, and build the web app
with `VITE_API_URL` pointing at the Worker.

### Building the desktop app

```bash
pnpm --filter @schoolquest/desktop tauri icon apps/web/public/icon-512.png  # once
pnpm --filter @schoolquest/desktop build
```

Requires the Rust toolchain and your platform's
[Tauri prerequisites](https://tauri.app/start/prerequisites/) — on Linux that means the
GTK/WebKit development packages (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`).

## The AI coach

The coach is scoped deliberately narrowly. It helps you decide **what to work on, when,
and in what order** — and refuses everything else.

**In scope:** what to start now and why · what fits the 25 minutes you actually have ·
breaking an assignment into ordered steps · recovering a missed day · whether deferring
something is safe · general study and focus technique · reassurance, backed by the plan,
that deferred work is still protected.

**Refused, with a redirect back to planning:**

- **Doing the coursework.** No solving problems, writing or editing any part of an
  assignment, explaining course concepts or readings, summarizing assigned material, or
  checking answers. *"I will not do the assignment itself — that part is yours. What I can
  do is tell you when to work on it and what step comes first."*
- **Anything off-topic.** Trivia, general knowledge, current events, personal advice,
  entertainment, unrelated programming help.

Three layers enforce this, cheapest first (`packages/ai/src/guardrail.ts`):

1. A **deterministic prefilter** — regex patterns that catch the obvious cases in either
   direction with zero model spend.
2. A **separate classifier call** for anything ambiguous, on the same cheap model. It is
   deliberately isolated from the coach call: a single call that self-reports "this was on
   topic" can be argued out of that verdict by the message it is judging.
3. The **coach system prompt**, which restates the boundary — the classifier only sees the
   newest message, so this catches conversations that drift over several turns.

A refused message never reaches the coach model at all, so an off-topic question costs one
tiny classification instead of a full turn. Refusals render as ordinary replies, not
errors — being told "not that" should not feel like being told off. Every verdict is
persisted (`coach_messages.guard_verdict`) so the gate can be tuned against real traffic.

If the classifier call fails outright (provider outage), the gate **fails open** to ALLOW
and records that it did; the system prompt is the backstop. Hard-refusing every message
during a provider blip would break the app for legitimate use.

**One deliberate exception:** messages expressing self-harm or crisis are routed to a
distress branch that responds warmly and points to real help (988, campus counseling)
rather than redirecting to study prioritization. It does not diagnose or counsel — that is
explicitly out of scope — but answering "I want to hurt myself" with scheduling advice
would be a serious failure. See `DISTRESS_PATTERNS` in the guardrail.

### Changing the model

Set `OPENROUTER_COACH_MODEL` in `wrangler.toml`. Defaults live in
`packages/ai/src/provider.ts`. Coach turns are short and grounded in pre-computed plan
data, which is why a cheap fast model is the right default rather than a compromise.

## The planning engine

`packages/planning-engine` is pure and independently tested. Its priority score is a
weighted, inspectable combination of eight components — deadline pressure, academic value,
project leverage, failure risk, spacing need, context fit, neglect, and explicit user
priority — never a single opaque judgement. Every placement carries machine-readable
**reason codes** that `theme-language` renders into the "why this now?" sentence.

Behaviors the test suite pins down:

- Pending grades are **unknown**, never zero.
- Points are normalized within a course before any cross-course comparison.
- Prerequisites are scheduled before the work that depends on them.
- Locked blocks never move; accepted blocks resist moving.
- Unschedulable work is **reported as a risk**, never silently dropped.
- Identical inputs produce an identical plan.

Run them with `pnpm test`.

## Status

Built: the monorepo, domain model, planning engine, theme layer, the AI coach with its
guardrail end-to-end, the Worker API on D1/R2 with magic-link auth, the PWA, and the Tauri
shell.

Not yet built — deliberately, per [`docs/07-mvp-roadmap.md`](docs/07-mvp-roadmap.md):
syllabus **extraction** (upload and storage work; parsing into reviewable claims does not),
the clarification inbox, milestone auto-decomposition, drag-and-drop week editing, grade
screenshot import, and notifications.
