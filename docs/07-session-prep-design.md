# Design: the week as a prepared session

## The problem this solves

The Quest theme currently renames things. The week is called a "Region Map" and a study
block is called an "encounter", but the artefact underneath is a seven-column agenda grid.
A harsh review named it exactly: *"Region Map is a name, not a design… the clearest
instance of spreadsheet-in-costume."* Renaming a calendar does not make it a game.

So the question is not "what fantasy words can we apply to a planner". It is: **what does a
Dungeon Master actually do when preparing a session, and which of those practices are
genuinely useful to a student with executive-function difficulty?**

That framing matters because it is the only way the metaphor earns its place. If a DM
practice maps onto something a struggling student actually needs, the theme stops being
decoration and starts being the reason the feature is shaped well.

## What a DM actually does

Watch someone prep a session and they do six things:

1. **Read the terrain.** What is fixed and cannot move — the castle, the river. What is open
   ground.
2. **Choose the session's spine.** Not everything in the campaign; the one thing tonight is
   about. Everything else is texture around it.
3. **Pace the beats.** A session has shape. You do not put three combats back to back. You
   open light, escalate, land the set piece, wind down.
4. **Prep contingencies.** *"If the party skips the tavern, move the ambush to the road."*
   Good prep survives the players going off-script — which they always do.
5. **Track the campaign arc.** Which boss fights are approaching. Which threads the party
   has quietly abandoned.
6. **Recap.** *"Last time, at this table…"* Orient everyone before play starts.

## Why each one is useful to this specific student

The product brief targets students with **time blindness, weak prioritisation, and
difficulty starting**. Lined up against the DM's practices, the fit is unusually good:

| DM practice | What it fixes for the student | Data it comes from |
|---|---|---|
| Read the terrain | Immovable hours are visible, so the plan is believable | `meetingPatterns`, `commitments`, availability |
| Choose the spine | Prioritisation is the core deficit; one named focus beats a ranked list | scheduled minutes × priority score |
| Pace the beats | Stops a day of three high-demand blocks that will not happen | `cognitiveDemand` — already in the schema, currently unused in the UI |
| Prep contingencies | Recovery after a missed day is the documented failure mode | scheduler slack + due dates |
| Campaign arc | **Time blindness.** An exam three weeks out is invisible until it is not | `workType`, `dueAt`, prep blocks already laid |
| Recap | Re-entry after falling off; orients without re-reading everything | completed sessions since last plan version |

Note what is *not* on that list: streaks, XP multipliers, daily login rewards, decay. Those
are casino mechanics, not campaign mechanics, and `docs/02-prd.md` §3 forbids them. A DM
does not punish a player for missing last week's session; they recap and carry on. The
metaphor and the ethics point the same direction here, which is a good sign it is the right
metaphor.

## The design

### 1. Blocks become encounters with a *kind*

Every scheduled block is classified from real fields. The kind is derived, never authored:

| Kind (domain) | Quest wording | Derivation |
|---|---|---|
| `major_assessment` | Set piece | `workType` is exam or presentation; or paper/group project due within 48h |
| `back_to_back` | Gauntlet | 3+ blocks of one item in a day, or 3+ items due that day |
| `recurring` | Ritual | the item's title recurs across the course (weekly log, discussion post) |
| `first_pass` | Reconnaissance | the item is untouched and this is its first block |
| `short_block` | Skirmish | 30 minutes or less |
| `sustained` | Long march | everything else |

This does double duty. It gives each block character, and it **fixes a real defect**: three
identical "Lab Notebook" rows become one *Lab Gauntlet — 3 blocks, 1h 30m*. The repetition
the review kept flagging was the absence of this grouping.

### 2. The session brief

Above the grid, what a DM would actually have written down:

- **The spine** — *"This session turns on the BIO 240 Formal Lab Report: due Thursday, and it
  holds three of your blocks."* Computed as the item with the most scheduled minutes,
  tie-broken by due date.
- **The shape** — each day marked `heavy` / `steady` / `light` / `clear`, from summed
  minutes weighted by `cognitiveDemand`. This is the pacing rule made visible, and it is
  the first use of a field that has been in the schema since the beginning.
- **The crux** — the day the week turns on, named. Highest weighted load, or the day
  carrying a set piece.
- **Contingencies** — two or three, each computed, none generic:
  - *If you only get 25 minutes* → the shortest useful block that is actually next.
  - *If the crux day goes* → precisely which items lose their slack, by name.
  - *What slack exists* → real remaining capacity, or an honest "none".

### 3. The campaign arc

A term-length timeline of set pieces — exams, papers, presentations — each showing its
distance in days, its course sigil, and **how many prep blocks the plan has already laid
down for it**. That last number is the useful one, and it is not available anywhere in the
app today: *"Midterm in 12 days, 3 sessions prepared"* versus *"Final in 40 days, nothing
prepared yet"*.

This is the single highest-value item in the design. Time blindness is not solved by a
calendar; it is solved by making the horizon legible and showing whether the approach is
already under way.

### What building it changed

Two parts of the design above were wrong, and running the engine against the real
five-course semester rather than fixtures is what showed it:

- **Set pieces were nearly everything.** Classifying on `workType` alone made 12 of 23
  beats a "set piece" — a half-hour revision block three weeks out ranked with the exam
  itself. If everything is the climax, nothing is. A set piece is now the day the thing is
  actually *due*. The same lesson applied to the labels: the default kind is now unlabelled,
  because printing "Long march" nine times drowned out the beats that differ.
- **The arc was nearly empty.** Built only from dated work it showed three landmarks for a
  whole term, because 10 of 13 major items had no date any syllabus stated. Undated majors
  are reported separately now — and that list immediately surfaced four hours of prep
  scheduled against a Final Portfolio nobody has dated.

The second one is worth dwelling on, because it is the case the whole design turns out to
serve best. The three cards were written independently, and together they say: *the week's
spine is the Final Portfolio, it has no due date on record, and four hours are already
aimed at it.* Nothing composed that warning — it falls out of three separate derivations of
the same real data. That is the test of whether a metaphor is doing work: it made the shape
of the information better, not just its clothes.

### 4. Threads gone quiet *(designed, not yet built)*

Courses with open work and no completed session in a while. Stated as fact, never as
blame, and it decays nothing — it is a statement about where attention has gone, which is
information a student with a scattered week genuinely lacks.

### 5. The recap *(designed, not yet built)*

*"Since last week: three finished, one moved, four blocks released."* Requires diffing plan
versions, which the schema supports and no route does yet.

## Boundaries this design does not cross

- **The metaphor never carries meaning.** Every themed word has a plain equivalent that is
  what screen readers get, and every date, count, and deadline reads identically with the
  flavour stripped out.
- **The domain stays theme-neutral.** `major_assessment`, not `set_piece`. Only
  `packages/theme-language` is allowed to know the word "gauntlet".
- **Nothing is invented.** Every number traces to a real field. Where a field is missing —
  most syllabi never state point values — the design says so rather than filling the gap
  with a plausible figure.
- **No mechanic can go down.** Not from an idle day, not from a missed week, not ever.
