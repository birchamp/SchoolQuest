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
| 4 | 7 | 7 | 7 | 7 | 7 | **PASS** |

Real defects the visual loop caught beyond styling: sessions from saved plans missing
their `minutes` field ("Wed · m"), duplicated course codes in group headers, emoji
rendering as tofu in headless font stacks, and one selector rewrite that briefly leaked
quest chrome into Plain.

## Open nits from the passing round (start here next iteration)

1. quest-week states counts twice: "— 13 items" in the summary plus the "13 unclaimed"
   wax pill. Plain got the dedup; quest should keep the pill and drop the number from the
   summary text instead.
2. The coach's parchment panel is a large empty field before any conversation exists —
   an inviting first-run state (a short in-character greeting from the guide, or the
   suggestion chips inside the panel) would fill it honestly.
3. Onboarding's "Sign out" sits close enough to the three theme cards to read as a fourth
   option; separate it visually.

## Deeper gamification backlog (the point of the loop)

- XP progression: completed sessions accrue XP from real points; a per-course "questline
  progress" readout. No streaks, no loss mechanics — docs/02-prd.md §3 forbids them.
- Campaign-map onboarding: courses as regions revealed as they are added.
- Quest completion moment: a calm, reduced-motion-safe acknowledgment when a session is
  completed (no confetti storms; the brief's tone is trust, not dopamine).
- Coach as DM: quest-theme system-prompt voice is already themed; the UI could surface
  "the guide's" framing more.

## Rules that hold regardless of round

- Everything scoped under `body[data-theme="quest"]` (plus the shared pre-theme book
  cover); Plain stays a calm modern planner.
- No external assets — CSS gradients and data-URI SVG only (CSP).
- Decorative glyphs `aria-hidden`; screen-reader labels stay plain-language; reduced
  motion suppresses every animation and transform.
