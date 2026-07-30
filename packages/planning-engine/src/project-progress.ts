import type { WorkItem } from "@schoolquest/domain";
import { toEpochMinutes } from "@schoolquest/domain";
import { DEFAULT_EFFORT_MINUTES } from "./scheduler.js";

/**
 * Progress on the big things.
 *
 * A term paper does not get lost because a student forgot it exists. It gets lost because
 * nothing ever tells them *where it stands* — how much of it is done, whether the work has
 * moved recently, and whether the time still booked for it is enough to finish. The
 * campaign arc answers "is it coming"; this answers "am I actually going to make it".
 *
 * Every figure below is measured, and the two that matter most are measured against each
 * other: minutes still needed versus minutes still booked. That comparison is the whole
 * point, because it is the one a student cannot do in their head — and it produces the only
 * honest early warning the app can give about a project that is quietly going to be late.
 *
 * Pure. No stored state, no LLM, no clock beyond the `now` it is handed.
 */

/** Work large or weighty enough that "how is it going" is a real question. */
export const PROJECT_MINUTES = 120;

/**
 * A project needing more than this share of *all* the student's study time each week is
 * crowding out everything else, whether or not it is technically still possible.
 */
const CROWDING_SHARE = 0.5;

/** No progress in this long, with a deadline ahead, is worth surfacing. */
export const STALLED_DAYS = 10;

export type ProjectHealth =
  /** The deadline has passed and the work is still open. Usually a wrong date, not a crisis. */
  | "past_due"
  /** Never worked on. A true statement, not a criticism — in week one it is the right state. */
  | "not_started"
  | "on_track"
  /** Needs more than half of all weekly study time from here. Possible, but it will hurt. */
  | "crowding"
  /** Will not fit before the deadline even using every study minute. Arithmetic, not opinion. */
  | "will_not_fit"
  | "stalled"
  | "finished";

export interface ProjectProgress {
  workItemId: string;
  courseId: string;
  title: string;
  workType: string;
  dueAt: string | null;
  dueConfirmed: boolean;
  /** Whole days until due; negative is past due. Null when no date is known. */
  daysAway: number | null;

  /** Effort the whole thing takes. */
  estimatedMinutes: number;
  /**
   * True when nobody ever estimated the effort and a per-type default stood in.
   *
   * This is the common case, not an edge one: across the five-course test semester **not a
   * single one** of 56 extracted items carried an `estimatedMinutes` — a syllabus says what
   * is due, never how long it takes. The same default table the scheduler plans against is
   * used here so the two agree, and the flag exists so the interface can say "about 4 hours,
   * assumed" rather than presenting a guess as the student's own figure.
   */
  effortIsAssumed: boolean;
  /** Effort still owed. */
  remainingMinutes: number;
  /** Minutes actually logged against it, from completed sessions. */
  investedMinutes: number;
  /** 0..1 by effort. Uses real numbers only — no guess stands in for a missing estimate. */
  completionFraction: number;

  /** Minutes still on the calendar for it, from blocks not yet done. */
  bookedMinutes: number;
  /**
   * Minutes per week this needs from here to land on time, or null with no known deadline.
   * The figure a student cannot compute in their head, and the one that makes "six weeks
   * out" concrete.
   */
  neededPerWeekMinutes: number | null;

  /** Days since the last completed block, or null if it has never been worked on. */
  daysSinceProgress: number | null;
  health: ProjectHealth;

  /** Milestones, when the project has been broken into them. */
  stages: { workItemId: string; title: string; done: boolean; dueAt: string | null }[];
}

export interface CompletedBlock {
  workItemId: string;
  /** When the block ended, so "days since progress" measures real elapsed time. */
  endAt: string;
  minutes: number;
}

export interface BookedBlock {
  workItemId: string;
  minutes: number;
}

export interface ProjectProgressInput {
  workItems: readonly WorkItem[];
  /**
   * The student's realistic study minutes per week, from the plan's own capacity figure.
   * Health claims are measured against this rather than against how much the current plan
   * happens to have booked — a paced project only ever holds one horizon's worth of blocks,
   * so comparing booked-now against total-remaining would report every healthy long project
   * as short of time, forever.
   */
  weeklyCapacityMinutes: number;
  /** Completed sessions across the whole term, not just the current horizon. */
  completed: readonly CompletedBlock[];
  /** Sessions still ahead: planned or started, again term-wide. */
  booked: readonly BookedBlock[];
  now: string;
}

/**
 * One row per project, ordered by how soon it is due — undated projects last, because a
 * missing date is a reason to look at something, not a reason to rank it.
 */
