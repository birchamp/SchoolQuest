import type { GradeResult, GradingCategory, WorkItem } from "./entities.js";
import type { ConfidenceStatus } from "./enums.js";

/**
 * Grade math for course standing.
 *
 * Two rules dominate this file, both from docs/04-planning-engine-spec.md §7:
 *   1. A pending grade is UNKNOWN, not zero. It is excluded from the earned/possible
 *      ratio entirely rather than dragging the average down.
 *   2. Raw points are never compared across courses. Everything is normalized to a
 *      within-course percentage before it reaches the planning engine.
 */

export interface CategoryStanding {
  categoryId: string | null;
  categoryName: string;
  weightPercent: number | null;
  pointsEarned: number;
  pointsPossible: number;
  /** Percentage earned on graded work only, or null when nothing is graded yet. */
  percent: number | null;
  gradedCount: number;
  pendingCount: number;
}

export interface CourseStanding {
  /** Estimated current grade as a percentage of graded work, or null when unknown. */
  estimatedPercent: number | null;
  /** How much of the course's total weight has actually been graded so far, 0..1. */
  gradedWeightFraction: number;
  /** Weight still available to change the outcome, 0..1. */
  remainingWeightFraction: number;
  confidence: ConfidenceStatus;
  categories: CategoryStanding[];
}

/** A grade counts toward standing only when it is scored, not dropped, and out of a real total. */
export function isGraded(grade: GradeResult): boolean {
  return (
    !grade.dropped &&
    grade.pointsEarned !== null &&
    grade.pointsPossible !== null &&
    grade.pointsPossible > 0
  );
}

/**
 * Applies a category's `dropRule` (currently `{ dropLowest: n }`) by marking the n
 * worst-performing graded results as dropped. Returns a new array; inputs are untouched.
 */
export function applyDropRule(
  grades: GradeResult[],
  category: GradingCategory | undefined,
): GradeResult[] {
  const dropLowest = Number(category?.dropRule?.["dropLowest"] ?? 0);
  if (!Number.isFinite(dropLowest) || dropLowest <= 0) return grades;

  const graded = grades.filter(isGraded);
  if (graded.length <= dropLowest) return grades;

  const ranked = [...graded].sort(
    (a, b) => a.pointsEarned! / a.pointsPossible! - b.pointsEarned! / b.pointsPossible!,
  );
  const droppedIds = new Set(ranked.slice(0, dropLowest).map((g) => g.id));
  return grades.map((g) => (droppedIds.has(g.id) ? { ...g, dropped: true } : g));
}

/**
 * Computes course standing from confirmed grades.
 *
 * When categories carry weights, the estimate is the weighted mean of category
 * percentages over the categories that have at least one graded item. When weights are
 * missing, it falls back to a flat points ratio and reports lower confidence.
 */
