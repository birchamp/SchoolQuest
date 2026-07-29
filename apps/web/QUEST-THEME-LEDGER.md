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

## Open from round 5 (start here next iteration)

1. **"Region Map" is a name, not a design** — a seven-column agenda grid with no terrain,
   path, or nodes, and four columns of empty parchment because all are forced to the
   tallest. The clearest remaining instance of spreadsheet-in-costume. Its flavour line
   promises "fixed banners hold their ground" and nothing on the map is drawn as a banner.
2. **The heraldic sigils are not heraldic** — a rounded olive-grey square with "BIO" set in
   it, structurally identical to Plain's chip. The olive-grey is also the only off-palette
   colour in the build.
3. **The Setup tab abandons the theme** — raw admin nouns, and the syllabus `<select>` had
   its native chevron stripped without replacement, so it cannot be identified as a control.
4. **Onboarding's native date and time inputs** render OS placeholders, OS picker glyphs,
   and an OS-blue selection highlight.
5. Onboarding composition: content clings to the top-left of the canvas, the chart panel's
   bottom edge misses the form's by 45px, and day chips wrap 6+1 orphaning "Sat".

(3, 4 and 5 are in flight with workers as of this writing.)

## Rules that hold regardless of round

- Everything scoped under `body[data-theme="quest"]` (plus the shared pre-theme book
  cover); Plain stays a calm modern planner.
- No external assets — CSS gradients and data-URI SVG only (CSP).
- Decorative glyphs `aria-hidden`; screen-reader labels stay plain-language; reduced
  motion suppresses every animation and transform.
- No streaks, no decay, no loss mechanics — `docs/02-prd.md` §3. Nothing may fall on an
  idle day, and a low bar is what is left to do, never a failure.
