import type { WorkItem } from "@schoolquest/domain";

/**
 * Course and term progress accounting.
 *
 * This exists so the interface can show forward motion — the Quest theme renders it as
 * XP and questline completion — without inventing a single number. Two rules make that
 * honest, and they are the same rules `@schoolquest/domain`'s grade math follows:
 *
 * 1. Points are only ever counted from items that actually state `pointsPossible`. A
 *    syllabus that never gives point values yields item-count progress instead, and the
 *    basis is reported so the UI can say which one it is showing.
 * 2. Nothing is completed on the planner's say-so. Only a work item the student marked
 *    `completed` or `submitted` counts, so progress can never run ahead of real life.
 *
 * Deliberately absent: streaks, decay, and anything that can go *down* on an idle day.
 * docs/02-prd.md §3 rules those out — a student who misses a week must be able to come
 * back to an interface that shows what is left, not what was lost.
 */

/**
 * How much of a course's required work must actually state a point value before points
 * are allowed to be the measure of progress.
 *
 * This threshold is not a nicety — without it the feature lies. Measured against the
 * five-course test semester, exactly 1 of 56 extracted work items carried a
 * `pointsPossible`: real syllabi state category weights ("Labs 25%"), not per-assignment
 * points. Ratio-of-points would therefore have reported an 18-item course as 100%
 * complete the moment its single 100-point lab report was finished, and the term as
 * "0 of 100" while 55 items sat unmentioned. Below this bar the honest measure is how
 * many pieces of work are done, so that is what gets used.
 */
const POINTS_BASIS_MIN_COVERAGE = 0.6;

/** Counted as finished. A session being marked done does not do this; the work item must be. */
const DONE_STATUSES = new Set(["completed", "submitted"]);

/**
 * Never counted at all — the student cancelled it, so it is neither owed nor earned.
 * `optional` is handled separately: excluded from the denominator, credited if finished.
 */
const EXCLUDED_STATUSES = new Set(["canceled"]);

export interface CourseProgress {
  courseId: string;
  /** Required (non-optional, non-cancelled) items in the course. */
  itemsTotal: number;
  /** Finished items, including optional ones the student chose to do. */
  itemsDone: number;
  /** Summed `pointsPossible` of required items that state it; 0 when none do. */
  pointsTotal: number;
  pointsDone: number;
  /** Share of the required items that state a point value, 0..1. */
  pointsCoverage: number;
  /** 0..1, capped. Computed on whichever basis `basis` reports. */
  completionFraction: number;
  /**
   * Which measure `completionFraction` came from. Callers must key their wording off
   * this and never print a points figure when it is `"items"` — that course's syllabus
   * did not state enough point values for one to mean anything.
   */
  basis: "points" | "items";
}

export interface TermProgress {
  courses: CourseProgress[];
  itemsTotal: number;
  itemsDone: number;
  /** Raw sums. Honest, but only worth showing when `basis` is `"points"`. */
  pointsTotal: number;
  pointsDone: number;
  pointsCoverage: number;
  /**
   * 0..1 across the whole term: the mean of each course's own completion, weighted by
   * how much work that course holds. Deliberately *not* a ratio of summed points — with
   * one course stating points and four not, that sum has no denominator worth dividing
   * by, and it would let a single graded item speak for an entire semester.
   */
  completionFraction: number;
  basis: "points" | "items";
}

/**
 * Per-course progress for every course id given, in the order given.
 *
 * Courses with no work items still get a row — a questline with nothing in it yet is a
 * true statement about the term, and dropping the row would silently hide a course the
 * student added but never filled in.
 */
export function computeCourseProgress(
  courseIds: readonly string[],
  workItems: readonly WorkItem[],
): CourseProgress[] {
  const byCourse = new Map<string, WorkItem[]>(courseIds.map((id) => [id, []]));
  for (const item of workItems) {
    byCourse.get(item.courseId)?.push(item);
  }
  return courseIds.map((courseId) => progressForItems(courseId, byCourse.get(courseId) ?? []));
}

function progressForItems(courseId: string, items: readonly WorkItem[]): CourseProgress {
  let itemsTotal = 0;
  let itemsDone = 0;
  let pointsTotal = 0;
  let pointsDone = 0;
  let itemsWithPoints = 0;

  for (const item of items) {
    if (EXCLUDED_STATUSES.has(item.status)) continue;
    const done = DONE_STATUSES.has(item.status);
    const points = item.pointsPossible;

    if (done) {
      itemsDone += 1;
      if (points !== null) pointsDone += points;
    }

    // Optional work is credit without obligation: finishing it counts, leaving it does
    // not put the student behind.
    if (item.status === "optional") continue;

    itemsTotal += 1;
    if (points !== null) {
      itemsWithPoints += 1;
      pointsTotal += points;
    }
  }

  const pointsCoverage = itemsTotal > 0 ? itemsWithPoints / itemsTotal : 0;
  const basis: "points" | "items" =
    pointsTotal > 0 && pointsCoverage >= POINTS_BASIS_MIN_COVERAGE ? "points" : "items";
  const ratio =
    basis === "points"
      ? pointsDone / pointsTotal
      : itemsTotal > 0
        ? itemsDone / itemsTotal
        : 0;

  return {
    courseId,
    itemsTotal,
    itemsDone,
    pointsTotal,
    pointsDone,
    pointsCoverage,
    // Optional work finished can push the raw ratio past 1; the bar caps, the raw
    // point totals below do not.
    completionFraction: Math.min(1, Math.max(0, ratio)),
    basis,
  };
}

/**
 * Rolls per-course rows into one term-level view.
 *
 * Each course keeps its own basis and the term is their weighted mean, so a semester
 * that mixes a points-bearing syllabus with four that state none still produces one
 * number that means something. Summing points across that mix would not.
 */
export function summarizeProgress(courses: readonly CourseProgress[]): TermProgress {
  const totals = courses.reduce(
    (acc, c) => ({
      itemsTotal: acc.itemsTotal + c.itemsTotal,
      itemsDone: acc.itemsDone + c.itemsDone,
      pointsTotal: acc.pointsTotal + c.pointsTotal,
      pointsDone: acc.pointsDone + c.pointsDone,
      // Weighted by workload: a 19-item course should move the term figure further than
      // a 4-item one.
      weighted: acc.weighted + c.completionFraction * c.itemsTotal,
      itemsWithPoints: acc.itemsWithPoints + c.pointsCoverage * c.itemsTotal,
    }),
    { itemsTotal: 0, itemsDone: 0, pointsTotal: 0, pointsDone: 0, weighted: 0, itemsWithPoints: 0 },
  );

  const { weighted, itemsWithPoints, ...sums } = totals;
  const pointsCoverage = sums.itemsTotal > 0 ? itemsWithPoints / sums.itemsTotal : 0;

  return {
    courses: [...courses],
    ...sums,
    pointsCoverage,
    completionFraction:
      sums.itemsTotal > 0 ? Math.min(1, Math.max(0, weighted / sums.itemsTotal)) : 0,
    basis:
      sums.pointsTotal > 0 && pointsCoverage >= POINTS_BASIS_MIN_COVERAGE ? "points" : "items",
  };
}

/** Convenience wrapper for callers that hold both lists. */
export function computeTermProgress(
  courseIds: readonly string[],
  workItems: readonly WorkItem[],
): TermProgress {
  return summarizeProgress(computeCourseProgress(courseIds, workItems));
}
