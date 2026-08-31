/**
 * What the coach knows about SchoolQuest itself.
 *
 * A student who asks "what does skip mean?" is asking the only question the app cannot answer
 * anywhere else -- and until this existed the coach refused it. The scope gate read an app
 * question as off-topic ("anything else"), and "explain the difference between skip and delete"
 * hit the do-my-work prefilter on the word *explain*, so the one person in the product who could
 * have said what a button does declined to.
 *
 * That gap costs more here than in most apps. Four different controls decline four different
 * things, and picking the wrong one is destructive: "Not doing it" on work the student meant to
 * postpone drops it from the term, and "Delete" cannot be undone at all.
 *
 * The wording below is the single source the coach quotes. Two rules keep it honest:
 *
 *  - **Only what is really on screen.** A helpful-sounding invented control sends a student
 *    hunting for a button that does not exist, and they conclude the app is broken, not the
 *    coach. `coach.test.ts` pins these strings against the components that render them.
 *  - **Labels are literal.** The nouns are themed -- a course is a questline, a work session is
 *    an encounter -- but the buttons named here say the same words in every theme. A themed
 *    rename of a real button is a wrong instruction dressed as flavour.
 *
 * `docs/03-ux-and-interaction-spec.md` §3 carries the same table for humans; they are meant to
 * be changed together.
 */

/**
 * The three vocabularies, kept apart because they carry different weight.
 *
 * Review caught the cost of running them together: with `delete` and `skip` treated as app words
 * outright, "how do I delete a node from a binary tree?" and "what does skip mean in Python?" were
 * deterministically allowed as app help. Those are not edge cases, they are how a computing
 * student talks, and the answer they would have got is instructions for the assignments table.
 *
 *  - **Labels** name something only this app has. Nothing else is "not doing it" or
 *    "end of day assumed", so these are the only words that settle anything on their own.
 *  - **Everything else** -- controls whose names are plain English, actions a course could own,
 *    and the interface nouns themselves -- buys a message a reading by the classifier, never an
 *    answer without one.
 */
const APP_LABEL =
  /\b(not doing it|end of day assumed|show finished|add an assignment|schoolquest|this app|the app)\b/i;

/**
 * Every other word that might mean the interface -- controls whose names are ordinary English,
 * actions a course could own, and the interface nouns themselves.
 *
 * Kept as one list rather than three tiers, after five review passes taught the lesson three
 * different ways. First `delete` and `skip` alone allowed "how do I delete a node from a binary
 * tree?". Then `put back` and `mark done` alone allowed "how do I put back an item I popped from
 * a stack?". Then `tab` and `click` alone allowed "what is a tab character in Python?". Then
 * requiring *two* of them allowed "how do I remove a button in React?", because programming
 * coursework supplies both halves as a matter of course.
 *
 * The pattern is not that the line was in the wrong place four times. It is that no combination
 * of ordinary words can settle this, because the words are ordinary -- reading the sentence is
 * the job, and the classifier is the thing that reads sentences. These words earn a message the
 * right to be *read* rather than regex-refused; they never earn it an answer.
 */
const APP_ISH =
  /\b(skip|skipped|skipping|delete|deleted|deleting|undo|remove|toggle|screen|put back|handed in|not yet|mark done|needs more time|not now|button|buttons|tab|tabs|checkbox|press|presses|click|clicks|tap)\b/i;

