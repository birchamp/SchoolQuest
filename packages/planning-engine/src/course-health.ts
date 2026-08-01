import {
  MINUTES_PER_DAY,
  toEpochMinutes,
  type Course,
  type CourseStanding,
  type GradeResult,
  type GradingCategory,
  type WorkItem,
} from "@schoolquest/domain";
import type { CourseLoad } from "./course-load.js";
import type { ProjectProgress } from "./project-progress.js";

/**
 * How each course is actually doing, in one verdict a student can read at a glance.
 *
 * Every other view answers one question well and none of them answer "which of my classes
 * needs me?". The week map shows time, the arc shows landmarks, the roster shows completion,
 * the grade page shows standing — a student holding five courses has to assemble the answer
 * themselves from four screens, and assembling things from four screens is the exact deficit
 * this product exists to compensate for.
 *
 * ## What is on the board, and what is deliberately not
 *
 * A dashboard fails by showing everything. These earn their place because each one changes
 * what the student would do next:
 *
 *  - **The verdict and the one reason behind it.** Not a score. A score invites the question
 *    "is 72 good?", which has no answer; a named reason is already half an instruction.
 *  - **What is next, and how far away.** The single most-asked question about a course.
 *  - **Time booked for it this week.** Zero is the finding: a course with open work and no
 *    plan is the commonest way a class quietly slides, and it is invisible everywhere else.
 *  - **The grade, always beside how much of the grade is known.** A percentage drawn from 8%
 *    of the course's weight is not a grade, it is a rumour, and showing it bare is the
 *    single most misleading thing a student dashboard can do.
 *
 * Left off on purpose: completion percentages (the roster owns them, and mid-term they
 * flatter), invested minutes (effort is not outcome), and share-of-week (the week's own
 * table owns the division of time). Each was considered and each would have added a number
 * without adding a decision.
 *
 * ## Two rules the wording and the maths both obey
 *
 * First, **nothing here is a punishment and nothing accumulates.** No streak, no decay, no
 * ground that can be lost (`docs/02-prd.md` §3). Every concern names a thing that is true
 * right now and stops being true the moment it is addressed. "Needs attention" is a to-do,
 * not a grade on the student.
 *
 * Second, **unknown is not bad.** This matters more than it sounds. Measured against the
 * real five-course semester, *every* course has a null estimated grade and zero graded
 * weight, because nothing has been handed back yet — which is the honest state of any term
 * in its first weeks and of many students all term. A model that docks health for missing
 * grades would paint all five red on day one, and a board that is entirely red is a board
 * with no signal in it. So grade concerns fire only once there is something real to say:
 * work that came back and was never recorded, or a standing drawn from enough of the course
 * to mean something.
 *
 * Pure, like the rest of the engine. Every figure traces to a work item, a session, or a
 * grade the student can go and look at.
 */

export type HealthLevel =
  /** Something needs a decision, not just more effort. */
  | "at_risk"
  /** Actionable now, and cheap to fix now. */
  | "needs_attention"
  /** Nothing is wrong. */
  | "steady";

export type ConcernCode =
  /** Open work, deadlines coming, and not a minute booked for it this week. */
  | "UNPLANNED_WEEK"
  /** Something is due within days and less time is booked than it needs. */
  | "DEADLINE_UNPREPARED"
  | "PROJECT_PAST_DUE"
  | "PROJECT_WILL_NOT_FIT"
  | "PROJECT_STALLED"
  /** Standing is below the target the student set, or below the default floor. */
  | "GRADE_BELOW_TARGET"
  /** Work came back and the result was never recorded, so the standing is stale. */
  | "GRADES_UNRECORDED"
  /** Recurring work has slipped. */
  | "UPKEEP_BEHIND"
  /** Nothing has been finished in this course for a while, and it still has work open. */
  | "GONE_QUIET"
  /** The grading scheme does not add up, so no standing drawn from it can be trusted. */
  | "GRADE_STRUCTURE_INCOMPLETE";

export interface CourseConcern {
  code: ConcernCode;
  level: Exclude<HealthLevel, "steady">;
  /** One sentence, already specific. The interface prints this as-is. */
  detail: string;
}

export interface CourseHealth {
  courseId: string;
  level: HealthLevel;
  /** Worst first. Empty when the course is steady. */
  concerns: CourseConcern[];

  /** Minutes booked for this course in the current horizon, and how many blocks. */
  bookedMinutes: number;
  blocks: number;
  openItems: number;

  nextDueAt: string | null;
  nextDueTitle: string | null;
  /** Whole days until the next thing is due; negative is past due. */
  nextDueInDays: number | null;

