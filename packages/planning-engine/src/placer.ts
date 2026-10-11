import {
  fromEpochMinutes,
  MINUTES_PER_DAY,
  mergeIntervals,
  subtractIntervals,
  toEpochMinutes,
  type WorkItem,
  type ZoneCalendar,
} from "@schoolquest/domain";
import { totalCapacityMinutes } from "./capacity.js";
import type { ReasonCode } from "./reason-codes.js";
import type {
  CapacityWindow,
  PlannedSession,
  PlanningInput,
  PlanRisk,
  PriorityScore,
} from "./types.js";

/** One item's claim on this horizon, as the placer sees it. */
export interface PendingWork {
  item: WorkItem;
  priority: PriorityScore;
  minutesRemaining: number;
  /** What `minutesRemaining` started as, so a second pass can reset to it. */
  allocatedMinutes: number;
  /** Latest a session should end: due date minus the reserved buffer. */
  latestEnd: number | null;
  /** Latest a session may end at all: the deadline itself, or null once it has passed. */
  deadline: number | null;
  earliestStart: number;
}

/**
 * What one course is guaranteed in an oversubscribed week, before any course gets a second
 * block. Half an hour: enough to be a real sitting rather than a gesture, small enough that
 * five courses cost well under half of even a squeezed eight-hour week.
 */
const FIRST_TOUCH_MINUTES = 30;

/** Displacement steps the deadline rescue may try per plan; see `Placer.rescue`. */
const RESCUE_STEP_BUDGET = 12;

export interface PlacerSetup {
  input: PlanningInput;
  planVersionId: string;
  /** The student's days, as UTC instants. */
  calendar: ZoneCalendar;
  /** Every free window in the horizon, before anything is placed in it. Not modified. */
  windows: CapacityWindow[];
  /** The previous plan's committed blocks, kept exactly. */
  carried: PlannedSession[];
  /** What still needs time, in priority order with predecessors before successors. */
  orderedPending: PendingWork[];
}

/**
 * Turns ordered pending work into sessions on the calendar.
 *
 * Everything that changes while a plan is being placed lives here -- the free space left in each
 * window, the minutes already spoken for on each date, the dependency floors handed from
 * predecessors to successors, the rescue's step budget -- so each placement step reads and writes
 * it in one visible place rather than through closures over one long function.
 *
 * Single use: construct (which books the carried blocks), `place`, then `shortfalls`.
 */
export class Placer {
  /** Carried blocks first, then everything placed. Unsorted; the caller orders it. */
  readonly sessions: PlannedSession[] = [];

  private readonly input: PlanningInput;
  private readonly planVersionId: string;
  private readonly calendar: ZoneCalendar;
  private readonly now: number;
  private readonly windows: CapacityWindow[];
  private readonly orderedPending: PendingWork[];
  // Free space remaining in each window as we consume it.
  private readonly remainingWindows: CapacityWindow[];
  // Minutes already spoken for on each calendar date, enforcing the daily ceiling.
  private readonly dailyMinutes = new Map<string, number>();
  private readonly earliestStartByItem = new Map<string, number>();
  private readonly carriedSessions: Set<PlannedSession>;
  private readonly carriedCount: number;
  private readonly inDependency: Set<string>;
  private readonly pendingById: Map<string, PendingWork>;
  private sessionCounter: number;
  private rescueBudget = RESCUE_STEP_BUDGET;

