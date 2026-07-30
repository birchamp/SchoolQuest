import type { WorkItem } from "@schoolquest/domain";
import { toEpochMinutes } from "@schoolquest/domain";
import { effortOf, PROJECT_MINUTES } from "./project-progress.js";
import { findRecurringTitles, routineKeyOf } from "./session-brief.js";

/**
 * One pool of time, divided across every course.
 *
 * A student is not a player working through one campaign — they are running five at once,
 * each with its own arc and its own deadlines, out of a single week that does not grow. That
 * is the fact this module exists to state, because it is the fact the interface kept
 * implying was false: every screen so far shows one course's work at a time, or the week as
 * an undifferentiated whole, and neither shows the division.
 *
 * The division is the decision. A student who cannot see that History already holds four of
 * this week's twelve hours cannot make an informed choice about Biology, and "spend more time
 * on it" is not advice they can act on without knowing what it costs.
 *
 * Two things are deliberately *not* here. There is no per-course score, and no per-course
 * time budget the student can fall behind on: an allocation is a description of the plan,
 * not a target to miss. `docs/02-prd.md` §3.
 *
 * Pure. Every figure traces to a real session or a real work item.
 */

/** Recurring work this far past due, and still open, is upkeep that has slipped. */
const SLIPPING_ITEMS = 1;
const BEHIND_ITEMS = 2;

/**
 * How a course's routine work is holding up.
 *
 * Routine work — the weekly post, the lab notebook — is the steady half of a semester, and
 * it is invisible in every other view because no single instance of it matters. Whether it
 * is being *kept* matters a great deal, and it is the one thing about a course that can be
 * true or false rather than a number.
 *
 * Nothing here accumulates and nothing decays: a course goes back to `current` the moment
 * its overdue routine work is done. There is no streak to break and no ground to lose.
 */
export type UpkeepStatus =
  /** The course has no recurring work at all — most courses with only exams and papers. */
  | "no_routine"
  | "current"
  /** One piece of routine work is past due and still open. */
  | "slipping"
  /** Two or more. Worth naming, because routine work is what quietly holds a grade up. */
  | "behind";

export interface CourseLoad {
  courseId: string;

  /** Minutes of this week's plan spent on this course. */
  bookedMinutes: number;
  /** This course's share of everything booked this week, 0..1. Zero when nothing is booked. */
  shareOfBooked: number;
  /** Blocks on the calendar for it this week. */
  blocks: number;

  /** Minutes actually logged against this course across the whole term. */
  investedMinutes: number;

  /** Open work items, and how many of those are big enough to be projects. */
  openItems: number;
  openProjects: number;

  /** The next thing due, so a course row can say what is actually coming. */
  nextDueAt: string | null;
  nextDueTitle: string | null;

  upkeep: UpkeepStatus;
  /** Routine items past due and still open. Zero whenever upkeep is current or absent. */
  upkeepOverdue: number;

  /** Days since the last completed block in this course; null if there has never been one. */
  daysSinceProgress: number | null;
}

export interface TermLoad {
  courses: CourseLoad[];
  /** Minutes the plan has booked across every course this week. */
  bookedMinutes: number;
  /** Realistic study minutes in the week, from the plan's own capacity figure. */
  capacityMinutes: number;
  /**
   * Capacity not yet spoken for. Negative is impossible by construction — the scheduler
   * cannot book past capacity — so this is room, never debt.
   */
  unbookedMinutes: number;
  /** Courses with nothing booked this week. Not a fault; sometimes it is simply correct. */
  coursesWithNothingBooked: number;
}

export interface CourseLoadInput {
  courseIds: readonly string[];
  workItems: readonly WorkItem[];
  /** This week's blocks. */
  booked: readonly { workItemId: string; minutes: number }[];
  /** Completed blocks across the term, for invested time and last-progress. */
  completed: readonly { workItemId: string; endAt: string; minutes: number }[];
  capacityMinutes: number;
  now: string;
}

