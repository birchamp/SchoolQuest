import {
  durationMinutes,
  epochMinutesToDate,
  fromEpochMinutes,
  MINUTES_PER_DAY,
  dateToEpochMinutes,
  toEpochMinutes,
  type WorkItem,
} from "@schoolquest/domain";
import { buildCapacity, totalCapacityMinutes } from "./capacity.js";
// The scheduler's "not yet worth starting" and the terrain's "starting to ask for attention"
// are the same judgement seen from two sides, so they share one number rather than drifting.
import { runwayDays } from "./terrain.js";
import { isSchedulable, scoreWorkItems } from "./priority.js";
import type { ReasonCode, RiskCode } from "./reason-codes.js";
import type {
  CapacityWindow,
  PlannedSession,
  PlanningInput,
  PlanningResult,
  PlanRecommendation,
  PlanRisk,
  PriorityScore,
} from "./types.js";

/**
 * v2 adds the first-touch pass: in an oversubscribed week every course gets one block before
 * any course gets a second. Stamped on every plan, so a plan made under the old rule is
 * identifiable rather than silently assumed to be comparable.
 */
export const ALGORITHM_VERSION = "heuristic-v2";

/** Fallback effort by work type, used only when the student has given us nothing better. */
const DEFAULT_EFFORT_MINUTES: Record<string, number> = {
  reading: 60,
  quiz: 30,
  quiz_prep: 45,
  problem_set: 90,
  paper: 240,
  presentation: 180,
  group_project: 180,
  exam: 60,
  exam_prep: 120,
  lab: 120,
  discussion: 30,
  milestone: 45,
  other: 60,
};

interface PendingWork {
  item: WorkItem;
  priority: PriorityScore;
  minutesRemaining: number;
  /** What `minutesRemaining` started as, so a second pass can reset to it. */
  allocatedMinutes: number;
  /** Absolute latest a session may end: due date minus the reserved buffer. */
  latestEnd: number | null;
  earliestStart: number;
}

/**
 * Constraint-aware heuristic scheduler (docs/04-planning-engine-spec.md §11).
 *
 * Deliberately not an LLM: given the same input and seed it must produce the same plan,
 * every placement must be explainable by reason codes, and hard constraints must hold.
 */
