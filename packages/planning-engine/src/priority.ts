import {
  estimateAcademicValue,
  toEpochMinutes,
  MINUTES_PER_DAY,
  type CourseStanding,
  type Dependency,
  type WorkItem,
} from "@schoolquest/domain";
import type { ReasonCode } from "./reason-codes.js";
import type { PlanningInput, PriorityComponents, PriorityScore } from "./types.js";

/**
 * Weights from docs/04-planning-engine-spec.md §5. Exported so they stay configurable
 * and so tests can assert the model, not a magic number buried in a loop.
 */
export const DEFAULT_WEIGHTS: Record<keyof PriorityComponents, number> = {
  deadlinePressure: 0.24,
  academicValue: 0.2,
  projectLeverage: 0.16,
  failureRisk: 0.14,
  spacingNeed: 0.08,
  contextFit: 0.08,
  neglectPenalty: 0.05,
  userPriority: 0.05,
};

/** Component values above this are considered strong enough to cite as a reason. */
const REASON_THRESHOLD = 0.6;

/**
 * Scores every schedulable work item.
 *
 * The score only ranks candidates; it never overrides a hard constraint. A high score
 * on an item with no feasible window still ends up unscheduled and reported as a risk.
 */
export function scoreWorkItems(
  input: PlanningInput,
  weights: Record<keyof PriorityComponents, number> = DEFAULT_WEIGHTS,
): PriorityScore[] {
  const now = toEpochMinutes(input.now);
  const schedulable = input.workItems.filter(isSchedulable);
  const successorsOf = buildSuccessorMap(input.dependencies);

  return schedulable
    .map((item) => {
      const components: PriorityComponents = {
        deadlinePressure: deadlinePressure(item, now),
        academicValue: academicValue(item, input),
        projectLeverage: projectLeverage(item, input, successorsOf),
        failureRisk: failureRisk(item, input),
        spacingNeed: spacingNeed(item, now),
        // Context fit depends on the window being considered, so the item-level score
        // uses a neutral 0.5 and the placer refines it per candidate placement.
        contextFit: 0.5,
        neglectPenalty: neglectPenalty(item, input, now),
        userPriority: (item.userPriority + 2) / 4,
      };

      const raw = (Object.keys(weights) as (keyof PriorityComponents)[]).reduce(
        (sum, key) => sum + weights[key] * components[key],
        0,
      );
      const confidencePenalty = confidenceMultiplier(item);

      return {
        workItemId: item.id,
        score: raw * confidencePenalty,
        components,
        confidencePenalty,
        reasonCodes: deriveReasonCodes(item, components, confidencePenalty),
      };
    })
    .sort((a, b) => b.score - a.score || a.workItemId.localeCompare(b.workItemId));
}

export function isSchedulable(item: WorkItem): boolean {
  if (item.status === "completed" || item.status === "submitted") return false;
  if (item.status === "canceled" || item.status === "optional") return false;
  // A parent project is scheduled through its milestones, not directly.
  return true;
}

/**
 * Rises as slack disappears. Slack is time-until-due minus the effort still required,
 * so a big task due in a week can be more pressing than a small task due tomorrow.
 */
function deadlinePressure(item: WorkItem, now: number): number {
  if (!item.dueAt) return 0.15; // Undated work still deserves some baseline attention.
  const minutesUntilDue = toEpochMinutes(item.dueAt) - now;
  if (minutesUntilDue <= 0) return 1;

  const remaining = item.remainingMinutes ?? item.estimatedMinutes ?? 60;
  const slack = minutesUntilDue - remaining;
  if (slack <= 0) return 1;

  // Two weeks of clear slack maps to roughly zero pressure.
  const horizon = 14 * MINUTES_PER_DAY;
  return clamp01(1 - slack / horizon);
}

function academicValue(item: WorkItem, input: PlanningInput): number {
  const courseWorkItems = input.workItems.filter((w) => w.courseId === item.courseId);
  const categories = input.gradingCategories.filter((c) => c.courseId === item.courseId);
  const value = estimateAcademicValue(item, { courseWorkItems, categories });

  // Unknown value is not zero value. Fall back to a type-based prior rather than
  // pretending a syllabus-less assignment is worthless.
  if (value === null) return typePrior(item);

  // A single item rarely exceeds ~30% of a course, so rescale for usable spread.
  return clamp01(value / 0.3);
}

function typePrior(item: WorkItem): number {
  switch (item.workType) {
    case "exam":
    case "paper":
    case "group_project":
    case "presentation":
      return 0.7;
    case "problem_set":
    case "lab":
    case "quiz":
      return 0.45;
    case "reading":
    case "discussion":
      return 0.25;
    default:
      return 0.4;
  }
}

/**
 * Early steps that unlock later work score highest. This is what stops a paper's source
 * gathering from being crowded out by a quiz that feels louder.
 */
function projectLeverage(
  item: WorkItem,
  input: PlanningInput,
  successorsOf: Map<string, string[]>,
): number {
  const direct = successorsOf.get(item.id) ?? [];
  let leverage = 0;

  if (direct.length > 0) {
    // Count the whole downstream chain, not just immediate successors.
    leverage += clamp01(countDownstream(item.id, successorsOf) / 4);
  }

  // A milestone of a major project inherits leverage from being on a critical path.
  if (item.parentWorkItemId) {
    const siblings = input.workItems.filter((w) => w.parentWorkItemId === item.parentWorkItemId);
    const position = siblings.findIndex((w) => w.id === item.id);
    if (position >= 0 && siblings.length > 1) {
      // Earlier milestones have more leverage than later ones.
      leverage = Math.max(leverage, 1 - position / siblings.length);
    }
  }

  return clamp01(leverage);
}