export function computeProjectProgress(input: ProjectProgressInput): ProjectProgress[] {
  const nowMinutes = toEpochMinutes(input.now);

  const investedByItem = new Map<string, { minutes: number; lastEnd: number }>();
  for (const block of input.completed) {
    const end = toEpochMinutes(block.endAt);
    const running = investedByItem.get(block.workItemId);
    investedByItem.set(block.workItemId, {
      minutes: (running?.minutes ?? 0) + block.minutes,
      lastEnd: Math.max(running?.lastEnd ?? Number.NEGATIVE_INFINITY, end),
    });
  }

  const bookedByItem = new Map<string, number>();
  for (const block of input.booked) {
    bookedByItem.set(block.workItemId, (bookedByItem.get(block.workItemId) ?? 0) + block.minutes);
  }

  const childrenByParent = new Map<string, WorkItem[]>();
  for (const item of input.workItems) {
    if (!item.parentWorkItemId) continue;
    childrenByParent.set(item.parentWorkItemId, [
      ...(childrenByParent.get(item.parentWorkItemId) ?? []),
      item,
    ]);
  }

  const rows = input.workItems
    .filter((item) => isProject(item, childrenByParent))
    .map((item) =>
      row(item, {
        nowMinutes,
        investedByItem,
        bookedByItem,
        childrenByParent,
        weeklyCapacityMinutes: input.weeklyCapacityMinutes,
      }),
    );

  return rows.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    return a.dueAt ? -1 : b.dueAt ? 1 : a.title.localeCompare(b.title);
  });
}

/**
 * What counts as a project: effort big enough that it cannot be done in one sitting, or a
 * parent that has been broken into stages. Deliberately not keyed on `workType` alone — a
 * fifteen-hour problem set is a project whatever the syllabus filed it under, and a
 * thirty-minute "paper" reflection is not.
 */
function isProject(item: WorkItem, childrenByParent: Map<string, WorkItem[]>): boolean {
  if (item.status === "canceled") return false;
  if (childrenByParent.has(item.id)) return true;
  return effortOf(item).minutes >= PROJECT_MINUTES;
}

/**
 * Total effort for an item, from the best source available.
 *
 * Mirrors the scheduler's own fallback deliberately: if the plan books 240 minutes for a
 * paper because that is the default, every other screen must measure against the same 240 or
 * they will quietly disagree about the same project. Exported for exactly that reason — a
 * second copy of this rule immediately drifted, and the course table reported zero projects
 * for a term the Chronicle showed seven in.
 */
export function effortOf(item: WorkItem): { minutes: number; assumed: boolean } {
  if (item.estimatedMinutes !== null) return { minutes: item.estimatedMinutes, assumed: false };
  if (item.remainingMinutes !== null && item.remainingMinutes > 0) {
    return { minutes: item.remainingMinutes, assumed: false };
  }
  return { minutes: DEFAULT_EFFORT_MINUTES[item.workType] ?? 60, assumed: true };
}

function row(
  item: WorkItem,
  ctx: {
    nowMinutes: number;
    investedByItem: Map<string, { minutes: number; lastEnd: number }>;
    bookedByItem: Map<string, number>;
    childrenByParent: Map<string, WorkItem[]>;
    weeklyCapacityMinutes: number;
  },
): ProjectProgress {
  const stages = (ctx.childrenByParent.get(item.id) ?? [])
    .slice()
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"))
    .map((child) => ({
      workItemId: child.id,
      title: child.title,
      done: child.status === "completed" || child.status === "submitted",
      dueAt: child.dueAt,
    }));

  // A parent's own effort figures are usually unset once it has stages; roll the children
  // up rather than reporting zero for a project that is plainly under way.
  const children = ctx.childrenByParent.get(item.id) ?? [];
  const ownEffort = effortOf(item);
  const finishedByStatus = item.status === "completed" || item.status === "submitted";

  const estimatedMinutes =
    children.length > 0
      ? children.reduce((sum, c) => sum + effortOf(c).minutes, 0)
      : ownEffort.minutes;
  const remainingMinutes =
    children.length > 0
      ? children.reduce(
          (sum, c) =>
            sum +
            (c.status === "completed" || c.status === "submitted"
              ? 0
              : (c.remainingMinutes ?? effortOf(c).minutes)),
          0,
        )
      : finishedByStatus
        ? 0
        : (item.remainingMinutes ?? ownEffort.minutes);
  const effortIsAssumed =
    children.length > 0 ? children.some((c) => effortOf(c).assumed) : ownEffort.assumed;

  const invested = ctx.investedByItem.get(item.id);
  const investedFromStages = children.reduce(
    (sum, c) => sum + (ctx.investedByItem.get(c.id)?.minutes ?? 0),
    0,
  );
  const investedMinutes = (invested?.minutes ?? 0) + investedFromStages;

  const bookedMinutes =
    (ctx.bookedByItem.get(item.id) ?? 0) +
    children.reduce((sum, c) => sum + (ctx.bookedByItem.get(c.id) ?? 0), 0);

  const lastEnds = [
    invested?.lastEnd,
    ...children.map((c) => ctx.investedByItem.get(c.id)?.lastEnd),
  ].filter((v): v is number => typeof v === "number");
  const daysSinceProgress =
    lastEnds.length > 0
      ? Math.floor((ctx.nowMinutes - Math.max(...lastEnds)) / (24 * 60))
      : null;

  const daysAway = item.dueAt
    ? Math.floor((toEpochMinutes(item.dueAt) - ctx.nowMinutes) / (24 * 60))
    : null;

  // By effort, and only when there is effort to divide by. Falling back to a stage count
  // when stages exist is more honest than dividing by an estimate nobody gave.
  const completionFraction =
    estimatedMinutes > 0
      ? clamp01((estimatedMinutes - remainingMinutes) / estimatedMinutes)
      : stages.length > 0
        ? clamp01(stages.filter((s) => s.done).length / stages.length)
        : 0;

  const finished = finishedByStatus || (remainingMinutes === 0 && investedMinutes > 0);

  return {
    workItemId: item.id,
    courseId: item.courseId,
    title: item.title,
    workType: item.workType,
    dueAt: item.dueAt,
    dueConfirmed: item.sourceConfidence === "confirmed",
    daysAway,
    estimatedMinutes,
    effortIsAssumed,
    remainingMinutes,
    investedMinutes,
    completionFraction,
    bookedMinutes,
    neededPerWeekMinutes: neededPerWeek(remainingMinutes, daysAway),
    daysSinceProgress,
    health: health({
      finished,
      remainingMinutes,
      investedMinutes,
      daysSinceProgress,
      daysAway,
      neededPerWeekMinutes: neededPerWeek(remainingMinutes, daysAway),
      weeklyCapacityMinutes: ctx.weeklyCapacityMinutes,
    }),
    stages,
  };
}