export function generatePlan(input: PlanningInput, planVersionId: string): PlanningResult {
  const now = toEpochMinutes(input.now);
  const horizonStartMinutes = dateToEpochMinutes(input.horizonStart);
  const horizonEndMinutes = horizonStartMinutes + input.horizonDays * MINUTES_PER_DAY;

  const { windows, meals } = buildCapacity(input);
  const priorities = scoreWorkItems(input);
  const priorityById = new Map(priorities.map((p) => [p.workItemId, p]));

  const risks: PlanRisk[] = [];
  const sessions: PlannedSession[] = [];
  // Minutes already spoken for on each calendar date, enforcing the daily ceiling.
  const dailyMinutes = new Map<string, number>();
  // Free space remaining in each window as we consume it.
  const remainingWindows: CapacityWindow[] = windows.map((w) => ({ ...w }));

  // --- Carry over the previous plan's committed blocks first, so replanning is stable.
  const carried = carryOverSessions(input, horizonStartMinutes, horizonEndMinutes);
  for (const session of carried) {
    sessions.push(session);
    consumeWithBreak(remainingWindows, toEpochMinutes(session.startAt), toEpochMinutes(session.endAt), input);
    addDaily(dailyMinutes, session.startAt, session.minutes);
  }

  // --- Work out what still needs time.
  const carriedMinutesByItem = new Map<string, number>();
  for (const session of carried) {
    carriedMinutesByItem.set(
      session.workItemId,
      (carriedMinutesByItem.get(session.workItemId) ?? 0) + session.minutes,
    );
  }

  const parentIds = new Set(
    input.workItems.filter((w) => w.parentWorkItemId).map((w) => w.parentWorkItemId!),
  );

  const pending: PendingWork[] = [];
  for (const item of input.workItems) {
    if (!isSchedulable(item)) continue;
    // A project with milestones is scheduled through those milestones, never directly.
    if (parentIds.has(item.id)) continue;

    const priority = priorityById.get(item.id);
    if (!priority) continue;

    const required = requiredMinutes(item) - (carriedMinutesByItem.get(item.id) ?? 0);
    if (required <= 0) continue;

    const allocation = horizonAllocation(item, required, input, now);

    if (item.estimatedMinutes === null && item.remainingMinutes === null) {
      risks.push({
        level: "watch",
        code: "EFFORT_UNKNOWN",
        workItemId: item.id,
        detail: `Using a default estimate of ${requiredMinutes(item)} minutes for "${item.title}".`,
      });
    }
    if (item.dueAt === null) {
      // Undated work still gets scheduled — it exists and needs doing — but the student
      // must be able to see that the app does not know when it is due. An unknown that
      // looks like a plan is worse than a visible gap (docs/04-planning-engine-spec.md §14).
      risks.push({
        level: "watch",
        code: "DUE_DATE_UNKNOWN",
        workItemId: item.id,
        detail: `No due date is known for "${item.title}", so it is scheduled without deadline pressure.`,
      });
    } else if (item.sourceConfidence !== "confirmed") {
      risks.push({
        level: "watch",
        code: "DUE_DATE_UNCONFIRMED",
        workItemId: item.id,
        detail: `The due date for "${item.title}" has not been confirmed yet.`,
      });
    }

    if (allocation.paced) {
      risks.push({
        level: "safe",
        code: "PACED_TO_DEADLINE",
        workItemId: item.id,
        detail:
          `"${item.title}" is being worked through steadily: ${allocation.minutes} of its ` +
          `${required} remaining minutes are planned for this week.`,
      });
    }

    pending.push({
      item,
      priority,
      minutesRemaining: allocation.minutes,
      allocatedMinutes: allocation.minutes,
      latestEnd: latestSafeEnd(item, input),
      earliestStart: Math.max(
        now,
        item.availableAt ? toEpochMinutes(item.availableAt) : Number.NEGATIVE_INFINITY,
        earliestSensibleStart(item, required),
      ),
    });
  }

  // --- Order by priority, then by placement scarcity (tighter deadlines go first).
  pending.sort((a, b) => {
    const byScore = b.priority.score - a.priority.score;
    if (Math.abs(byScore) > 0.001) return byScore;
    const aEnd = a.latestEnd ?? Number.POSITIVE_INFINITY;
    const bEnd = b.latestEnd ?? Number.POSITIVE_INFINITY;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return a.item.id.localeCompare(b.item.id);
  });

  // Predecessors must finish before their successors can start.
  const orderedPending = applyDependencyOrder(pending, input);
  const earliestStartByItem = new Map<string, number>();

  let sessionCounter = carried.length;
  const unscheduled: string[] = [];

  /**
   * Place everything that is ripe; if that turns out to be nothing at all, place the rest.
   *
   * The deferral above is right almost always and wrong in one case: a week with genuinely
   * nothing inside its runway would hand back an empty plan. For a reader who opens this app to
   * be told what to do next, "nothing" is the one answer it must never give by accident. A
   * previous attempt at deferring distant work was reverted for exactly this, so the rule keeps
   * the deferral and adds the floor rather than choosing between them.
   */
  /** Places one chunk of this work, or returns null when nothing will hold it. */
  const placeChunk = (work: PendingWork, chunk: number, earliest: number): number | null => {
    const placement = findBestPlacement(work, chunk, earliest, remainingWindows, {
      input,
      dailyMinutes,
    });
    if (!placement) return null;

    sessions.push({
      id: `${planVersionId}_s${sessionCounter++}`,
      workItemId: work.item.id,
      courseId: work.item.courseId,
      startAt: fromEpochMinutes(placement.start),
      endAt: fromEpochMinutes(placement.end),
      minutes: placement.end - placement.start,
      locked: false,
      acceptedByUser: false,
      reasonCodes: mergeReasonCodes(work.priority.reasonCodes, placement.reasonCodes),
      tradeoffCode: placement.tradeoffCode,
      // Freshly proposed blocks are the cheapest thing to move on the next replan.
      movementCost: 0.2,
    });

    consumeWithBreak(remainingWindows, placement.start, placement.end, input);
    addDaily(dailyMinutes, fromEpochMinutes(placement.start), placement.end - placement.start);
    work.minutesRemaining -= placement.end - placement.start;
    return placement.end;
  };

  /**
   * Under overload, give every course one session before any course gets a second.
   *
   * The greedy pass below is priority-ordered and takes each item's whole weekly allocation
   * before moving on, which is right when the week has room: finishing a thing beats
   * half-finishing five. When the week does not have room it is ruinous. `horizonAllocation`
   * hands an item its *entire* remaining effort once the deadline is inside the horizon, so one
   * problem set due Friday can take nine of ten blocks and four courses get nothing — measured
   * at a median of three courses of five per week under an eight-hour budget, twice dropping to
   * one.
   *
   * A student drowning in five courses is better served by partial credit in five than full
   * credit in one, and by knowing every course is still moving. So each course's top-priority
   * item gets one session's worth reserved first, and the greedy pass then allocates what is
   * left in the usual order.
   *
   * Only when the week is genuinely oversubscribed. With slack there is nothing to arbitrate —
   * everything gets its full allocation either way — and reordering a week that fits would
   * scatter work for no gain.
   */
  const placedByFirstTouch = new Set<string>();
  const placeOnePerCourse = () => {
    // A successor placed before its predecessor is scheduled would violate the ordering the
    // greedy pass maintains, and this pass runs before any of that is known.
    const hasPendingPredecessor = new Set(
      input.dependencies
        .filter((d) => orderedPending.some((w) => w.item.id === d.predecessorWorkItemId))
        .map((d) => d.successorWorkItemId),
    );

    const touched = new Set<string>();
    for (const work of orderedPending) {
      if (touched.has(work.item.courseId)) continue;
      if (hasPendingPredecessor.has(work.item.id)) continue;
      if (work.minutesRemaining <= 0) continue;

      // One useful session, not one token minute. Indivisible work is placed whole or not at
      // all, which is what it means for it to be indivisible.
      const cap = Math.max(input.preferences.minSessionMinutes, FIRST_TOUCH_MINUTES);
      const chunk =
        work.item.divisibility === "divisible"
          ? Math.min(work.minutesRemaining, cap)
          : work.minutesRemaining;

      const earliest = Math.max(work.earliestStart, now);
      if (placeChunk(work, chunk, earliest) === null) continue;
      touched.add(work.item.courseId);
      placedByFirstTouch.add(work.item.id);
    }
  };

  const placeAll = () => {
  for (const work of orderedPending) {
    const dependencyFloor = earliestStartByItem.get(work.item.id) ?? Number.NEGATIVE_INFINITY;
    const earliest = Math.max(work.earliestStart, dependencyFloor, now);
    let lastEnd = earliest;
    let placedAny = placedByFirstTouch.has(work.item.id);

    while (work.minutesRemaining > 0) {
      const end = placeChunk(work, nextChunkMinutes(work, input), earliest);
      if (end === null) break;
      lastEnd = Math.max(lastEnd, end);
      placedAny = true;
    }

    // Successors cannot begin until this item's last session ends.
    for (const dep of input.dependencies) {
      if (dep.predecessorWorkItemId !== work.item.id) continue;
      if (dep.dependencyType === "same_session") continue;
      const current = earliestStartByItem.get(dep.successorWorkItemId) ?? Number.NEGATIVE_INFINITY;
      earliestStartByItem.set(dep.successorWorkItemId, Math.max(current, lastEnd));
    }

    if (work.minutesRemaining > 0) {
      unscheduled.push(work.item.id);
      risks.push(unscheduledRisk(work, placedAny));
    }
  }
  };

  /**
   * Demand against what is actually left after the carried blocks, and across more than one
   * course — a single-course week has nothing to arbitrate between.
   */
  const demandMinutes = orderedPending.reduce((sum, w) => sum + w.minutesRemaining, 0);
  const coursesWithWork = new Set(orderedPending.map((w) => w.item.courseId)).size;
  if (coursesWithWork > 1 && demandMinutes > totalCapacityMinutes(remainingWindows)) {
    placeOnePerCourse();
  }

  placeAll();
  if (sessions.length === carried.length && orderedPending.length > 0) {
    // Nothing was ripe. Lift the runway floor and try again — nothing has been consumed, so the
    // second pass starts from the same empty week the first one did.
    unscheduled.length = 0;
    for (const work of orderedPending) {
      work.earliestStart = Math.max(
        now,
        work.item.availableAt ? toEpochMinutes(work.item.availableAt) : Number.NEGATIVE_INFINITY,
      );
      work.minutesRemaining = work.allocatedMinutes;
    }
    placeAll();
  }

  const usedMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  const availableMinutes = totalCapacityMinutes(windows);

  sessions.sort((a, b) => a.startAt.localeCompare(b.startAt));

  return {
    planVersionId,
    algorithmVersion: ALGORITHM_VERSION,
    horizonStart: input.horizonStart,
    horizonEnd: epochMinutesToDate(horizonEndMinutes),
    sessions,
    recommendations: buildRecommendations(sessions, input, priorityById, now),
    // Reported, not silent. Time the engine held on the student's behalf has to be
    // inspectable, or it is indistinguishable from time the engine lost.
    meals,
    risks,
    unscheduledWorkItemIds: unscheduled,
    capacity: { usedMinutes, availableMinutes },
    priorities,
  };
}

