import type { CourseHealth, HealthLevel } from "./course-health.js";

/**
 * What this needs from a course's health, which is less than `CourseHealth` guarantees.
 *
 * Concern codes are only ever tested for membership here, so `string` is enough -- and it has to
 * be, because the same values arrive from the API as JSON, where the interface holds them as
 * plain strings. Demanding the narrow union would force a cast at the one call site that matters
 * and buy nothing: a cast is a claim the compiler cannot check, which is worse than a type that
 * admits what it actually requires.
 */
export type CourseHealthLike = Omit<CourseHealth, "concerns"> & {
  concerns: readonly { code: string; level: "at_risk" | "needs_attention"; detail: string }[];
};

/**
 * Four dials per class, and the one thing to do next.
 *
 * ## What this is for
 *
 * The information needed to answer "is this class all right?" already exists, and it is spread
 * across four screens: whether it is set up at all is on Setup, the standing is on the stats
 * board, whether the week has time booked for it is on the week, and what is overdue is on
 * Today. A student holding a five-course term has to visit all four and hold the answers in
 * their head to compare classes -- which is precisely the working-memory bill this product
 * exists to pay.
 *
 * So this composes what those screens already compute. It measures nothing new; it puts the
 * existing measurements side by side and says which one is worst.
 *
 * ## The dials are honest or they are null
 *
 * A gauge that shows a number nobody can defend is worse than a gauge that admits it does not
 * know, because a filled dial reads as a fact. Every value here is a stated ratio:
 *
 *  - setup    - a weighted count of things that are set up, out of the things that could be.
 *  - grade    - the standing itself, against the target, with how much of the course has
 *               actually been graded carried alongside it. Early in a term a 100% drawn from
 *               one quiz is not a good grade, it is an unmeasured one, and it says so.
 *  - planning - blocks booked against items still open. One block per open item is full
 *               coverage; more than that is not "better", so it caps.
 *  - overall  - the worst of the three, value and level together, so the number and the colour
 *               never disagree about which one is being reported.
 *
 * Anything with nothing to measure is `null` with level "unknown", and the interface draws that
 * as an empty dial rather than an empty one at zero -- "nothing recorded" and "nothing achieved"
 * are different sentences.
 */

export type GaugeKey = "setup" | "grade" | "planning" | "overall";

export type GaugeLevel =
  /** Wrong, and it needs a decision rather than more effort. */
  | "bad"
  /** Worth doing something about, and cheap to do now. */
  | "watch"
  /** Nothing wrong. */
  | "good"
  /** Nothing to measure yet. Not the same as bad. */
  | "unknown";

/** Where a click should land. The interface owns the routing; this owns the choice. */
export type GaugeTarget =
  | "setup:calendar"
  | "setup:syllabus"
  | "setup:courses"
  | "setup:grading"
  | "setup:effort"
  | "today"
  | "week"
  | "stats";

export interface Gauge {
  key: GaugeKey;
  /** 0..1 for the dial. Null when there is nothing to measure. */
  value: number | null;
  level: GaugeLevel;
  /** One sentence, already specific. The interface prints it as-is. */
  detail: string;
}

export interface CourseGauges {
  courseId: string;
  gauges: Record<GaugeKey, Gauge>;
  /**
   * The single most useful next action, drawn from the worst dial.
   *
   * One, not a list. A class with four problems still has one thing to do first, and offering
   * four is how a student does none of them.
   */
  nextStep: { label: string; target: GaugeTarget } | null;
}

/** What Setup knows, which the health engine does not. */
export interface CourseSetupFacts {
  courseId: string;
  hasSyllabus: boolean;
  hasMeetingTimes: boolean;
  gradingKnown: boolean;
  workItemCount: number;
}

