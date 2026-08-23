/**
 * The one source for in-app help.
 *
 * Deliberately written at the level of *concepts and vocabulary*, not click-by-click steps.
 * Concepts ("Skip means a block didn't happen but is still owed") survive a UI change; a
 * step-by-step ("press the Skip button on Today") rots the moment a label or layout moves --
 * and this app renames things (Skip, Skipped, Cancel all shifted in one week of work). Keeping
 * help conceptual is what makes it cheap to maintain: most UI tweaks never touch this file.
 *
 * `APP_LABELS` are the few user-facing words the guide leans on that also live as literal strings
 * in the app. `help-content.test.ts` checks each one still appears in the component it belongs to,
 * so a future rename fails a test instead of silently making this page wrong.
 */

export const APP_LABELS = {
  /** The study-block "didn't happen, still owed" action, on Today. */
  skipBlock: "Skipped",
  /** The assignment "not doing this at all" action, on the assignments list. */
  cancelTask: "Cancel",
  /** The calendar action that pins a study block to a chosen slot. */
  moveAndPin: "Move and pin",
} as const;

export interface HelpSection {
  heading: string;
  body: string[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    heading: "What SchoolQuest does",
    body: [
      "It reads your course syllabi and builds a weekly study plan around the time you actually have -- your classes, work, meals, and commitments. You stay in control: nothing is guessed silently, and nothing is ever assumed done.",
    ],
  },
  {
    heading: "Getting set up",
    body: [
      "Add your term calendar first -- its breaks and finals week. A syllabus says “Week 12” and “finals week” without saying which dates those are, so the calendar has to come first.",
      "Then add your courses and, where you can, their class meeting times. Knowing when a class meets lets the reader place work that is due “every class.”",
      "Then upload each syllabus. The reader pulls out dates, grading weights, and assignments for you to review.",
    ],
  },
  {
    heading: "Reading a syllabus",
    body: [
      "The file is read on your own computer, and nothing it finds changes your plan until you review and confirm it.",
      "When the syllabus is unclear, the app asks rather than guesses -- a due date with no year, work listed only by week, or class times it could not find. Your answers fill in the real dates. A date it can work out on its own -- a month and day in a term whose year is known -- it fills in without asking.",
    ],
  },
  {
    heading: "Your week, and today",
    body: [
      "Today shows the next thing worth doing. The week view shows every hour and what it is for -- and time with nothing on it is shown as free, because that is the room you actually have.",
    ],
  },
  {
    heading: "When things change: the words to know",
    body: [
      "Complete (“Mark done” / “Did it”): you finished the work. Its remaining study time is freed.",
      "Skip a study block: the block did not happen, but the work is still owed. Your week reflows to fit it back in -- skipping is never the same as finishing.",
      "Cancel an assignment: you are not doing this task at all, so it leaves the plan. The record is kept and can be put back later. (Cancel is for a whole task; Skip is for one study block -- they are different on purpose.)",
      "Move and pin: put a study block in a time that suits you. It is pinned there, the rest of your week reflows around it, and skipping it later unpins it.",
    ],
  },
  {
    heading: "Catch-up: nothing is assumed done",
    body: [
      "If study blocks come and go without being marked, the app never treats them as done. Before it reschedules anything, it shows you what slipped and asks what you actually did. A block you finished but forgot to check off is never quietly turned back into future work.",
    ],
  },
  {
    heading: "How the plan stays steady",
    body: [
      "A replan keeps everything still valid exactly where it is and moves only what it has to -- so the week you were counting on does not reshuffle every day. It never schedules work after its due date, and it will not overload a single day.",
    ],
  },
  {
    heading: "Warnings, not guilt",
    body: [
      "Courses shade toward yellow and red as their deadlines tighten -- a heads-up, not a scold. There are no streaks and no score that can go down. A missed block is information about your week, never a mark against you.",
    ],
  },
  {
    heading: "What you set, and what the app solves",
    body: [
      "You set the constraints: your study hours, when you are available, fixed commitments, meal times, and how much effort and weight each assignment carries. The planner solves around them. Change any of these and the week replans to match.",
    ],
  },
];