/** Shapes that ask how something works, as opposed to asking for it to be done. */
const QUESTION_SHAPES: RegExp[] = [
  /\bwhat\s+(does|do|is|are|happens|will happen)\b/i,
  /\bwhat('?s)\b/i,
  /\b(how|where)\s+(do|can|would)\s+i\b/i,
  /\bdifference between\b/i,
  /\b(can|does|will)\s+(i|it|this|that)\b[^.?!]{0,40}\b(undo|undone|reversed|reversible|permanent)\b/i,
  // Imperative, but still a request to be told how something works rather than to have work done.
  // It carries no weight on its own: "explain the chapter" names nothing of this app and stays a
  // do-my-work request, while "explain the assignments tab" gets to reach a model.
  /\b(explain|tell me about|show me)\b/i,
];

/**
 * How confident the gate can be that this is a question about the app.
 *
 *  - `"app"` -- certain enough to allow without asking a model.
 *  - `"ambiguous"` -- app-shaped, but the only app word in it is one a course could own. The
 *    classifier decides, and the deterministic do-my-work refusal is held back for these, since
 *    it is the reason "explain the difference between skip and delete" was refused as a request
 *    to explain a reading.
 *  - `"none"` -- not about the app; nothing changes.
 */
export type AppHelpSignal = "app" | "ambiguous" | "none";

export function appHelpSignal(message: string): AppHelpSignal {
  if (!QUESTION_SHAPES.some((shape) => shape.test(message))) return "none";

  // Certain only for a string that exists nowhere but this app. Anything else app-ish is enough
  // to keep the do-my-work regexes off it -- that is the bug this path exists for, since `explain
  // the` refused "explain the difference between skip and delete" as a request to explain a
  // reading -- and not enough to answer it without a model.
  if (APP_LABEL.test(message)) return "app";
  return APP_ISH.test(message) ? "ambiguous" : "none";
}

/**
 * The section of the coach system prompt that describes the app.
 *
 * Every claim here is checked against a component in `coach.test.ts`; if a label changes on
 * screen, that test fails rather than the coach quietly telling students to press a button
 * that is no longer there.
 */
export const APP_HELP_PROMPT = `## How SchoolQuest itself works

Students ask what a control does, what a word on screen means, and where to do something. Answer
those. Quote the labels below exactly as written: they say the same words in every theme, and a
button you rename into the theme's vocabulary is a button the student cannot find. Never invent a
control that is not listed here -- if you do not know where something lives, say so plainly and
help with what they were trying to do instead.

Four different controls decline four different things, and the difference matters because two of
them are hard to take back:

- **"Not now"** (Today, on a work block) -- they are not doing that block. The block is recorded
  as not done, the hour goes back, and the work itself is still there to be scheduled again.
  Nothing is counted against them, and there are no streaks to lose. The app may then ask what
  came up instead; answering is optional and only helps it stop booking that hour.
- **"Not doing it"** (Assignments) -- the whole assignment is off for the term. Its status becomes
  "canceled", the record and any grade stay, and the filter button
  "Show finished and canceled too" brings it back into view. **"Put back"** reverses it.
- **"Delete"** (Assignments) -- for work that was never really assigned: something extraction read
  wrong, the same assignment twice, a row in the wrong course. It asks for confirmation, then
  takes the assignment's stages, the study time booked for it and any recorded score with it. It
  cannot be undone. Anything the student might want back later is "Not doing it", not this.
- **"Skip it" / "Skip this one" / "Rather not say"** -- these decline a *question the app asked*,
  never an assignment or a block. They record nothing and move on.

Other controls worth knowing:

- On Today: the start button begins the block and **"Mark done"** finishes it.
  **"Needs more time"** ends the session but leaves the work open for another one.
- On Assignments: **"Handed in"** means it has gone to the instructor with a grade still owed --
  it frees the study time still booked for it, and **"Not yet"** reverses it. A score can be
  written down on the row whenever it comes back.
- Each assignment carries a due date **and a time of day**. A deadline with no stated hour is
  taken as the end of that day, which is what "end of day assumed" under a row means; setting a
  real time changes when the planner books the work.
- The effort and worth boxes on each row are editable, and **"Add an assignment"** is for work an
  instructor set that is not in the syllabus.

Two things are worth saying whenever they fit: nothing a student declines is counted, tallied or
held against them, and the only irreversible control in the list is Delete.`;