  constructor(setup: PlacerSetup) {
    const { input, carried } = setup;
    this.input = input;
    this.planVersionId = setup.planVersionId;
    this.calendar = setup.calendar;
    this.now = toEpochMinutes(input.now);
    this.windows = setup.windows;
    this.orderedPending = setup.orderedPending;
    this.remainingWindows = setup.windows.map((w) => ({ ...w }));

    // --- Carry over the previous plan's committed blocks first, so replanning is stable.
    for (const session of carried) {
      this.sessions.push(session);
      consumeWithBreak(
        this.remainingWindows,
        toEpochMinutes(session.startAt),
        toEpochMinutes(session.endAt),
        input,
      );
      addDaily(this.dailyMinutes, this.calendar, toEpochMinutes(session.startAt), session.minutes);
    }
    this.carriedCount = carried.length;
    this.sessionCounter = carried.length;
    this.carriedSessions = new Set<PlannedSession>(carried);
    this.inDependency = new Set(
      input.dependencies.flatMap((d) => [d.predecessorWorkItemId, d.successorWorkItemId]),
    );
    this.pendingById = new Map(setup.orderedPending.map((w) => [w.item.id, w]));
  }

  /**
   * Place everything that is ripe; if that turns out to be nothing at all, place the rest.
   *
   * The runway deferral (`earliestSensibleStart`) is right almost always and wrong in one case: a
   * week with genuinely nothing inside its runway would hand back an empty plan. For a reader who
   * opens this app to be told what to do next, "nothing" is the one answer it must never give by
   * accident. A previous attempt at deferring distant work was reverted for exactly this, so the
   * rule keeps the deferral and adds the floor rather than choosing between them.
   */
  place(): void {
    const { orderedPending } = this;
    /**
     * Demand against what is actually left after the carried blocks, and across more than one
     * course — a single-course week has nothing to arbitrate between.
     */
    const demandMinutes = orderedPending.reduce((sum, w) => sum + w.minutesRemaining, 0);
    const coursesWithWork = new Set(orderedPending.map((w) => w.item.courseId)).size;
    if (coursesWithWork > 1 && demandMinutes > totalCapacityMinutes(this.remainingWindows)) {
      this.placeOnePerCourse();
    }

    this.placeAll();
    if (this.sessions.length === this.carriedCount && orderedPending.length > 0) {
      // Nothing was ripe. Lift the runway floor and try again — nothing has been consumed, so the
      // second pass starts from the same empty week the first one did.
      // The first pass wrote each predecessor's runway-bound floor into its successors. Those
      // floors are exactly what is being lifted, so they go too; the second pass rebuilds them
      // from where the predecessors actually land (issue #27).
      this.earliestStartByItem.clear();
      for (const work of orderedPending) {
        work.earliestStart = Math.max(
          this.now,
          work.item.availableAt ? toEpochMinutes(work.item.availableAt) : Number.NEGATIVE_INFINITY,
        );
        work.minutesRemaining = work.allocatedMinutes;
      }
      this.placeAll();
    }
    this.rescueDeadlines();
  }

  /**
   * What is still short once every pass has run, as risks, and the items that need a decision.
   *
   * Told once, after every pass. Risks used to be raised inside the placing loop, so the
   * nothing-was-ripe second pass reported every item it went on to place a second time.
   */
  shortfalls(horizonEndMinutes: number): { risks: PlanRisk[]; unscheduled: string[] } {
    const risks: PlanRisk[] = [];
    const unscheduled: string[] = [];
    for (const work of this.orderedPending) {
      if (work.minutesRemaining <= 0) continue;
      const placedAny = this.sessions.some(
        (session) => session.workItemId === work.item.id && !this.carriedSessions.has(session),
      );
      const risk = unscheduledRisk(work, placedAny, horizonEndMinutes, this.calendar);
      risks.push(risk);
      /**
       * Work waiting its turn is not work that failed to fit.
       *
       * Every item left without time used to go on this list, including the bulk of the term
       * that is not due for weeks and is held back on purpose. The week map prints the list as
       * "Not fitted into this week -- these items need a decision before they can be scheduled",
       * so a term with weekly assignments showed thirty-two of its forty items there on an
       * ordinary Monday, with four-fifths of the week's study time free. A student reported
       * exactly that: lots of assignments "not fitted into this week". The risk already said
       * "not this week, and that is fine"; the list now agrees with it.
       */
      if (risk.code !== "WAITING_ITS_TURN") unscheduled.push(work.item.id);
    }
    return { risks, unscheduled };
  }