  /**
   * Estimated standing, and the share of the course's weight it is drawn from. The two are
   * always carried together so no caller can render one without the other.
   */
  gradePercent: number | null;
  gradedWeightFraction: number;
  /** Individual results recorded. Carries the standing when no weights are declared. */
  gradedCount: number;
  /** The target this is judged against — the student's own, or the default floor. */
  targetPercent: number;
  targetIsOwn: boolean;

  /** Items that were finished and never given a result. */
  ungradedResults: number;
}

export interface TermHealth {
  courses: CourseHealth[];
  coursesAtRisk: number;
  coursesNeedingAttention: number;
  coursesSteady: number;
  /** Courses with open work and nothing booked this week. The headline finding. */
  coursesUnplanned: number;
}

/**
 * The floor a course is judged against when the student has not named a target.
 *
 * Eighty is the bottom of a B on the ordinary scale. It is a default, not a judgement about
 * what a student ought to get: `Course.targetGrade` always wins when it is set, and the
 * interface says which of the two it is using so the number is never mistaken for the app
 * having an opinion about them.
 */
export const DEFAULT_TARGET_PERCENT = 80;

/**
 * How much of a course's weight must be graded before a standing is worth judging.
 *
 * Below this a percentage is one quiz wearing a costume. Firing "below target" off 5% of the
 * course would be both alarming and meaningless, and the alarm is the part that does damage.
 */
const MIN_GRADED_WEIGHT_FOR_JUDGEMENT = 0.15;

/**
 * The other way a standing earns the right to be judged: enough individual results.
 *
 * Weight coverage alone was not a workable gate. `computeCourseStanding` only fills in
 * `gradedWeightFraction` when the graded work maps onto categories that carry declared
 * weights; a grade on an item with no grading category produces a percentage and a coverage
 * of exactly zero. That is the common case, not an edge one — extraction rarely maps every
 * item to a category, and a student typing in three exam scores gets no category at all. So
 * a gate on weight alone would have meant the below-target signal never fired for most
 * students, which is a silent failure of the kind this codebase keeps finding.
 *
 * Three real results is a small number, and deliberately so: it is enough that the reading
 * is not one bad morning, and the sentence always says which basis it used.
 */
const MIN_GRADED_ITEMS_FOR_JUDGEMENT = 3;

/** A deadline this close is near enough that being unprepared for it is worth saying. */
const IMMINENT_DAYS = 3;

/** No finished work in this long, with work still open, is worth a word. */
const QUIET_DAYS = 10;

/** Grading category weights that miss 100 by more than this are incomplete, not rounded. */
const WEIGHT_TOLERANCE = 2;

export interface CourseHealthInput {
  courses: readonly Course[];
  workItems: readonly WorkItem[];
  grades: readonly GradeResult[];
  gradingCategories: readonly GradingCategory[];
  standings: Record<string, CourseStanding>;
  /** This week's division of time, from computeCourseLoad. */
  load: readonly CourseLoad[];
  /** Per-project health, from computeProjectProgress. */
  projects: readonly ProjectProgress[];
  /** ISO instant. */
  now: string;
}

export function computeCourseHealth(input: CourseHealthInput): TermHealth {
  const now = toEpochMinutes(input.now);
  const loadById = new Map(input.load.map((l) => [l.courseId, l]));
  const gradedItemIds = new Set(input.grades.map((g) => g.workItemId));

  const courses = input.courses.map((course) => {
    const load = loadById.get(course.id);
    const standing = input.standings[course.id];
    const projects = input.projects.filter((p) => p.courseId === course.id);
    const items = input.workItems.filter((w) => w.courseId === course.id);

    const targetPercent = course.targetGrade ?? DEFAULT_TARGET_PERCENT;
    const gradedWeightFraction = standing?.gradedWeightFraction ?? 0;
    const gradePercent = standing?.estimatedPercent ?? null;
    const ungradedResults = countUngradedResults(items, gradedItemIds, now);
    const gradedCount = items.filter((w) => gradedItemIds.has(w.id)).length;

    const concerns: CourseConcern[] = [
      ...planningConcerns(load, items, now),
      ...projectConcerns(projects),
      ...gradeConcerns({
        course,
        gradePercent,
        gradedWeightFraction,
        gradedCount,
        targetPercent,
        ungradedResults,
        categories: input.gradingCategories.filter((c) => c.courseId === course.id),
      }),
      ...rhythmConcerns(load),
    ];

    concerns.sort((a, b) => rank(b.level) - rank(a.level));

    const nextDueAt = load?.nextDueAt ?? null;

    return {
      courseId: course.id,
      level: concerns[0]?.level ?? "steady",
      concerns,
      bookedMinutes: load?.bookedMinutes ?? 0,
      blocks: load?.blocks ?? 0,
      openItems: load?.openItems ?? 0,
      nextDueAt,
      nextDueTitle: load?.nextDueTitle ?? null,
      nextDueInDays:
        nextDueAt === null
          ? null
          : Math.floor((toEpochMinutes(nextDueAt) - now) / MINUTES_PER_DAY),
      gradePercent,
      gradedWeightFraction,
      gradedCount,
      targetPercent,
      targetIsOwn: course.targetGrade !== null,
      ungradedResults,
    } satisfies CourseHealth;
  });

  // Worst first: the board's whole job is that the course needing most is at the top.
  courses.sort(
    (a, b) =>
      rank(b.level) - rank(a.level) ||
      b.concerns.length - a.concerns.length ||
      a.courseId.localeCompare(b.courseId),
  );

  return {
    courses,
    coursesAtRisk: courses.filter((c) => c.level === "at_risk").length,
    coursesNeedingAttention: courses.filter((c) => c.level === "needs_attention").length,
    coursesSteady: courses.filter((c) => c.level === "steady").length,
    coursesUnplanned: courses.filter((c) =>
      c.concerns.some((x) => x.code === "UNPLANNED_WEEK"),
    ).length,
  };
}