/** Effort still owed on an item, from the best source available (docs/04 §9). */
function requiredMinutes(item: WorkItem): number {
  if (item.remainingMinutes !== null) return item.remainingMinutes;
  if (item.estimatedMinutes !== null) return item.estimatedMinutes;
  return DEFAULT_EFFORT_MINUTES[item.workType] ?? 60;
}

/**
 * Aim to finish a paced project about a fifth early, so one bad week is absorbed rather
 * than compounding into a crisis.
 */
const PACING_HEADROOM = 1.25;

/** More than two sittings: large enough that *when* it happens has to be planned. */
const LONG_PROJECT_MINUTES = 120;

/** A paced project always gets at least this much, so it can never become invisible. */
const MIN_PACED_MINUTES = 45;

/**
 * What one course is guaranteed in an oversubscribed week, before any course gets a second
 * block. Half an hour: enough to be a real sitting rather than a gesture, small enough that
 * five courses cost well under half of even a squeezed eight-hour week.
 */
const FIRST_TOUCH_MINUTES = 30;

/**
 * How much of a long item's remaining effort belongs in *this* horizon.
 *
 * Without this the scheduler placed every item's entire remaining effort in the current
 * week, whatever its due date. Measured against a realistic squeeze — one 900-minute paper
 * six weeks out against twelve quizzes due within three days — it put all 900 minutes of
 * the paper into week one, took 71% of the week for it, and pushed four of the quizzes out
 * of the plan entirely.
 *
 * That is the same failure as ignoring the paper, wearing the opposite costume: the student
 * is handed an impossible week, the genuinely urgent work disappears, and there is no sense
 * of steady progress — just one enormous block that will not happen.
 *
 * Only long work is paced. An earlier version also deferred *small* distant work out of the
 * horizon entirely, which emptied the back half of the week and wasted capacity that could
 * happily hold next week's reading. Short items due later were never the problem; they fill
 * a week productively and finish in one sitting whenever they land.
 */