  /** Places one chunk of this work, or returns null when nothing will hold it. */
  private placeChunk(work: PendingWork, chunk: number, earliest: number): number | null {
    const ctx = { input: this.input, dailyMinutes: this.dailyMinutes, calendar: this.calendar };
    let placement = findBestPlacement(work, chunk, earliest, this.remainingWindows, ctx);
    /**
     * The buffer is a margin, not a second deadline. When keeping it leaves no free time at
     * all, the real deadline is used instead and the block says it is closer than usual.
     *
     * `latestSafeEnd` already degrades the buffer once it has *elapsed*, but not when it merely
     * falls before the student's free time. Reading due at nine tomorrow, a one-day buffer, and
     * a morning with classes until three: the buffered limit was nine this morning, still in the
     * future, so it stood -- and nothing ends before nine. The item went out as "no window fits
     * this before its deadline" with the whole afternoon and evening of today empty. Found by the
     * scheduling journey, on an ordinary week.
     */
    if (!placement && work.deadline !== null && work.deadline !== work.latestEnd) {
      placement = findBestPlacement(
        { ...work, latestEnd: work.deadline },
        chunk,
        earliest,
        this.remainingWindows,
        ctx,
      );
      if (placement && placement.tradeoffCode === null) {
        placement.tradeoffCode = "WORK_PUSHED_CLOSER_TO_DEADLINE";
      }
    }
    if (!placement) return null;

    this.sessions.push({
      id: `${this.planVersionId}_s${this.sessionCounter++}`,
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

    consumeWithBreak(this.remainingWindows, placement.start, placement.end, this.input);
    addDaily(this.dailyMinutes, this.calendar, placement.start, placement.end - placement.start);
    work.minutesRemaining -= placement.end - placement.start;
    return placement.end;
  }

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
  private placeOnePerCourse(): void {
    const { orderedPending } = this;
    // A successor placed before its predecessor is scheduled would violate the ordering the
    // greedy pass maintains, and this pass runs before any of that is known.
    const hasPendingPredecessor = new Set(
      this.input.dependencies
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
      const cap = Math.max(this.input.preferences.minSessionMinutes, FIRST_TOUCH_MINUTES);
      const chunk =
        work.item.divisibility === "divisible"
          ? Math.min(work.minutesRemaining, cap)
          : work.minutesRemaining;

      const earliest = Math.max(work.earliestStart, this.now);
      if (this.placeChunk(work, chunk, earliest) === null) continue;
      touched.add(work.item.courseId);
    }
  }

  /** The greedy pass: each item in order takes as much of its allocation as will fit. */
  private placeAll(): void {
    for (const work of this.orderedPending) {
      const dependencyFloor =
        this.earliestStartByItem.get(work.item.id) ?? Number.NEGATIVE_INFINITY;
      const earliest = Math.max(work.earliestStart, dependencyFloor, this.now);
      let lastEnd = earliest;

      while (work.minutesRemaining > 0) {
        const end = this.placeChunk(work, nextChunkMinutes(work, this.input), earliest);
        if (end === null) break;
        lastEnd = Math.max(lastEnd, end);
      }

      // Successors cannot begin until this item's last session ends. When none was placed the
      // floor is this item's own earliest start, deliberately: a successor must not run ahead of
      // a predecessor the week could not hold.
      for (const dep of this.input.dependencies) {
        if (dep.predecessorWorkItemId !== work.item.id) continue;
        if (dep.dependencyType === "same_session") continue;
        const current =
          this.earliestStartByItem.get(dep.successorWorkItemId) ?? Number.NEGATIVE_INFINITY;
        this.earliestStartByItem.set(dep.successorWorkItemId, Math.max(current, lastEnd));
      }
    }
  }

  /**
   * Recomputes free space and daily totals from the blocks currently in the plan.
   *
   * One merge and one subtraction per window, rather than replaying `consume` block by block:
   * this runs twice for every rescue step, and the replay was most of the rescue's cost.
   */
  private rebuildFreeSpace(): void {
    const pause = Math.max(0, this.input.preferences.breakMinutes);
    const taken = mergeIntervals(
      this.sessions.map((session) => ({
        start: toEpochMinutes(session.startAt),
        end: toEpochMinutes(session.endAt) + pause,
      })),
    );
    const free: CapacityWindow[] = [];
    for (const window of this.windows) {
      for (const piece of subtractIntervals(window, taken)) {
        free.push({ ...window, start: piece.start, end: piece.end });
      }
    }
    this.remainingWindows.splice(
      0,
      this.remainingWindows.length,
      ...free.sort((a, b) => a.start - b.start),
    );
    this.dailyMinutes.clear();
    for (const session of this.sessions) {
      addDaily(this.dailyMinutes, this.calendar, toEpochMinutes(session.startAt), session.minutes);
    }
  }

  /**
   * Work that came up short before its deadline may take time from work due later.
   *
   * The greedy pass goes in priority order and prefers the earliest good slot, which is right
   * nearly always and wrong in one shape of week. Found by the scheduling journey on an ordinary
   * one: a reading due at nine on Sunday morning could only be done on Saturday, and by the time
   * its turn came Saturday's daily limit had gone to an essay due Thursday, exam prep due Friday
   * and a quiz due Friday -- all of which had five more days to go. The reading was reported as
   * "no window fits this before its deadline" in a week with twenty free hours.
   *
   * So, for each piece of work still short, blocks of work with a *later* deadline (or none)
   * that sit inside its own window are given up one at a time, latest deadline first, until it
   * fits, the displaced work being placed again after each. A step is kept only if the rescued
   * work gained and the displaced work got all of its time back; otherwise it is undone exactly. Work already overdue is never
   * displaced -- it is more urgent, not less -- nor is a course's last block, and work tied into
   * dependencies is left alone on both sides, because moving it could break the ordering the
   * greedy pass established.
   */
  private rescueDeadlines(): void {
    for (const work of this.orderedPending) this.rescue(work, 2);
  }

  /**
   * Makes room for one piece of work by displacing later-due blocks, one step at a time.
   *
   * `depth` lets the displaced work make room for itself the same way, once more. Found by the
   * evening sweep: on a Sunday night, the reading due Monday could take Peer review's block, but
   * Peer review (due Wednesday) could only go on Tuesday, which was full of an essay due Friday
   * that had all of Thursday free. One level of rescue sees no move that is free; two do. Each
   * level only ever moves work to a strictly later deadline, so the chain cannot loop.
   *
   * How many displacement steps one plan may try is capped by `rescueBudget`. Each step rebuilds
   * the week's free space twice, and the planner runs inside a Worker request with a few
   * milliseconds of CPU: unbounded, a forty-item crunch week took forty-five milliseconds here
   * against under one before rescue existed. Weeks the rescue is for -- room to spare, badly
   * placed -- need a handful of steps; weeks that exhaust the budget are short of time in fact,
   * and say so through their risks.
   */
  private rescue(work: PendingWork, depth: number): void {
    if (work.minutesRemaining <= 0 || work.deadline === null) return;
    if (this.inDependency.has(work.item.id)) return;
    const { sessions, carriedSessions, orderedPending } = this;
    const deadline = work.deadline;
    const earliest = Math.max(work.earliestStart, this.now);

    const victims = sessions
      .filter((session) => !carriedSessions.has(session) && session.workItemId !== work.item.id)
      .filter(
        (session) =>
          toEpochMinutes(session.startAt) < deadline && toEpochMinutes(session.endAt) > earliest,
      )
      .map((session) => ({ session, owner: this.pendingById.get(session.workItemId) }))
      .filter(
        (v): v is { session: PlannedSession; owner: PendingWork } =>
          v.owner !== undefined &&
          !this.inDependency.has(v.owner.item.id) &&
          dueOf(v.owner) > deadline,
      )
      .sort(
        (a, b) =>
          dueOf(b.owner) - dueOf(a.owner) ||
          b.session.startAt.localeCompare(a.session.startAt) ||
          a.session.id.localeCompare(b.session.id),
      );

    for (const { session, owner } of victims) {
      if (work.minutesRemaining <= 0 || this.rescueBudget <= 0) break;
      if (!sessions.includes(session)) continue;
      // A course's last block stays: in a crowded week "every course keeps moving" is the
      // first-touch pass's promise, and rescuing one deadline must not quietly break it.
      const courseBlocks = sessions.filter(
        (other) => other.courseId === session.courseId && !carriedSessions.has(other),
      ).length;
      if (courseBlocks <= 1 && session.courseId !== work.item.courseId) continue;

      // Each step is kept only if it cost nothing: the rescued work gained, and the displaced
      // work got all of its time back somewhere else. The first version kept any gain at all,
      // so a reading that still could not fit took a block from higher-ranked exam prep that
      // then fitted nowhere -- two items short instead of one. Rescue moves work later; it
      // never trades one deadline for another.
      this.rescueBudget -= 1;
      const savedSessions = [...sessions];
      const savedRemaining = new Map(orderedPending.map((w) => [w, w.minutesRemaining]));
      const before = work.minutesRemaining;
      const owed = owner.minutesRemaining;

      sessions.splice(sessions.indexOf(session), 1);
      owner.minutesRemaining += session.minutes;
      this.rebuildFreeSpace();
      while (work.minutesRemaining > 0) {
        if (this.placeChunk(work, nextChunkMinutes(work, this.input), earliest) === null) break;
      }
      if (work.minutesRemaining < before) {
        const ownerEarliest = Math.max(owner.earliestStart, this.now);
        while (owner.minutesRemaining > owed) {
          if (this.placeChunk(owner, nextChunkMinutes(owner, this.input), ownerEarliest) === null) {
            break;
          }
        }
        if (owner.minutesRemaining > owed && depth > 1) this.rescue(owner, depth - 1);
      }

      if (work.minutesRemaining >= before || owner.minutesRemaining > owed) {
        sessions.splice(0, sessions.length, ...savedSessions);
        for (const [w, minutes] of savedRemaining) w.minutesRemaining = minutes;
        this.rebuildFreeSpace();
      }
    }
  }
}

function dueOf(w: PendingWork): number {
  return w.item.dueAt === null ? Number.POSITIVE_INFINITY : toEpochMinutes(w.item.dueAt);
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
  ctx: { input: PlanningInput; dailyMinutes: Map<string, number>; calendar: ZoneCalendar },
): Placement | null {
  const prefs = ctx.input.preferences;
  let best: { placement: Placement; utility: number } | null = null;
  /**
   * The shortest block worth booking -- unless the work, as a whole, is shorter.
   *
   * The minimum session exists so that work is not shredded into slivers, not to refuse work
   * that is small to begin with. Applied as an absolute floor, it made anything under twenty
   * minutes unplaceable: a fifteen-minute discussion post, or the last ten minutes of a reading
   * after a partial session, went out as "no window fits this before its deadline" in an empty
   * week. Whole is not a sliver.
   *
   * Measured against what this plan owes the item in total, not against the chunk in hand. The
   * first version used the chunk, and the leftover of any block cut short by a window or the
   * daily limit then qualified as "small" -- five-minute blocks of a forty-five-minute reading,
   * the exact shredding the minimum is for. Found by sweeping the scheduling journey across
   * every weekday at seven in the evening.
   */
  const floor = Math.min(prefs.minSessionMinutes, work.allocatedMinutes);

  for (const window of windows) {
    const start = Math.max(window.start, earliest);
    const available = window.end - start;
    if (available < floor) continue;

    let minutes = Math.min(chunkMinutes, available, prefs.maxSessionMinutes);
    if (work.item.divisibility !== "divisible" && minutes < chunkMinutes) continue;
    if (minutes < floor) continue;

    const end = start + minutes;
    if (work.latestEnd !== null && end > work.latestEnd) continue;

    // Daily ceiling is a hard constraint: we shorten to fit, or skip the day entirely.
    // The daily limit is per day of the student's life, not per UTC date.
    const date = ctx.calendar.dateOf(start);
    const usedToday = ctx.dailyMinutes.get(date) ?? 0;
    const roomToday = prefs.maxDailyAcademicMinutes - usedToday;
    if (roomToday < floor) continue;

    let tradeoffCode: PlannedSession["tradeoffCode"] = null;
    if (minutes > roomToday) {
      minutes = roomToday;
      tradeoffCode = "DAILY_LIMIT_REACHED";
    }
    // A block cut short must not leave a remainder too small to book: forty minutes of window for
    // forty-five minutes of reading books twenty-five and leaves twenty, rather than forty and a
    // five that no window will ever take. Not for work tied to one place, whose remainder would
    // only be booked in the wrong one: there the longer block in the right room is worth more.
    const rest = work.minutesRemaining - minutes;
    if (rest > 0 && rest < floor && work.item.locationRequirement === "anywhere") {
      minutes = work.minutesRemaining - floor;
      if (minutes < floor) continue;
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
 * What to say about work that got no time this week.
 *
 * There are two entirely different reasons for that and they used to be told as one. The risk
 * carried the qualifier — "no window *in this horizon*" — and the sentence the student actually
 * reads (`explainRisk`) dropped it: "No available window fits this before it is due."
 *
 * Measured on the first Monday of a real ingested term: 42 of 61 items raised that risk, at
 * `at_risk`, and **every one of them was due beyond the end of the horizon**. Zero were due
 * inside it. The app was telling a student who is anxious and time-blind by definition that two
 * thirds of their semester could not be fitted before its deadlines, on day one, when the true
 * state was "not this week, and there is plenty of time".
 *
 * For this audience that is worse than saying nothing. An alarm that is wrong two thirds of the
 * time trains the reader to ignore the third that is real.
 */
function unscheduledRisk(
  work: PendingWork,
  placedAny: boolean,
  horizonEndMinutes: number,
  calendar: ZoneCalendar,
): PlanRisk {
  if (!placedAny) {
    /**
     * Work with no due date cannot be at risk of missing one.
     *
     * Found by walking a real term: Richland's MATH 104 states fifty-eight pieces of graded
     * work and not one date for any of them, and every one that lost the week came back as
     * `at_risk` — "No available window fits this before it is due" — about a deadline that does
     * not exist. Forty-nine of them, in week one.
     *
     * The honest reading is that it lost the week to work that *does* have a deadline, which is
     * the scheduler behaving correctly. `DUE_DATE_UNKNOWN` is already raised separately, so the
     * missing date is not going unsaid; what would be wrong is calling it danger.
     */
    if (work.item.dueAt === null) {
      return {
        level: "watch",
        code: "INSUFFICIENT_CAPACITY",
        workItemId: work.item.id,
        detail: `"${work.item.title}" has no deadline and got no time this week; dated work came first.`,
      };
    }

    const dueMinutes = toEpochMinutes(work.item.dueAt);
    if (dueMinutes > horizonEndMinutes) {
      // Deliberately deferred: `horizonAllocation` has not opened its runway yet. Still recorded
      // rather than dropped, so the item stays accounted for instead of vanishing from view —
      // "seen and accounted for" is the standing goal, and silence is not accounting.
      return {
        level: "safe",
        code: "WAITING_ITS_TURN",
        workItemId: work.item.id,
        detail: `"${work.item.title}" is not due until ${calendar.dateOf(dueMinutes)}, so nothing is booked for it this week.`,
      };
    }
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

function addDaily(
  dailyMinutes: Map<string, number>,
  calendar: ZoneCalendar,
  start: number,
  minutes: number,
): void {
  const date = calendar.dateOf(start);
  dailyMinutes.set(date, (dailyMinutes.get(date) ?? 0) + minutes);
}
