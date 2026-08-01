# Quest theme — critique ledger

The Quest theme is iterated under an adversarial loop: worker changes are screenshotted
through the real sign-in flow (`tools/e2e/shoot.mjs`) and judged by a deliberately harsh
"AAA art director" review against the bar *"would this ship in an expensive RPG's
companion app?"* — with an automatic score cap wherever readability fails. The Plain
theme is re-checked for leakage every round.

## Score history (each screen /10, PASS = all ≥7 and zero readability failures)

| Round | Onboarding | Today | Week | Coach | Setup | Verdict |
|---|---|---|---|---|---|---|
| 1 | 2 | 4 | 4 | 4 | 3 | CONTINUE — "Bootstrap with a sepia palette" |
| 2 | 4 | 7 | 7 | 7 | 6 | CONTINUE — onboarding shell unthemed, native file input |
| 3 | 7 | 7 | 7 | 7 | 6 | CONTINUE — file trigger bare, plain-week badge regression |
| 4 | 7 | 7 | 7 | 7 | 7 | PASS (superseded — see below) |
| 5 | 4 | 3 | 4 | 4 | 3 | CONTINUE — "not close"; first round to *measure* rather than look |

**Round 4's PASS did not survive contact with a tape measure.** Round 5 sampled actual
pixels and found seven contrast failures across five of six screens. The worst was the
Main Quest rationale — the "why this now?" sentence that is the product's whole thesis —
rendering cream on cream at **1.06:1**. Four rounds of review had passed it, because at
that ratio there is nothing to see. Treat any future PASS reached by eye alone as
provisional.

## Contrast is now measured, not judged

`node tools/e2e/contrast.mjs <theme>` walks the real DOM in the real browser and fails
anything under WCAG AA (4.5:1 body, 3:1 large). Run it before claiming a screen is done;
**both themes must report zero.** Two things it had to learn the hard way, and which any
change to it must preserve:

- Nearly every surface here is a stack of gradients. An early version declined to measure
  text on gradients — which is exactly where every failure lived.
- A gradient layer of all-transparent stops must not empty the candidate list. It did, and
  the script silently dropped 31 of 48 elements while reporting success. A checker that
  quietly skips work is worse than no checker.

The root cause it exposed is worth stating as a rule: **the Quest theme sets `--text` and
`--text-dim` for the dark leather page ground, so any surface that flips the ground to
parchment must re-point those tokens too.** `body[data-theme="quest"] .card` does this.
A new parchment surface that does not will be invisible in exactly the same way.

## Numbers must not flatter — the recurring defect class

Every round since progression landed has caught the interface stating something the data
did not support. In order found:

- Term XP gated on `pointsTotal > 0` printed "100 / 100 XP banked" beside "6 of 56 tasks".
  Gate on `basis === "points"` instead; the engine already decides when points are
  representative.
- The hero card's four pips came from *session length* but sat under "Questline: <course>",
  so a course the roster called "0 of 6 tasks, 0%" showed two filled pips. Progress
  indicators must read from the same ledger the roster prints.
- A four-pip scale cannot express 2 of 19 — it rounds to zero filled and reads as a broken
  glyph. Use a track.
- The capacity meter drew 99% booked as a full gold bar. In a game skin a full meter reads
  as *achieved*; it actually means fifteen minutes of slack left all week. It now shifts to
  amber then oxblood and says so in words.
- The completion banner claimed "the week redraws itself around what is left" while the
  forecast beneath it was pixel-identical. The fix was not softer copy — finishing an
  assignment now genuinely releases the blocks still held for it.

## Repetition is a defect, not a detail

The review counted, on one screen each: the same risk sentence printed twice, "Lab
Notebook" three times in the forecast, "Final Portfolio" five times in one map column, and
"THE GUIDE" → "THE GUIDE SPEAKS" → "ASK THE GUIDE" stacked in 250 vertical pixels. Each
read as a rendering fault. Risks are now collapsed and counted, the forecast groups by work
item, released blocks remove the map duplicates at source, and the coach has one heading.

## Glyphs

No tofu remains, but `⚑` (U+2691) has an emoji presentation and rendered as a bright
orange-red system glyph — the only saturated colour on a screen built from gold, oxblood
and cream. Verified safe here: `◆ ◇ ◈ ❖ ✦ ✧ ⚜`. The text-presentation selector is not
reliable in this container; pick a different codepoint instead.

## Round 6: the gameplay layer

Round 5's verdict — *"a competent web app with brown colours and a fantasy word list"* —
was about substance, not styling, so round 6 answered it with a design rather than a paint
pass: `docs/07-session-prep-design.md`. The week is now modelled on what a DM writes when
prepping a session, because each of those practices maps onto a documented need of the
target student. Three new surfaces: the **session brief** (spine, day shape, contingencies),
the **campaign arc** (term landmarks with prep counts), and the week grid rebuilt as
**beats** instead of one tile per block.

**The checker had a blind spot, and it was the important one.** It exempted `aria-hidden`
subtrees as decoration — but themed wording in this app is rendered as a visible
`aria-hidden` span beside an `.sr-only` plain twin, so *every themed string was exempt*,
which is exactly the text a theme is judged on. It reported zero while a "The crux" label
sat at 1.11:1. Decoration is now judged by content: a glyph with no letters in it. Turning
that on surfaced nine real failures immediately.

Corollary worth keeping: **two components copied a sigil chip style from before its contrast
fix landed.** When a shared visual is fixed, grep for its clones.

## Open from round 5 (start here next iteration)

1. **The heraldic sigils could go further** — the Setup shield is a real heater shield with
   a bordure and a per-bend field; the roster chip is still a rounded square. They agree on
   letters and colour but not on shape language.