function horizonAllocation(
  item: WorkItem,
  required: number,
  input: PlanningInput,
  now: number,
): { minutes: number; paced: boolean } {
  if (required <= LONG_PROJECT_MINUTES) return { minutes: required, paced: false };

  // No deadline is no basis for pacing against a runway, but a large undated item must
  // still not swallow the week — it gets a quarter, which is the same "make steady
  // progress" behaviour without pretending to know a date.
  if (!item.dueAt) {
    const share = Math.max(MIN_PACED_MINUTES, Math.round(required / 4));
    return { minutes: Math.min(required, share), paced: share < required };
  }

  const untilDue = toEpochMinutes(item.dueAt) - now;
  if (untilDue <= input.horizonDays * MINUTES_PER_DAY) return { minutes: required, paced: false };

  const daysUntilDue = untilDue / MINUTES_PER_DAY;
  const share = Math.round((required * input.horizonDays * PACING_HEADROOM) / daysUntilDue);
  const minutes = Math.min(required, Math.max(MIN_PACED_MINUTES, share));
  return { minutes, paced: minutes < required };
}

/**
 * The earliest moment work should be *started*, as opposed to the earliest it is possible.
 *
 * Without this there is no lower bound at all: a reading quiz due on 2 December is a candidate
 * on 24 August, and with capacity to spare the planner books it. Walking a real semester showed
 * exactly that — a five-course term finished in nine weeks, with the last seven planning nothing
 * because the work had all been done months before it was set.
 *
 * That is wrong twice over. Studying week thirteen's material in week one is studying material
 * nobody has taught yet, so the session is close to worthless; and a back half of term that
 * renders empty is actively misleading for a reader who cannot feel time passing.
 *
 * The runway is the same one the terrain view uses to decide when a piece of work starts asking
 * for attention, and it has to be, or the app warns about work it will not schedule — a
 * contradiction it has already shipped once, in a different form, at `latestSafeEnd`.
 *
 * **In practice that runway is always ten days here, and that is a decision rather than an
 * accident.** `runwayDays` derives a window from effort and floors it at `MIN_WARNING_DAYS`;
 * for anything at or under `LONG_PROJECT_MINUTES` the derivation comes out at four days or
 * fewer, so the floor always wins. The size-sensitivity is inert for exactly the set this gate
 * applies to — worth saying plainly, because the call reads as though the window scales with
 * the work and it does not. Ten days of lead on a quiz was chosen deliberately; if it should be
 * a fortnight, move `MIN_WARNING_DAYS`. It stays a call to `runwayDays` rather than a local
 * constant so that moving it moves the terrain's warning threshold with it, which is the only
 * thing keeping the two from contradicting each other.
 *
 * Note also that most work carries no effort estimate at all — the default for its type stands
 * in — so the ten days is doing more of the judging than the estimate is.
 *
 * **It applies to short work only.** Long projects are already handled, and handled better, by
 * `horizonAllocation`: they get a proportional slice every week from the moment they exist,
 * which is the whole reason a fifteen-hour paper does not arrive as a crisis. Gating those the
 * same way broke exactly that — the first attempt at this refused to give a distant project any
 * time at all until it was inside its runway, which is the failure mode this app was built to
 * prevent. Pacing covers the long tail; this covers the short work pacing never touches.
 */