/** Minutes per week needed to land the remaining effort on time. */
function neededPerWeek(remainingMinutes: number, daysAway: number | null): number | null {
  if (daysAway === null) return null;
  // Past due, or due within the day: all of it is needed now, not spread over anything.
  if (daysAway <= 0) return remainingMinutes;
  return Math.round(remainingMinutes / (daysAway / 7));
}

/**
 * One word for where a project stands.
 *
 * Ordered so the most actionable answer wins, and every claim is measured against the
 * student's real weekly capacity rather than against how much the current plan has booked.
 * That distinction is the whole reason this function was rewritten: long work is paced, so a
 * healthy project only ever holds one horizon's blocks. Comparing booked-now against
 * total-remaining flagged every well-managed project as short of time, permanently — a
 * warning that is always on is not a warning, it is noise that teaches the student to
 * ignore the screen.
 *
 * Nothing here is a judgement about the student, and nothing decays. `not_started` in week
 * one is simply correct.
 */
function health(v: {
  finished: boolean;
  remainingMinutes: number;
  investedMinutes: number;
  daysSinceProgress: number | null;
  daysAway: number | null;
  neededPerWeekMinutes: number | null;
  weeklyCapacityMinutes: number;
}): ProjectHealth {
  if (v.finished) return "finished";

  // A passed deadline outranks every other reading. Saying only "not started" about work
  // that was due eight months ago understates it, and in this app the most common cause is a
  // date inferred from a syllabus for an older term — so the first move is to check the date.
  if (v.daysAway !== null && v.daysAway < 0) return "past_due";

  const capacity = v.weeklyCapacityMinutes;
  if (v.daysAway !== null && capacity > 0 && v.neededPerWeekMinutes !== null) {
    // Will not fit even if every study minute went to this one thing. Arithmetic, so it can
    // be stated plainly without hedging.
    if (v.neededPerWeekMinutes > capacity) return "will_not_fit";
    // Possible, but it would take over half of everything — which is worth knowing before
    // it is the only option left.
    if (v.neededPerWeekMinutes > capacity * CROWDING_SHARE) return "crowding";
  }

  if (v.investedMinutes === 0) return "not_started";
  if (v.daysSinceProgress !== null && v.daysSinceProgress >= STALLED_DAYS) return "stalled";
  return "on_track";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface TermEffortSummary {
  /** Minutes logged across the whole term. Only ever rises. */
  investedMinutes: number;
  sessionsCompleted: number;
  /** Minutes still on the calendar ahead of now. */
  bookedMinutes: number;
  projectsTotal: number;
  projectsFinished: number;
  /** Projects that cannot fit before their deadline at full capacity. Act on these first. */
  projectsWillNotFit: number;
  /** Projects that would need over half of all weekly study time from here. */
  projectsCrowding: number;
  projectsNotStarted: number;
  projectsStalled: number;
  /** Deadlines already passed with work still open. Almost always a date to correct. */
  projectsPastDue: number;
}

export function summarizeProjects(
  projects: readonly ProjectProgress[],
  effort: { investedMinutes: number; sessionsCompleted: number },
): TermEffortSummary {
  return {
    investedMinutes: effort.investedMinutes,
    sessionsCompleted: effort.sessionsCompleted,
    bookedMinutes: projects.reduce((sum, p) => sum + p.bookedMinutes, 0),
    projectsTotal: projects.length,
    projectsFinished: projects.filter((p) => p.health === "finished").length,
    projectsWillNotFit: projects.filter((p) => p.health === "will_not_fit").length,
    projectsCrowding: projects.filter((p) => p.health === "crowding").length,
    projectsNotStarted: projects.filter((p) => p.health === "not_started").length,
    projectsStalled: projects.filter((p) => p.health === "stalled").length,
    projectsPastDue: projects.filter((p) => p.health === "past_due").length,
  };
}