2. Week columns are still forced to the tallest, leaving ragged empty parchment on light
   days.
Items 3, 4 and 5 from this list — the Setup tab's raw admin nouns and chevron-less
`<select>`, onboarding's native date/time controls, and onboarding's composition — were
closed in round 5's follow-up. Two lessons from closing them are worth keeping:

- **"Unstyleable" is usually untested.** The OS-blue focus highlight on a date segment was
  written off here as a native-control limitation. `::-webkit-datetime-edit-<x>-field:focus`
  genuinely does not parse from an author sheet, which is what made it look closed — but
  moving the `:focus` onto the host does land, and beats the UA's `background-color:
  highlight`. Leave the UA's `color: highlighttext` undeclared so the segment cursor
  survives; washing every segment gold is simpler and destroys it.
- **A dead column is worse than an ugly one.** `colorToken` existed so courses could be
  told apart and was never assigned, so every course chip rendered identically and the
  "recoloured avatar" critique was really a data bug wearing a styling costume. Check
  whether a field is populated before redesigning what it renders.

## Round 6 — meals and the weekly review

Four bugs in this round, and three of them were only findable by looking at real data
through the running app.

- **A default that is only ever right for the fixture is not a default.** Meals were
  honoured if and only if the student had typed them in as commitments. The seeded semester
  has Lunch and Dinner, so every screenshot for five rounds looked correct while a real
  student with no meal entries got blocks planned straight through noon every day. When a
  feature reads from a table, check what the table looks like when it is *empty*, not just
  what it looks like in the fixture.
- **A preference nothing reads is a lie the settings screen tells.** `breakMinutes` was
  declared, seeded, and never consulted, so the scheduler packed blocks end to end. This is
  the second time this round shape has appeared here — `colorToken` was the first. Grep for
  the reader before trusting the writer.
- **Deriving from history means auditing what history contains.** No replan had ever retired
  its predecessor's blocks, so three generations of one term left 83 live sessions where 26
  were real. They had been inflating "booked minutes" in project health for weeks with
  nobody noticing, because nothing had ever *asked* the sessions table a question about the
  past before.
- **Completing work must not rewrite the past.** Finishing an item released every block
  still held for it, with no lower time bound, so a Tuesday afternoon that had plainly gone
  unused vanished from the record the moment an unrelated item was ticked off. "This time is
  yours again" is a statement about the future.

One rule the tooling now encodes: `.beat-kind` and `.block.rest` both de-emphasise without
`opacity`, because the contrast checker still measures colour and a transparent element is
invisible to it. Every new quiet thing in this app is quiet by hierarchy, never by alpha.

## Round 7 — the dashboard

The board itself is new; two of its three bugs were the same shape as round 6's.

- **`--at-risk` and `--watch` are dark-page tokens.** Used on a parchment card they measured
  1.99:1 and **1.11:1** — the second is invisible, and it is the identical failure this
  ledger opens with. Every new coloured word on a quest card needs its own measured value;
  the amber that works elsewhere (#8a6f1f) is only 3.28:1 on the darkest parchment stop and
  had to be darkened to #6f5200 for 4.98:1.
- **A forward-only fix leaves the existing rows wrong, again.** Course creation was taught to
  hand out palette colours in round 5, so every course made *since* has one — and every
  course made before still held the schema default. `slate` is a valid token, so the
  deterministic fallback could not rescue them either. Five identical grey sigils on four
  screens, with the column populated so nothing looked broken. Same lesson as the superseded
  sessions: when a fix changes what gets written, ask what is already written.
- **Styling can contradict the model.** The board's fact line marked "nothing booked this
  week" in the attention colour unconditionally, including for a course the engine had
  deliberately judged fine because it has no work left. The verdict said steady and the line
  beside it argued back.

One design rule worth keeping: **a percentage is never shown without its basis.** A standing
drawn from three quizzes and one drawn from half the course are indistinguishable as a big
number, and `gradedWeightFraction` is zero whenever grades are not mapped to weighted
categories — which is most of the time. The board prints "71% · 3 results so far" rather than
"71% · 0% of the course graded", because the second is true and useless.

## Round 8 — the workflow audit

Auditing the eight workflows the app claims to support found four with no interface at all.
The engine could do them; nothing could ask it to. Two lessons beyond the features:

- **A verification tool that only visits the default view is measuring one sixth of the app.**
  The contrast checker walked five tabs in whichever mode the app happened to open in, so the
  new tables and the hour calendar — whole surfaces, each with its own grounds — were
  invisible to it and reported clean before they had been looked at once. It takes `SQ_VIEW`
  and `SQ_WEEK_VIEW` now, and both themes are measured in all three.
- **Transparency as de-emphasis, for the third time.** A calendar band's time prefix carried
  `opacity: 0.85` and measured 4.27:1. This exact mistake is already recorded twice in this
  file. If a thing should be quieter, give it a quieter colour and measure that colour.

And one that is about colour tokens rather than themes: `PLAIN_TINT` is a set of *foreground*
colours, and filling a chip with one and putting white letters on it fails for three of the
nine (verdant 4.11:1, teal 3.80:1, amber 4.42:1). Filled marks now go through
`courseChipFill`, which is dark by construction, so the next component cannot repeat it.

## Rules that hold regardless of round

- Everything scoped under `body[data-theme="quest"]` (plus the shared pre-theme book
  cover); Plain stays a calm modern planner.
- No external assets — CSS gradients and data-URI SVG only (CSP).
- Decorative glyphs `aria-hidden`; screen-reader labels stay plain-language; reduced
  motion suppresses every animation and transform.
- No streaks, no decay, no loss mechanics — `docs/02-prd.md` §3. Nothing may fall on an
  idle day, and a low bar is what is left to do, never a failure.