function earliestSensibleStart(item: WorkItem, required: number): number {
  // Nothing to be early relative to.
  if (!item.dueAt) return Number.NEGATIVE_INFINITY;
  // Paced work starts as early as it likes, by design.
  if (required > LONG_PROJECT_MINUTES) return Number.NEGATIVE_INFINITY;
  return toEpochMinutes(item.dueAt) - runwayDays(required) * MINUTES_PER_DAY;
}

/**
 * The last moment a session may end. High-value work reserves a buffer before the
 * deadline so a bad day does not become a missed submission (docs/04 §8).
 */
function latestSafeEnd(item: WorkItem, input: PlanningInput): number | null {
  if (!item.dueAt) return null;
  const due = toEpochMinutes(item.dueAt);
  const now = toEpochMinutes(input.now);
  const bufferDays = input.preferences.deadlineBufferDays;
  const buffered = due - bufferDays * MINUTES_PER_DAY;

  // A margin that makes work unschedulable is worse than no margin.
  //
  // This used to return `max(buffered, now)`, which reads as "never push the deadline earlier
  // than now" and does the opposite of what it intends. Once the buffer has elapsed the limit
  // collapses to `now`, every candidate slot ends after it, and the item cannot be booked at
  // all — silently, because nothing reports a deadline that excluded itself.
  //
  // Walking a real semester made the cost plain: five pieces of work went past their dates in
  // the first month and were never scheduled again for the remaining seven weeks. The map went
  // on burning them red while the planner had quietly given up on them, which is the worst
  // possible pair of behaviours — the app telling the student something needs attention and
  // then refusing to make room for it.
  //
  // So the margin degrades instead of biting: protect it while it exists, fall back to the real
  // deadline once it has gone, and drop the constraint entirely for work already past its date.
  // Late work is still worth doing — a late penalty beats a zero, and a project milestone that
  // slipped still has the rest of the project waiting on it.
  if (buffered > now) return buffered;
  if (due > now) return due;
  return null;
}

function nextChunkMinutes(work: PendingWork, input: PlanningInput): number {
  const prefs = input.preferences;
  if (work.item.divisibility !== "divisible") return work.minutesRemaining;

  const preferred = Math.min(prefs.preferredSessionMinutes, prefs.maxSessionMinutes);
  if (work.minutesRemaining <= preferred) return work.minutesRemaining;
  // Avoid leaving a stub shorter than the minimum useful session.
  const remainderIfPreferred = work.minutesRemaining - preferred;
  if (remainderIfPreferred < prefs.minSessionMinutes) {
    return Math.min(work.minutesRemaining, prefs.maxSessionMinutes);
  }
  return preferred;
}