function countDownstream(id: string, successorsOf: Map<string, string[]>): number {
  const seen = new Set<string>();
  const queue = [...(successorsOf.get(id) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(successorsOf.get(next) ?? []));
  }
  return seen.size;
}

/**
 * Uncertainty, complexity, and weak course standing. Note the framing rule from
 * docs/04 §7: a course with more recoverable weight gets more attention, which is a
 * statement about opportunity, not about the student.
 */
function failureRisk(item: WorkItem, input: PlanningInput): number {
  let risk = 0;

  if (item.cognitiveDemand === "high") risk += 0.3;
  else if (item.cognitiveDemand === "medium") risk += 0.15;

  if (item.estimatedMinutes === null) risk += 0.2; // Unknown effort is itself a risk.
  else if (item.estimatedMinutes > 180) risk += 0.2;

  if (item.sourceConfidence === "low_inference" || item.sourceConfidence === "unknown") {
    risk += 0.1;
  }

  const standing = input.courseStandings?.[item.courseId];
  if (standing?.estimatedPercent !== null && standing?.estimatedPercent !== undefined) {
    const course = input.courses.find((c) => c.id === item.courseId);
    const target = course?.targetGrade ?? 85;
    const shortfall = target - standing.estimatedPercent;
    if (shortfall > 0) {
      // Weight the gap by how much of the course is still recoverable.
      risk += clamp01(shortfall / 20) * 0.3 * standing.remainingWeightFraction;
    }
  }

  return clamp01(risk);
}

/** Exams and quizzes benefit from distributed practice; a single crammed block does not. */
function spacingNeed(item: WorkItem, now: number): number {
  const spacingTypes = new Set(["exam", "exam_prep", "quiz", "quiz_prep"]);
  if (!spacingTypes.has(item.workType)) return 0;
  if (!item.dueAt) return 0.5;

  const daysUntil = (toEpochMinutes(item.dueAt) - now) / MINUTES_PER_DAY;
  if (daysUntil <= 0) return 0;
  // Peak benefit when the exam is 2-10 days out — enough runway for spacing to matter.
  if (daysUntil <= 1) return 0.3;
  if (daysUntil <= 10) return 1;
  return clamp01(10 / daysUntil);
}

/** Rises with time since the item last received a completed session. */
function neglectPenalty(item: WorkItem, input: PlanningInput, now: number): number {
  const completed = input.existingSessions.filter(
    (s) => s.workItemId === item.id && (s.status === "completed" || s.status === "partial"),
  );
  if (completed.length === 0) {
    // Never worked on, and available to start — mild nudge.
    return item.availableAt && toEpochMinutes(item.availableAt) > now ? 0 : 0.4;
  }
  const last = Math.max(...completed.map((s) => toEpochMinutes(s.endAt)));
  const daysSince = (now - last) / MINUTES_PER_DAY;
  return clamp01(daysSince / 7);
}

/**
 * Damps aggressive scheduling when the underlying data is shaky. An unconfirmed due date
 * should produce conservative buffers, not confident time-boxing (docs/04 §14).
 */
function confidenceMultiplier(item: WorkItem): number {
  switch (item.sourceConfidence) {
    case "confirmed":
      return 1;
    case "high_inference":
      return 0.95;
    case "low_inference":
      return 0.85;
    case "unknown":
      return 0.8;
    case "superseded":
      return 0.5;
  }
}

function deriveReasonCodes(
  item: WorkItem,
  components: PriorityComponents,
  confidencePenalty: number,
): ReasonCode[] {
  const codes: ReasonCode[] = [];
  if (components.deadlinePressure >= 0.85) codes.push("DEADLINE_IMMINENT");
  if (components.academicValue >= REASON_THRESHOLD) codes.push("HIGH_ACADEMIC_VALUE");
  if (components.projectLeverage >= REASON_THRESHOLD) {
    codes.push(item.parentWorkItemId ? "UNLOCKS_MAJOR_PROJECT" : "PREREQUISITE_FOR_LATER_WORK");
  }
  if (components.spacingNeed >= REASON_THRESHOLD) codes.push("SPACED_PRACTICE");
  if (components.neglectPenalty >= REASON_THRESHOLD) codes.push("NEGLECTED_WORK");
  if (components.userPriority > 0.5) codes.push("USER_PRIORITIZED");
  if (components.failureRisk >= REASON_THRESHOLD) codes.push("COURSE_NEEDS_ATTENTION");
  if (confidencePenalty < 1) codes.push("UNCERTAIN_INPUT_CONSERVATIVE");
  return codes;
}

function buildSuccessorMap(dependencies: Dependency[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const dep of dependencies) {
    const list = map.get(dep.predecessorWorkItemId);
    if (list) list.push(dep.successorWorkItemId);
    else map.set(dep.predecessorWorkItemId, [dep.successorWorkItemId]);
  }
  return map;
}

/** Exported for the placer, which re-scores context fit per candidate window. */
export function courseStandingFor(
  input: PlanningInput,
  courseId: string,
): CourseStanding | undefined {
  return input.courseStandings?.[courseId];
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