export function computeCourseStanding(input: {
  workItems: WorkItem[];
  grades: GradeResult[];
  categories: GradingCategory[];
}): CourseStanding {
  const itemsById = new Map(input.workItems.map((w) => [w.id, w]));
  const categoriesById = new Map(input.categories.map((c) => [c.id, c]));

  // Bucket grades by the grading category of their work item.
  const buckets = new Map<string | null, GradeResult[]>();
  for (const grade of input.grades) {
    const item = itemsById.get(grade.workItemId);
    if (!item) continue;
    if (item.status === "canceled" || item.status === "optional") continue;
    const key = item.gradingCategoryId ?? null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(grade);
    else buckets.set(key, [grade]);
  }

  const categories: CategoryStanding[] = [];
  for (const [categoryId, rawGrades] of buckets) {
    const category = categoryId ? categoriesById.get(categoryId) : undefined;
    const grades = applyDropRule(rawGrades, category);
    const graded = grades.filter(isGraded);

    const pointsEarned = graded.reduce((sum, g) => sum + g.pointsEarned!, 0);
    const pointsPossible = graded.reduce((sum, g) => sum + g.pointsPossible!, 0);

    categories.push({
      categoryId,
      categoryName: category?.name ?? "Uncategorized",
      weightPercent: category?.weightPercent ?? null,
      pointsEarned,
      pointsPossible,
      percent: pointsPossible > 0 ? (pointsEarned / pointsPossible) * 100 : null,
      gradedCount: graded.length,
      // Anything in the bucket that is not graded is pending, never a zero.
      pendingCount: grades.length - graded.length,
    });
  }

  const scored = categories.filter((c) => c.percent !== null);
  const totalDeclaredWeight = input.categories.reduce((sum, c) => sum + (c.weightPercent ?? 0), 0);
  const weighted = scored.filter((c) => c.weightPercent !== null && c.weightPercent > 0);

  let estimatedPercent: number | null = null;
  let confidence: ConfidenceStatus = "unknown";
  let gradedWeightFraction = 0;

  if (weighted.length > 0 && totalDeclaredWeight > 0) {
    const weightSum = weighted.reduce((sum, c) => sum + c.weightPercent!, 0);
    estimatedPercent = weighted.reduce((sum, c) => sum + c.percent! * c.weightPercent!, 0) / weightSum;
    gradedWeightFraction = weightSum / totalDeclaredWeight;
    // A weighted estimate is only trustworthy once the declared weights add up to
    // roughly 100% and a meaningful slice of the course has actually been graded.
    const weightsLookComplete = Math.abs(totalDeclaredWeight - 100) <= 1;
    confidence =
      weightsLookComplete && gradedWeightFraction >= 0.2 ? "confirmed" : "high_inference";
  } else if (scored.length > 0) {
    // No usable weights: fall back to a flat ratio across everything graded.
    const pointsEarned = scored.reduce((sum, c) => sum + c.pointsEarned, 0);
    const pointsPossible = scored.reduce((sum, c) => sum + c.pointsPossible, 0);
    estimatedPercent = pointsPossible > 0 ? (pointsEarned / pointsPossible) * 100 : null;
    confidence = "low_inference";
  }

  return {
    estimatedPercent,
    gradedWeightFraction,
    remainingWeightFraction: Math.max(0, 1 - gradedWeightFraction),
    confidence,
    categories: categories.sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
  };
}

/**
 * Academic value of a single work item, normalized within its own course to 0..1.
 *
 * Preference order mirrors docs/04-planning-engine-spec.md §6: explicit category weight
 * and within-category share first, then raw points as a fraction of known course points.
 * Returns null when there is genuinely nothing to go on — the caller must not substitute
 * a made-up number.
 */
export function estimateAcademicValue(
  item: WorkItem,
  context: { courseWorkItems: WorkItem[]; categories: GradingCategory[] },
): number | null {
  const category = context.categories.find((c) => c.id === item.gradingCategoryId);

  if (category?.weightPercent != null && category.weightPercent > 0) {
    const share =
      item.categorySharePercent != null
        ? item.categorySharePercent / 100
        : shareWithinCategory(item, context.courseWorkItems);
    if (share !== null) {
      // Fraction of the whole course grade this single item controls.
      return clamp01((category.weightPercent / 100) * share);
    }
  }

  if (item.pointsPossible != null && item.pointsPossible > 0) {
    const knownCoursePoints = context.courseWorkItems
      .filter((w) => w.status !== "canceled")
      .reduce((sum, w) => sum + (w.pointsPossible ?? 0), 0);
    if (knownCoursePoints > 0) return clamp01(item.pointsPossible / knownCoursePoints);
  }

  return null;
}

/** Point-weighted share of a category, or an equal split when points are unknown. */
function shareWithinCategory(item: WorkItem, courseWorkItems: WorkItem[]): number | null {
  const siblings = courseWorkItems.filter(
    (w) => w.gradingCategoryId === item.gradingCategoryId && w.status !== "canceled",
  );
  if (siblings.length === 0) return null;

  const totalPoints = siblings.reduce((sum, w) => sum + (w.pointsPossible ?? 0), 0);
  if (totalPoints > 0 && item.pointsPossible != null) return item.pointsPossible / totalPoints;
  return 1 / siblings.length;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