interface Placement {
  start: number;
  end: number;
  reasonCodes: ReasonCode[];
  tradeoffCode: PlannedSession["tradeoffCode"];
}

/**
 * Scores every window that could hold this chunk and returns the best fit.
 * Returns null when no window satisfies the hard constraints.
 */
function findBestPlacement(
  work: PendingWork,
  chunkMinutes: number,
  earliest: number,
  windows: CapacityWindow[],
  ctx: { input: PlanningInput; dailyMinutes: Map<string, number> },
): Placement | null {
  const prefs = ctx.input.preferences;
  let best: { placement: Placement; utility: number } | null = null;

  for (const window of windows) {
    const start = Math.max(window.start, earliest);
    const available = window.end - start;
    if (available < prefs.minSessionMinutes) continue;

    let minutes = Math.min(chunkMinutes, available, prefs.maxSessionMinutes);
    if (work.item.divisibility !== "divisible" && minutes < chunkMinutes) continue;
    if (minutes < prefs.minSessionMinutes) continue;

    const end = start + minutes;
    if (work.latestEnd !== null && end > work.latestEnd) continue;

    // Daily ceiling is a hard constraint: we shorten to fit, or skip the day entirely.
    const date = epochMinutesToDate(start);
    const usedToday = ctx.dailyMinutes.get(date) ?? 0;
    const roomToday = prefs.maxDailyAcademicMinutes - usedToday;
    if (roomToday < prefs.minSessionMinutes) continue;

    let tradeoffCode: PlannedSession["tradeoffCode"] = null;
    if (minutes > roomToday) {
      minutes = roomToday;
      tradeoffCode = "DAILY_LIMIT_REACHED";
    }
    if (minutes < chunkMinutes && tradeoffCode === null && work.item.divisibility === "divisible") {
      tradeoffCode = "SESSION_SHORTENED";
    }

    const fit = contextFit(work, window, minutes, chunkMinutes);
    // Prefer good fits, and among equal fits prefer earlier placement so buffers survive.
    const earliness = 1 - Math.min(1, (start - earliest) / (7 * MINUTES_PER_DAY));
    const utility = fit.score * 0.7 + earliness * 0.3;

    if (!best || utility > best.utility + 0.0001) {
      best = {
        utility,
        placement: {
          start,
          end: start + minutes,
          reasonCodes: fit.reasonCodes,
          tradeoffCode,
        },
      };
    }
  }

  return best?.placement ?? null;
}

/** How well a window suits this task: energy vs cognitive demand, location, and size. */
function contextFit(
  work: PendingWork,
  window: CapacityWindow,
  minutes: number,
  desiredMinutes: number,
): { score: number; reasonCodes: ReasonCode[] } {
  const reasonCodes: ReasonCode[] = [];
  let score = 0.5;

  const demand = work.item.cognitiveDemand;
  const energy = window.energyLevel;
  if (demand === "high" && energy === "high") {
    score += 0.25;
    reasonCodes.push("MATCHES_ENERGY_LEVEL");
  } else if (demand === "high" && energy === "low") {
    score -= 0.3;
  } else if (demand === "low" && energy === "low") {
    score += 0.1;
  }

  const needed = work.item.locationRequirement;
  if (needed !== "anywhere") {
    if (window.location === needed) {
      score += 0.25;
      reasonCodes.push("LOCATION_MATCH");
    } else {
      // A library-only task in a non-library window is not a fit at all.
      score -= 0.5;
    }
  }

  if (minutes >= desiredMinutes) {
    score += 0.1;
    reasonCodes.push("FITS_AVAILABLE_TIME");
  }

  if (score >= 0.8) reasonCodes.push("BEST_CONTEXT_WINDOW");

  return { score: Math.min(1, Math.max(0, score)), reasonCodes };
}

/**
 * Keeps locked and user-accepted blocks from the previous plan. This is the whole of
 * "minimal-change replanning" at the block level — anything the student committed to
 * survives unless it is impossible (docs/04 §12).
 */
