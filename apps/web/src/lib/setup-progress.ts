/**
 * What a term still needs before the app can do its job, and which thing to ask for next.
 *
 * Setup is not a list of settings, it is a chain, and every link is load-bearing:
 *
 *   provider -> calendar -> courses -> meetings
 *
 * The provider key is first because pasting a calendar reads it with the model, so with no key
 * that step fails after the student has already found and pasted their school's calendar page.
 * The calendar is before any syllabus because a syllabus does not contain dates, it *points* at
 * them -- "Week 14", "each Tuesday in class", "finals week" -- and read against an empty calendar
 * those do not fail loudly, they produce a confident wrong date.
 *
 * That order was already enforced, one control at a time, at the moment each was used: an upload
 * button that stays disabled, a paste that errors on a missing key. Enforcement without sequence
 * is how you get "you can't do this yet" with no statement of what to do instead -- which is a
 * particularly bad thing to hand an audience that finds multi-step processes costly.
 *
 * Note what is *not* a link in the chain: typing in course names. A syllabus states its own course
 * name and code on page one, the extraction already reads them into `courseFacts`, and the app
 * already stores that as a reviewable claim. Requiring the student to type in what the model is
 * about to read anyway made hand entry a prerequisite for the feature that removes hand entry. So
 * `courses` is satisfied by *having* courses, however they arrived, and uploading a syllabus is
 * the offered way to get them.
 *
 * Kept separate from the component, and pure, so the order and the gating can be tested without
 * rendering anything: this decides what a student is asked to do first on the day they sign up.
 */

export type SetupStepId = "provider" | "calendar" | "courses" | "meetings";

/** Everything the answer depends on, read from live state rather than remembered. */
export interface SetupFacts {
  /** A key is available -- the student's own, or one configured on the deployment. */
  providerConfigured: boolean;
  /** Dated entries in the term calendar: breaks, finals, no-class days. */
  calendarEntries: number;
  /** Courses on the term, however they arrived -- read from a syllabus or typed in. */
  courseCount: number;
  /** Courses with at least one known meeting pattern. */
  coursesWithMeetings: number;
}

export interface SetupStep {
  id: SetupStepId;
  done: boolean;
  /** False for steps worth doing that do not block the rest of the app. */
  required: boolean;
  /** Steps that must be finished first. */
  needs: SetupStepId[];
  /** False while anything in `needs` is unfinished. */
  unlocked: boolean;
  /** The unfinished step standing in the way, for saying so. Null when unlocked. */
  blockedBy: SetupStepId | null;
}

export interface SetupProgress {
  steps: SetupStep[];
  /**
   * The step to put in front of the student: the first one that is unfinished and reachable.
   * Falls back to the last step when everything is done, so the guide always has something to
   * render rather than needing a null check at every use.
   */
  currentId: SetupStepId;
  /** Every *required* step is done, so the app works. The optional ones may still be pending. */
  ready: boolean;
  /** Counted over required steps only -- a progress bar that can never fill is a lie. */
  doneCount: number;
  totalCount: number;
}

const ORDER: { id: SetupStepId; required: boolean; needs: SetupStepId[] }[] = [
  { id: "provider", required: true, needs: [] },
  { id: "calendar", required: true, needs: ["provider"] },
  // Needs the calendar because the offered way to add a course is to upload its syllabus, and
  // that is the rule the whole chain exists for. Typing a name in stays available underneath.
  { id: "courses", required: true, needs: ["calendar"] },
  // Optional, and last, because it is a confirmation rather than an entry: the syllabus usually
  // states when the class meets, so the question is "is this right", not "what is it". A student
  // whose syllabus said nothing about times still has a working planner without it.
  { id: "meetings", required: false, needs: ["courses"] },
];

function isDone(id: SetupStepId, facts: SetupFacts): boolean {
  switch (id) {
    case "provider":
      return facts.providerConfigured;
    case "calendar":
      return facts.calendarEntries > 0;
    case "courses":
      return facts.courseCount > 0;
    case "meetings":
      // Every course, not merely one: a term where three of four classes have times is exactly
      // the case worth still asking about.
      return facts.courseCount > 0 && facts.coursesWithMeetings >= facts.courseCount;
  }
}

export function setupProgress(facts: SetupFacts): SetupProgress {
  const done = new Map<SetupStepId, boolean>(ORDER.map((s) => [s.id, isDone(s.id, facts)]));

  const steps: SetupStep[] = ORDER.map((s) => {
    const blockedBy = s.needs.find((need) => !done.get(need)) ?? null;
    return {
      id: s.id,
      done: done.get(s.id) ?? false,
      required: s.required,
      needs: s.needs,
      unlocked: blockedBy === null,
      blockedBy,
    };
  });

  const required = steps.filter((s) => s.required);

  return {
    steps,
    currentId: (steps.find((s) => !s.done && s.unlocked) ?? steps[steps.length - 1]!).id,
    ready: required.every((s) => s.done),
    doneCount: required.filter((s) => s.done).length,
    totalCount: required.length,
  };
}
