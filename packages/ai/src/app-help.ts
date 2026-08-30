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
 * Words that mark a question as being about the app rather than about coursework.
 *
 * Deliberately app-specific: "the reading", "the chapter" and "this problem" are absent, so
 * "explain the chapter" is still a request to do the coursework. Matching here only ever *opens*
 * a door that was otherwise closed -- see the prefilter's ordering.
 */
export const APP_NOUN = String.raw`skip|skipped|skipping|delete|deleted|deleting|not doing it|put back|handed in|not yet|not now|mark done|needs more time|add an assignment|show finished|end of day assumed|button|buttons|tab|tabs|screen|checkbox|toggle|this app|the app|schoolquest`;

/**
 * Question shapes that, combined with an app word, are asking how the app works.
 *
 * Kept to interrogatives and "difference between": a bare mention of a button inside a sentence
 * about coursework must not become a bypass.
 */
export const APP_HELP_PATTERNS: RegExp[] = [
  // "what does skip mean", "what does the delete button do", "what is 'not doing it'"
  new RegExp(
    String.raw`\b(what|which)\b[^.?!]{0,40}\b(${APP_NOUN})\b[^.?!]{0,40}\b(mean|means|do|does|is|are|for)\b`,
    "i",
  ),
  // "what does the skip button do" with the verb before the noun, and "what happens if I skip"
  new RegExp(String.raw`\bwhat\s+(happens|will happen)\b[^.?!]{0,40}\b(${APP_NOUN})\b`, "i"),
  // "how do I delete an assignment", "where do I change the due time"
  new RegExp(String.raw`\b(how|where)\s+(do|can|would)\s+i\b[^.?!]{0,40}\b(${APP_NOUN})\b`, "i"),
  // "difference between skip and delete" -- the question this whole module exists for.
  new RegExp(String.raw`\bdifference between\b[^.?!]{0,60}\b(${APP_NOUN})\b`, "i"),
  // "can I undo delete", "does skip delete it"
  new RegExp(
    String.raw`\b(can|does|will|is)\s+(i|it|this|that|skip|delete)\b[^.?!]{0,40}\b(undo|undone|reversible|permanent|delete|remove|lose|lost)\b`,
    "i",
  ),
];

/** True when the message is asking how the app itself works. */
export function isAppHelp(message: string): boolean {
  return APP_HELP_PATTERNS.some((pattern) => pattern.test(message));
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