function carryOverSessions(
  input: PlanningInput,
  horizonStart: number,
  horizonEnd: number,
): PlannedSession[] {
  const now = toEpochMinutes(input.now);
  const itemsById = new Map(input.workItems.map((w) => [w.id, w]));
  const carried: PlannedSession[] = [];

  for (const session of input.existingSessions) {
    if (!session.locked && !session.acceptedByUser) continue;
    if (session.status !== "planned" && session.status !== "started") continue;

    const start = toEpochMinutes(session.startAt);
    const end = toEpochMinutes(session.endAt);
    if (end <= now) continue; // Already in the past; the outcome flow handles it.
    if (start >= horizonEnd || end <= horizonStart) continue;

    const item = itemsById.get(session.workItemId);
    if (!item || !isSchedulable(item)) continue;

    carried.push({
      id: session.id,
      workItemId: session.workItemId,
      courseId: item.courseId,
      startAt: session.startAt,
      endAt: session.endAt,
      minutes: durationMinutes({ start, end }),
      locked: session.locked,
      acceptedByUser: session.acceptedByUser,
      reasonCodes: session.locked ? [] : ["USER_PRIORITIZED"],
      tradeoffCode: null,
      movementCost: session.locked ? 1 : 0.8,
    });
  }

  // Deterministic ordering keeps generated session ids stable across runs.
  return carried.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
}

/**
 * Topological pass so a predecessor is always considered before its successors, while
 * otherwise preserving priority order.
 */