export interface CourseGaugesInput {
  health: readonly CourseHealthLike[];
  setup: readonly CourseSetupFacts[];
  /** Dated entries on the term calendar. Zero blocks syllabus reading for every class at once. */
  calendarEntries: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Worst wins. A class is only as healthy as its weakest dial. */
const SEVERITY: Record<GaugeLevel, number> = { bad: 3, watch: 2, good: 1, unknown: 0 };

function worst(levels: GaugeLevel[]): GaugeLevel {
  return levels.reduce<GaugeLevel>(
    (acc, level) => (SEVERITY[level] > SEVERITY[acc] ? level : acc),
    "unknown",
  );
}

/**
 * Weighted, because these are not equally load-bearing.
 *
 * Without a syllabus a class has no work in it and every other dial is measuring an empty
 * record, so it carries the most. Meeting times carry least: a syllabus that never printed them
 * is a fact about the syllabus, and the plan still works -- it just cannot avoid booking study
 * time on top of a lecture.
 */
const SETUP_WEIGHTS = { syllabus: 0.4, work: 0.3, grading: 0.2, meetings: 0.1 };

function setupGauge(facts: CourseSetupFacts, calendarEntries: number): Gauge {
  const value =
    (facts.hasSyllabus ? SETUP_WEIGHTS.syllabus : 0) +
    (facts.workItemCount > 0 ? SETUP_WEIGHTS.work : 0) +
    (facts.gradingKnown ? SETUP_WEIGHTS.grading : 0) +
    (facts.hasMeetingTimes ? SETUP_WEIGHTS.meetings : 0);

  // The calendar gates syllabus reading for every class at once, so a class with no syllabus
  // and no calendar is blocked rather than neglected, and saying "upload a syllabus" would send
  // the student to a control that is deliberately disabled.
  if (!facts.hasSyllabus && calendarEntries === 0) {
    return {
      key: "setup",
      value,
      level: "bad",
      detail: "The semester calendar has to come first -- a syllabus cannot be read without it.",
    };
  }

  if (!facts.hasSyllabus) {
    return {
      key: "setup",
      value,
      level: "bad",
      detail:
        facts.workItemCount > 0
          ? "No syllabus, so anything not entered by hand is missing."
          : "No syllabus and no work, so this class is empty.",
    };
  }

  if (facts.workItemCount === 0) {
    return {
      key: "setup",
      value,
      level: "bad",
      detail: "A syllabus was read but no work came out of it, which is worth a look.",
    };
  }

  const missing: string[] = [];
  if (!facts.gradingKnown) missing.push("how it is graded");
  if (!facts.hasMeetingTimes) missing.push("when it meets");

  return {
    key: "setup",
    value,
    level: missing.length > 0 ? "watch" : "good",
    // Not "bad": a syllabus that never stated these is common, and the class works without them.
    detail:
      missing.length > 0
        ? `Set up, but nobody has said ${missing.join(" or ")}.`
        : "Everything this class needs is set up.",
  };
}

/**
 * Below this share of the course graded, a standing is a sample rather than a position.
 *
 * Two quizzes into a term, 100% and 60% are both mostly noise, and a dial that reads them as
 * "excellent" and "failing" invites a student to relax or panic over four points.
 */
const MEANINGFUL_GRADED_FRACTION = 0.15;

function gradeGauge(health: CourseHealthLike): Gauge {
  if (health.gradePercent === null) {
    return {
      key: "grade",
      value: null,
      level: "unknown",
      detail:
        health.ungradedResults > 0
          ? `${health.ungradedResults} finished ${health.ungradedResults === 1 ? "item has" : "items have"} no result recorded yet.`
          : "Nothing has been graded yet.",
    };
  }

  const value = clamp01(health.gradePercent / 100);
  const target = health.targetPercent;
  const early = health.gradedWeightFraction < MEANINGFUL_GRADED_FRACTION;
  const share = Math.round(health.gradedWeightFraction * 100);

  if (early) {
    return {
      key: "grade",
      value,
      // Deliberately not a verdict. Too little is in for this to mean anything either way.
      level: "unknown",
      detail: `${Math.round(health.gradePercent)}% so far, but only ${share}% of the course has been graded.`,
    };
  }

  if (health.gradePercent < target - 5) {
    return {
      key: "grade",
      value,
      level: "bad",
      detail: `${Math.round(health.gradePercent)}%, below the ${target}% ${health.targetIsOwn ? "you set" : "default"}, on ${share}% of the course.`,
    };
  }

  if (health.gradePercent < target) {
    return {
      key: "grade",
      value,
      level: "watch",
      detail: `${Math.round(health.gradePercent)}%, just under ${target}%, on ${share}% of the course.`,
    };
  }

  return {
    key: "grade",
    value,
    level: "good",
    detail: `${Math.round(health.gradePercent)}%, at or above ${target}%, on ${share}% of the course.`,
  };
}

/** Concerns that mean the week is not booked well enough, worst first. */
const PLANNING_CONCERNS = new Set([
  "UNPLANNED_WEEK",
  "DEADLINE_UNPREPARED",
  "PROJECT_PAST_DUE",
  "PROJECT_WILL_NOT_FIT",
  "PROJECT_STALLED",
  "UPKEEP_BEHIND",
]);

function planningGauge(health: CourseHealthLike): Gauge {
  if (health.openItems === 0) {
    return {
      key: "planning",
      value: 1,
      level: "good",
      detail: "Nothing open, so there is nothing to book.",
    };
  }

  // A stated ratio: one block per open item is full coverage. More is not better, so it caps --
  // six blocks against two items is not three times as ready.
  const value = clamp01(health.blocks / health.openItems);
  const concern = health.concerns.find((c) => PLANNING_CONCERNS.has(c.code));

  if (concern) {
    return {
      key: "planning",
      value,
      level: concern.level === "at_risk" ? "bad" : "watch",
      detail: concern.detail,
    };
  }

  if (health.blocks === 0) {
    const due =
      health.nextDueInDays !== null && health.nextDueInDays <= 7
        ? ` The next thing is due in ${health.nextDueInDays} ${health.nextDueInDays === 1 ? "day" : "days"}.`
        : "";
    return {
      key: "planning",
      value,
      level: "watch",
      detail: `${health.openItems} open, and no time booked this week.${due}`,
    };
  }

  return {
    key: "planning",
    value,
    level: "good",
    detail: `${health.blocks} ${health.blocks === 1 ? "block" : "blocks"} booked against ${health.openItems} open.`,
  };
}

/**
 * The one thing to do next, chosen from the worst dial.
 *
 * Order matters where two are equally bad: setup first, because a class that is not set up is
 * one whose other two dials are measuring an incomplete record, and acting on those numbers
 * before the record is whole is acting on the wrong information.
 */
function chooseNextStep(
  gauges: Record<GaugeKey, Gauge>,
  facts: CourseSetupFacts,
  calendarEntries: number,
): CourseGauges["nextStep"] {
  const ranked: { gauge: Gauge; step: { label: string; target: GaugeTarget } }[] = [];

  if (gauges.setup.level === "bad" || gauges.setup.level === "watch") {
    if (calendarEntries === 0) {
      ranked.push({ gauge: gauges.setup, step: { label: "Fill in the semester calendar", target: "setup:calendar" } });
    } else if (!facts.hasSyllabus) {
      ranked.push({ gauge: gauges.setup, step: { label: "Upload the syllabus", target: "setup:syllabus" } });
    } else if (!facts.gradingKnown) {
      ranked.push({ gauge: gauges.setup, step: { label: "Say how it is graded", target: "setup:grading" } });
    } else if (!facts.hasMeetingTimes) {
      ranked.push({ gauge: gauges.setup, step: { label: "Add the class times", target: "setup:courses" } });
    }
  }

  if (gauges.planning.level === "bad" || gauges.planning.level === "watch") {
    ranked.push({ gauge: gauges.planning, step: { label: "Look at the week", target: "week" } });
  }

  if (gauges.grade.level === "bad" || gauges.grade.level === "watch") {
    ranked.push({ gauge: gauges.grade, step: { label: "Check the standing", target: "stats" } });
  }

  // Stable: `sort` on an already-ordered list keeps setup ahead of planning ahead of grade when
  // they tie, which is the priority the comment above states.
  ranked.sort((a, b) => SEVERITY[b.gauge.level] - SEVERITY[a.gauge.level]);
  return ranked[0]?.step ?? null;
}

const LEVEL_FROM_HEALTH: Record<HealthLevel, GaugeLevel> = {
  at_risk: "bad",
  needs_attention: "watch",
  steady: "good",
};

export function courseGauges(input: CourseGaugesInput): CourseGauges[] {
  const setupByCourse = new Map(input.setup.map((facts) => [facts.courseId, facts]));

  return input.health.map((health) => {
    const facts = setupByCourse.get(health.courseId) ?? {
      courseId: health.courseId,
      hasSyllabus: false,
      hasMeetingTimes: false,
      gradingKnown: false,
      workItemCount: 0,
    };

    const setup = setupGauge(facts, input.calendarEntries);
    const grade = gradeGauge(health);
    const planning = planningGauge(health);

    /**
     * The worst dial's own value, not the mean of the three.
     *
     * Read off the rendered board: averaging gave a class 90 in amber, because the number was an
     * average and the colour was the worst -- two different aggregations in one dial, each
     * contradicting the other. A student reading 90 and seeing amber has to work out which half
     * to believe. Reporting the value of whichever dial set the level makes the number and the
     * colour tell the same story, and that story is the one that matters: the weakest link.
     */
    const known = [setup, grade, planning].filter((g) => g.value !== null);
    const overallValue = known.length === 0 ? null : Math.min(...known.map((g) => g.value ?? 1));

    /**
     * The worst of the three, never the average of them.
     *
     * A class set up perfectly, graded well, and with nothing booked the week three deadlines
     * land is not "mostly fine" -- averaging levels is how the one dial that matters gets hidden
     * behind two that do not. The engine's own verdict is folded in for the same reason: it sees
     * concerns these three do not model.
     */
    const overall: Gauge = {
      key: "overall",
      value: overallValue,
      level: worst([setup.level, grade.level, planning.level, LEVEL_FROM_HEALTH[health.level]]),
      detail: "",
    };

    const gauges = { setup, grade, planning, overall };
    overall.detail =
      overall.level === "good"
        ? "Nothing needs a decision here."
        : ([setup, planning, grade].find((g) => g.level === overall.level) ?? setup).detail;

    return {
      courseId: health.courseId,
      gauges,
      nextStep: chooseNextStep(gauges, facts, input.calendarEntries),
    };
  });
}