export function computeCourseLoad(input: CourseLoadInput): TermLoad {
  const nowMinutes = toEpochMinutes(input.now);
  const itemsById = new Map(input.workItems.map((w) => [w.id, w]));

  // A project broken into stages is represented by its stages, so the parent is not counted
  // as open work beside its own children — the same rule the scheduler and term progress use.
  const parentIds = new Set(
    input.workItems.filter((w) => w.parentWorkItemId).map((w) => w.parentWorkItemId!),
  );
  const routineKeys = findRecurringTitles(input.workItems);

  const bookedByCourse = new Map<string, { minutes: number; blocks: number }>();
  for (const block of input.booked) {
    const courseId = itemsById.get(block.workItemId)?.courseId;
    if (!courseId) continue;
    const running = bookedByCourse.get(courseId) ?? { minutes: 0, blocks: 0 };
    bookedByCourse.set(courseId, {
      minutes: running.minutes + block.minutes,
      blocks: running.blocks + 1,
    });
  }

  const investedByCourse = new Map<string, { minutes: number; lastEnd: number }>();
  for (const block of input.completed) {
    const courseId = itemsById.get(block.workItemId)?.courseId;
    if (!courseId) continue;
    const end = toEpochMinutes(block.endAt);
    const running = investedByCourse.get(courseId);
    investedByCourse.set(courseId, {
      minutes: (running?.minutes ?? 0) + block.minutes,
      lastEnd: Math.max(running?.lastEnd ?? Number.NEGATIVE_INFINITY, end),
    });
  }

  const totalBooked = [...bookedByCourse.values()].reduce((sum, c) => sum + c.minutes, 0);

  const courses = input.courseIds.map((courseId) => {
    const booked = bookedByCourse.get(courseId) ?? { minutes: 0, blocks: 0 };
    const invested = investedByCourse.get(courseId);
    const open = input.workItems.filter(
      (w) => w.courseId === courseId && isOpen(w.status) && !parentIds.has(w.id),
    );

    const dated = open
      .filter((w) => w.dueAt !== null)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
    // The next thing *ahead*, not the oldest overdue one — a stale date should not stand in
    // for what is actually coming. The past-due rows have their own home on the Chronicle.
    const next = dated.find((w) => toEpochMinutes(w.dueAt!) >= nowMinutes) ?? null;

    const overdueRoutine = open.filter(
      (w) =>
        routineKeys.has(routineKeyOf(w)) &&
        w.dueAt !== null &&
        toEpochMinutes(w.dueAt) < nowMinutes,
    ).length;
    const hasRoutine = input.workItems.some(
      (w) => w.courseId === courseId && routineKeys.has(routineKeyOf(w)),
    );

    return {
      courseId,
      bookedMinutes: booked.minutes,
      shareOfBooked: totalBooked > 0 ? booked.minutes / totalBooked : 0,
      blocks: booked.blocks,
      investedMinutes: invested?.minutes ?? 0,
      openItems: open.length,
      openProjects: open.filter((w) => parentIds.has(w.id) === false && isBigEnough(w)).length,
      nextDueAt: next?.dueAt ?? null,
      nextDueTitle: next?.title ?? null,
      upkeep: upkeepFor(hasRoutine, overdueRoutine),
      upkeepOverdue: overdueRoutine,
      daysSinceProgress:
        invested === undefined
          ? null
          : Math.floor((nowMinutes - invested.lastEnd) / (24 * 60)),
    };
  });

  return {
    courses,
    bookedMinutes: totalBooked,
    capacityMinutes: input.capacityMinutes,
    unbookedMinutes: Math.max(0, input.capacityMinutes - totalBooked),
    coursesWithNothingBooked: courses.filter((c) => c.bookedMinutes === 0).length,
  };
}

function upkeepFor(hasRoutine: boolean, overdue: number): UpkeepStatus {
  if (!hasRoutine) return "no_routine";
  if (overdue >= BEHIND_ITEMS) return "behind";
  if (overdue >= SLIPPING_ITEMS) return "slipping";
  return "current";
}

function isOpen(status: string): boolean {
  return status !== "completed" && status !== "submitted" && status !== "canceled";
}

/**
 * Shares the Chronicle's threshold *and* its effort fallback. A local copy of the rule read
 * `estimatedMinutes ?? remainingMinutes ?? 0`, which is zero for every extracted item — so
 * this table reported no projects at all for a term the Chronicle listed seven in.
 */
function isBigEnough(item: WorkItem): boolean {
  return effortOf(item).minutes >= PROJECT_MINUTES;
}