function applyDependencyOrder(pending: PendingWork[], input: PlanningInput): PendingWork[] {
  const byId = new Map(pending.map((p) => [p.item.id, p]));
  const blockers = new Map<string, string[]>();
  for (const dep of input.dependencies) {
    if (!byId.has(dep.successorWorkItemId) || !byId.has(dep.predecessorWorkItemId)) continue;
    const list = blockers.get(dep.successorWorkItemId);
    if (list) list.push(dep.predecessorWorkItemId);
    else blockers.set(dep.successorWorkItemId, [dep.predecessorWorkItemId]);
  }

  const ordered: PendingWork[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();

  const visit = (work: PendingWork): void => {
    if (placed.has(work.item.id) || visiting.has(work.item.id)) return;
    visiting.add(work.item.id);
    for (const blockerId of blockers.get(work.item.id) ?? []) {
      const blocker = byId.get(blockerId);
      if (blocker) visit(blocker);
    }
    visiting.delete(work.item.id);
    if (!placed.has(work.item.id)) {
      placed.add(work.item.id);
      ordered.push(work);
    }
  };

  for (const work of pending) visit(work);
  return ordered;
}

function unscheduledRisk(work: PendingWork, placedAny: boolean): PlanRisk {
  if (!placedAny) {
    return {
      level: "at_risk",
      code: "NO_FEASIBLE_WINDOW",
      workItemId: work.item.id,
      detail: `No window in this horizon fits "${work.item.title}" before its deadline.`,
    };
  }
  return {
    level: "watch",
    code: "INSUFFICIENT_CAPACITY",
    workItemId: work.item.id,
    detail: `"${work.item.title}" still needs ${work.minutesRemaining} minutes beyond this week's capacity.`,
  };
}

/**
 * Today's ranked next actions.
 *
 * When nothing remains today, the recommendations fall back to the next scheduled day
 * rather than coming back empty. An empty Today screen reads as "the app is broken" or
 * "nothing matters", when the honest answer is "not today — here is what is next".
 * Callers distinguish the two by comparing `startAt` against the current date.
 */
function buildRecommendations(
  sessions: PlannedSession[],
  input: PlanningInput,
  priorityById: Map<string, PriorityScore>,
  now: number,
): PlanRecommendation[] {
  const itemsById = new Map(input.workItems.map((w) => [w.id, w]));

  const chosen = selectRecommendedSessions(sessions, now, (a, b) => {
    const aScore = priorityById.get(a.workItemId)?.score ?? 0;
    const bScore = priorityById.get(b.workItemId)?.score ?? 0;
    // The next block in the day wins ties — the plan is meant to be followed in order.
    return a.startAt.localeCompare(b.startAt) || bScore - aScore;
  });

  return chosen.map((session, index) => ({
    rank: index,
    sessionId: session.id,
    workItemId: session.workItemId,
    title: itemsById.get(session.workItemId)?.title ?? "Study session",
    courseId: session.courseId,
    durationMinutes: session.minutes,
    startAt: session.startAt,
    reasonCodes: session.reasonCodes,
    tradeoffCode: session.tradeoffCode,
  }));
}

/** The minimum a session must expose to be picked as a next action. */
export interface RecommendableSession {
  workItemId: string;
  startAt: string;
}

/**
 * Picks the sessions that belong on Today, newest plan or oldest.
 *
 * Split out of `buildRecommendations` because a plan version is written once and read for
 * up to a week afterwards. Baked-in recommendations were therefore still naming Monday's
 * blocks on Thursday, and went on naming work the student had already finished. Readers
 * call this against live session rows to get an answer that is current, without re-running
 * the scheduler — which matters on the Workers free plan, where a request has 10ms of CPU.
 *
 * The default comparator orders by start time alone. Priority only ever broke ties between
 * sessions starting at the same minute, and a reader that has no scores is better served by
 * a stable, explainable order than by a re-derived one.
 */
export function selectRecommendedSessions<T extends RecommendableSession>(
  sessions: readonly T[],
  now: number,
  compare: (a: T, b: T) => number = (a, b) => a.startAt.localeCompare(b.startAt),
  limit = 3,
): T[] {
  const endOfToday = dateToEpochMinutes(epochMinutesToDate(now)) + MINUTES_PER_DAY;

  // A 30-minute grace period keeps a block that just started from vanishing from Today.
  const upcoming = sessions.filter((s) => toEpochMinutes(s.startAt) >= now - 30).sort(compare);
  const todays = upcoming.filter((s) => toEpochMinutes(s.startAt) < endOfToday);
  const chosen = todays.length > 0 ? todays : nextScheduledDay(upcoming);

  // One session per work item. Long assignments are split into several blocks on the same
  // day, which made Today offer "Lab Notebook" as the next action and then again as both
  // alternatives. The alternatives exist to answer "or instead?", and the same task three
  // times is not an alternative — it is the same choice printed three times.
  const seen = new Set<string>();
  const distinct: T[] = [];
  for (const session of chosen) {
    if (seen.has(session.workItemId)) continue;
    seen.add(session.workItemId);
    distinct.push(session);
    if (distinct.length === limit) break;
  }
  return distinct;
}

/** All sessions on the earliest upcoming date, so the fallback reads as one coherent day. */
function nextScheduledDay<T extends RecommendableSession>(upcoming: readonly T[]): T[] {
  const first = upcoming[0];
  if (!first) return [];
  const date = first.startAt.slice(0, 10);
  return upcoming.filter((s) => s.startAt.slice(0, 10) === date);
}

function mergeReasonCodes(a: ReasonCode[], b: ReasonCode[]): ReasonCode[] {
  return [...new Set([...a, ...b])];
}

/**
 * Removes a placed block, plus the recovery time after it, from the remaining free space.
 *
 * `breakMinutes` was declared in the preferences, written by the seeder, and read by nothing
 * — so the scheduler packed blocks end to end: a 90-minute problem set finishing at 15:00
 * and the next block starting at 15:00 exactly, three or four times in an afternoon. For a
 * student whose whole difficulty is starting and stopping tasks, a plan with no seam between
 * them is a plan that fails at the first transition and then reads as a personal failure.
 *
 * The break is held out of the free space but never counted as academic time, so the daily
 * ceiling and the capacity readout both still mean what they say.
 */
function consumeWithBreak(
  windows: CapacityWindow[],
  start: number,
  end: number,
  input: PlanningInput,
): void {
  consume(windows, start, end + Math.max(0, input.preferences.breakMinutes));
}

/** Removes a placed block from the remaining free space. */
function consume(windows: CapacityWindow[], start: number, end: number): void {
  for (let i = windows.length - 1; i >= 0; i--) {
    const w = windows[i]!;
    if (end <= w.start || start >= w.end) continue;

    const left = { ...w, end: start };
    const right = { ...w, start: end };
    windows.splice(i, 1);
    if (right.end - right.start > 0) windows.splice(i, 0, right);
    if (left.end - left.start > 0) windows.splice(i, 0, left);
  }
  windows.sort((a, b) => a.start - b.start);
}

function addDaily(dailyMinutes: Map<string, number>, startIso: string, minutes: number): void {
  const date = startIso.slice(0, 10);
  dailyMinutes.set(date, (dailyMinutes.get(date) ?? 0) + minutes);
}

/** Exported for tests that need the same fallback the scheduler uses. */
export { requiredMinutes, DEFAULT_EFFORT_MINUTES };
export type { RiskCode };