function rank(level: HealthLevel): number {
  return level === "at_risk" ? 2 : level === "needs_attention" ? 1 : 0;
}

/**
 * Whether this week's plan actually covers the course.
 *
 * A course with open work and nothing booked is the commonest way a class slides out of
 * view, and it is the one thing no other screen states: the week map shows what *is*
 * planned, so a course missing from it is an absence, and absences do not draw the eye.
 */
function planningConcerns(
  load: CourseLoad | undefined,
  items: readonly WorkItem[],
  now: number,
): CourseConcern[] {
  const concerns: CourseConcern[] = [];
  const open = load?.openItems ?? 0;
  if (open === 0) return concerns;

  if ((load?.bookedMinutes ?? 0) === 0) {
    concerns.push({
      code: "UNPLANNED_WEEK",
      level: "needs_attention",
      detail: `Nothing is booked for this course this week, and ${open} ${
        open === 1 ? "piece of work is" : "pieces of work are"
      } still open.`,
    });
  }

  // Something due within days that this week's plan has barely touched. Measured against
  // booked minutes for the course as a whole rather than per item, because the student's
  // question is "have I left myself time", not "is the allocation optimal".
  const imminent = items.filter((item) => {
    if (!item.dueAt) return false;
    if (item.status === "completed" || item.status === "submitted") return false;
    if (item.status === "canceled" || item.status === "optional") return false;
    const days = (toEpochMinutes(item.dueAt) - now) / MINUTES_PER_DAY;
    return days >= 0 && days <= IMMINENT_DAYS;
  });

  if (imminent.length > 0 && (load?.bookedMinutes ?? 0) > 0) {
    const needed = imminent.reduce(
      (sum, item) => sum + (item.remainingMinutes ?? item.estimatedMinutes ?? 0),
      0,
    );
    if (needed > 0 && (load?.bookedMinutes ?? 0) < needed) {
      concerns.push({
        code: "DEADLINE_UNPREPARED",
        level: "needs_attention",
        detail: `${imminent.length} ${
          imminent.length === 1 ? "thing is" : "things are"
        } due within ${IMMINENT_DAYS} days, needing about ${Math.round(needed / 60)}h, and ${
          Math.round((load?.bookedMinutes ?? 0) / 60)
        }h is booked.`,
      });
    }
  }

  return concerns;
}

function projectConcerns(projects: readonly ProjectProgress[]): CourseConcern[] {
  const concerns: CourseConcern[] = [];

  const pastDue = projects.filter((p) => p.health === "past_due");
  if (pastDue.length > 0) {
    concerns.push({
      code: "PROJECT_PAST_DUE",
      level: "at_risk",
      detail: `${quote(pastDue[0]!.title)} is past its due date${
        pastDue.length > 1 ? `, along with ${pastDue.length - 1} more` : ""
      }.`,
    });
  }

  const wontFit = projects.filter((p) => p.health === "will_not_fit");
  if (wontFit.length > 0) {
    concerns.push({
      code: "PROJECT_WILL_NOT_FIT",
      level: "at_risk",
      detail: `${quote(wontFit[0]!.title)} needs more time than the weeks before it hold.`,
    });
  }

  const stalled = projects.filter((p) => p.health === "stalled");
  if (stalled.length > 0) {
    concerns.push({
      code: "PROJECT_STALLED",
      level: "needs_attention",
      detail: `${quote(stalled[0]!.title)} was started and has not moved in a while.`,
    });
  }

  return concerns;
}

