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
| **Syllabus upload & extraction** | ✅ | ✗ — points you to the desktop app |
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
- **AI** — OpenRouter: `x-ai/grok-4.1-fast` for coach chat, `x-ai/grok-4.5` for syllabus
  extraction ([why the split](#which-model-runs-where))
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
docs/          The original product specification (8 documents), plus notes added since:
                 09-syllabus-ingest-passes.md   why ingest is one call, and what a pass
                                                boundary would have to buy to be worth it
                 10-syllabus-gotchas.md         a running log of what real syllabi actually
                                                do that breaks a reasonable assumption
```

`docs/10-syllabus-gotchas.md` is the one that keeps growing. Every entry quotes a real
syllabus, says what it costs the student, and is marked handled, partial, or open — and the
checkable ones are pinned by `packages/ai/src/extraction/gotchas.test.ts`, so an entry cannot
quietly stop being true. **Add to it whenever a new one turns up.**

Three rules hold this together:

1. **The planning engine never calls an LLM.** Same inputs and seed → same plan, every time.
   It is fully testable without a network.
2. **The LLM never writes to academic records.** The coach emits typed *proposed actions*;
   the student's click is what calls the API.
3. **No themed word appears in the domain or the database.** Metaphor lives only in
   `packages/theme-language`, applied at render time.

## Getting started

### Windows — clone, then one command

```powershell
git clone https://github.com/birchamp/SchoolQuest
cd SchoolQuest
powershell -ExecutionPolicy Bypass -File install.ps1
```

`install.ps1` does the rest: installs anything missing (Node, pnpm), installs dependencies, sets
up the local database, checks itself, puts a shortcut on your Desktop and opens the app. No
administrator rights, nothing outside your user account, and safe to run again.

After that, double-click **SchoolQuest** on the Desktop whenever you want it.

> **While this repository is private**, the clone above needs your GitHub credentials — which
> `git` on your machine already has. If it is ever made public, the whole thing collapses to one
> line with nothing to clone first:
>
> ```powershell
> irm https://raw.githubusercontent.com/birchamp/SchoolQuest/main/install.ps1 | iex
> ```
>
> That URL returns 404 for a private repository — GitHub answers 404 rather than 403 so that
> private repository names cannot be probed — so it will not work until then.

### Every platform — the same thing, by hand

```bash
git clone https://github.com/birchamp/SchoolQuest
cd SchoolQuest
pnpm install
pnpm setup       # writes apps/api/.dev.vars with a fresh AUTH_SECRET, creates the local database
pnpm preflight   # checks everything that would otherwise fail halfway through a session
pnpm dev         # Worker on :8787 and the app on :5173, together
```

Then open **http://127.0.0.1:5173** and sign in with any email address — with no mail provider
configured the sign-in link comes back on screen instead of being sent, which is what makes a
local run possible with no email account at all.

> Fine on your own machine, and **not safe on the public internet**: without a mail provider,
> anyone who can reach it can sign in as anyone.

`pnpm setup` is idempotent and never overwrites an existing `.dev.vars`, since that file may hold
a real key. `pnpm preflight` explains what to do about anything it finds — it exists because a
busy port looks like the app failing to start, an unmigrated database looks like a server crash,
and a placeholder API key looks like the model refusing to answer.

### On Windows, without the one-liner

Install [Node 22+](https://nodejs.org), [Git](https://git-scm.com), then `npm install -g pnpm`.
Run the commands above in PowerShell, then make the shortcut once:

```powershell
powershell -ExecutionPolicy Bypass -File tools\windows\create-shortcut.ps1
```

Run from the repository root. It puts **SchoolQuest** on your Desktop with the app icon;
double-clicking it checks the install, starts both halves and opens your browser once they are
actually answering. Leave the console window open while you use the app.

| | |
|---|---|
| `-StartMenu` | also add it to the Start Menu, so typing "schoolquest" finds it |
| `-Remove` | delete the shortcuts again |

[`docs/12-first-run.md`](docs/12-first-run.md) is the full walkthrough, including what each
failure actually means.

**The desktop app is a separate thing.** The shortcut above runs SchoolQuest in your browser,
which needs nothing built. The packaged `.exe` in [`apps/desktop`](apps/desktop/README.md) only
adds dragging syllabus PDFs straight in, and it needs a deployed API to talk to. It ships
unsigned, so Windows shows a SmartScreen warning;
[`docs/11-installing-on-windows.md`](docs/11-installing-on-windows.md) explains why and what to
do about it.

### Providing an OpenRouter key

Reading a syllabus is a paid API call. Each person adds their own key in the app under
**Setup → AI and model**, where it is encrypted at rest and never shown again. A whole
five-course semester costs about eleven cents on the strongest model.

Set `OPENROUTER_API_KEY` in `apps/api/.dev.vars` instead to give the whole installation one key —
useful for a single-user self-hosted setup, and the per-user key still overrides it.

### Other local commands

```bash
pnpm db:migrate:local        # after pulling — migrations are additive
pnpm db:seed:local           # loads the reference semester
pnpm db:reset-progress:local # back to "nothing done yet" without replaying extraction
pnpm dev:desktop             # the Tauri window (starts its own web dev server)
```

`db:reset-progress:local` clears session outcomes, recorded interruptions and the answers given
about them, leaving courses, dates and weights exactly as extraction produced them. It is not
scoped to one term — it resets every term in the local database.

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

Windows installers come from the **Windows installer** workflow, not from a local build; see
[`apps/desktop/README.md`](apps/desktop/README.md) for releasing and signing, and
[`docs/11-installing-on-windows.md`](docs/11-installing-on-windows.md) for what a student does
with the result.

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

### Which model runs where

Two models, and the split is driven by call frequency rather than by which job sounds
harder:

| | Model | Runs | Why |
|---|---|---|---|
| Coach chat + topic guard | `x-ai/grok-4.1-fast` | many times a day | Turns are short and grounded in plan data the engine already computed. The model summarizes; it does not reason from scratch. A fraction of a cent per turn. |
| Syllabus extraction | `x-ai/grok-4.5` | ~once per course per semester | Every date it reads becomes load-bearing for the whole plan, and extraction mistakes propagate silently into the schedule. |

Extraction on a frontier model costs roughly four cents per syllabus against half a cent
on a cheap one — pennies per semester either way. Given that the output is the foundation
of every plan the student sees, that is not a close call. Coach chat is the opposite: high
frequency, low stakes per call, so cheap is right there and not a compromise.

Override either with `OPENROUTER_COACH_MODEL` / `OPENROUTER_EXTRACTION_MODEL` in
`wrangler.toml`. Defaults live in `packages/ai/src/provider.ts`.

## Syllabus extraction

Upload a syllabus PDF in the desktop app and it becomes reviewable assignments, grading
categories, and meeting times — none of which touch the plan until you confirm them.

**Where the work happens.** The PDF is parsed **in the client**, not the Worker. The
Workers free plan allows 10ms of CPU per request, which cannot parse a PDF; waiting on a
model is I/O and costs no CPU budget. So the desktop app extracts per-page text with
pdf.js and sends that, and the Worker only calls the model and validates. pdf.js is a lazy
chunk and is excluded from the PWA precache — a phone never uploads a syllabus and should
not pay ~470 KB for the option.

**The model is a witness, not an authority.** Every claim must cite a page and quote the
text it read. `packages/ai/src/extraction/validate.ts` then checks that quote against the
actual page, and this is the load-bearing defense:

- **Quote not on the page → the claim is discarded**, and reported as discarded. Almost
  every dangerous extraction failure is a fluent invention, and an invented deadline
  cannot survive having to quote itself.
- **A date the model computed rather than read is stripped.** If it reports 2026-10-05 but
  no recognizable form of that date is in the text — because it silently resolved
  "Week 5" — the date is removed and becomes a question instead.
- **No time means no time.** 11:59 PM is a convention, not something a syllabus said. An
  unstated time is flagged as assumed.
- Dates outside the term are flagged as possibly last year's schedule; grading weights that
  do not total 100% raise a warning; near-identical titles are flagged as duplicates rather
  than silently merged.

Nothing extracted is ever marked `confirmed`. Items you confirm become `high_inference`,
and an item whose date never resolved stays `unconfirmed` with a null due date — the
planner schedules it without deadline pressure and raises a visible `DUE_DATE_UNKNOWN`
risk. An unknown that looks like a plan is worse than a visible gap.

**Prompt injection.** Syllabus text is untrusted input. The prompt says so explicitly, but
that is not what's relied on: injected instructions live on the page, so a claim quoting
them verifies — and is still just a claim, subject to every rule above. Nothing in the
document can change what the validator does.

Scanned PDFs are detected and refused with an explanation rather than a bad read; OCR is
not supported yet.

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
guardrail, syllabus extraction with evidence-checked review, the Worker API on D1/R2 with
magic-link auth, the PWA, and the Tauri shell.

Not yet built — deliberately, per [`docs/07-mvp-roadmap.md`](docs/07-mvp-roadmap.md):
milestone auto-decomposition (extracted major projects arrive as single items, not yet
broken into steps), a standalone clarification inbox spanning courses, drag-and-drop week
editing, grade screenshot import, OCR for scanned syllabi, and notifications.