function gradeConcerns(input: {
  course: Course;
  gradePercent: number | null;
  gradedWeightFraction: number;
  /** Individual results recorded. Carries the standing when no weights are declared. */
  gradedCount: number;
  targetPercent: number;
  ungradedResults: number;
  categories: GradingCategory[];
}): CourseConcern[] {
  const concerns: CourseConcern[] = [];

  // Work that came back and was never written down. This is what "grades are not entered"
  // actually means — not the absence of grades in week two, which is simply how a term
  // starts, but a result that exists in the world and not in the plan.
  if (input.ungradedResults > 0) {
    concerns.push({
      code: "GRADES_UNRECORDED",
      level: "needs_attention",
      detail: `${input.ungradedResults} finished ${
        input.ungradedResults === 1 ? "piece of work has" : "pieces of work have"
      } no result recorded, so this course's standing is out of date.`,
    });
  }

  const byWeight = input.gradedWeightFraction >= MIN_GRADED_WEIGHT_FOR_JUDGEMENT;
  const byCount = input.gradedCount >= MIN_GRADED_ITEMS_FOR_JUDGEMENT;
  if (input.gradePercent !== null && (byWeight || byCount) && input.gradePercent < input.targetPercent) {
    // The basis is always stated. A student told they are below target deserves to know
    // whether that is drawn from half the course or from three quizzes.
    const basis = byWeight
      ? `on ${Math.round(input.gradedWeightFraction * 100)}% of the course graded`
      : `across ${input.gradedCount} recorded ${input.gradedCount === 1 ? "result" : "results"}`;
    concerns.push({
      code: "GRADE_BELOW_TARGET",
      level: "at_risk",
      detail: `Standing is ${Math.round(input.gradePercent)}% against ${
        input.course.targetGrade !== null ? "your target" : "a B"
      } of ${Math.round(input.targetPercent)}%, ${basis}.`,
    });
  }

  // A scheme that does not add up cannot produce a standing worth judging, so this is said
  // plainly rather than left to quietly skew the percentage.
  if (input.categories.length > 0) {
    const total = input.categories.reduce((sum, c) => sum + (c.weightPercent ?? 0), 0);
    const anyMissing = input.categories.some((c) => c.weightPercent === null);
    if (anyMissing || Math.abs(total - 100) > WEIGHT_TOLERANCE) {
      concerns.push({
        code: "GRADE_STRUCTURE_INCOMPLETE",
        level: "needs_attention",
        detail: anyMissing
          ? "Some grading categories have no weight, so the grade cannot be worked out yet."
          : `The grading categories add up to ${Math.round(total)}%, not 100%.`,
      });
    }
  }

  return concerns;
}

function rhythmConcerns(load: CourseLoad | undefined): CourseConcern[] {
  const concerns: CourseConcern[] = [];
  if (!load) return concerns;

  if (load.upkeep === "behind") {
    concerns.push({
      code: "UPKEEP_BEHIND",
      level: "needs_attention",
      detail: `${load.upkeepOverdue} pieces of the course's regular work are past due.`,
    });
  } else if (load.upkeep === "slipping") {
    concerns.push({
      code: "UPKEEP_BEHIND",
      level: "needs_attention",
      detail: "One piece of the course's regular work is past due.",
    });
  }

  if (
    load.daysSinceProgress !== null &&
    load.daysSinceProgress >= QUIET_DAYS &&
    load.openItems > 0
  ) {
    concerns.push({
      code: "GONE_QUIET",
      level: "needs_attention",
      detail: `Nothing has been finished in this course for ${load.daysSinceProgress} days.`,
    });
  }

  return concerns;
}

/**
 * Work that is done and has no result recorded against it.
 *
 * Only items whose due date has passed count. A paper submitted this morning has no grade
 * because the instructor has not marked it yet, and calling that a gap the student should
 * close would be asking them to chase something that does not exist.
 */
function countUngradedResults(
  items: readonly WorkItem[],
  gradedItemIds: ReadonlySet<string>,
  now: number,
): number {
  let count = 0;
  for (const item of items) {
    if (item.status !== "completed" && item.status !== "submitted") continue;
    if (gradedItemIds.has(item.id)) continue;
    if (!item.dueAt || toEpochMinutes(item.dueAt) > now) continue;
    count += 1;
  }
  return count;
}

function quote(title: string): string {
  return `"${title}"`;
}
