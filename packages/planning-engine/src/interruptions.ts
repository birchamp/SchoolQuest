import {
  dateToEpochMinutes,
  dayOfWeekFor,
  formatTimeOfDay,
  MINUTES_PER_DAY,
  parseTimeOfDay,
  toEpochMinutes,
  type CommitmentType,
} from "@schoolquest/domain";

/**
 * What actually happened to the time, and whether the plan should change to admit it.
 *
 * A plan that keeps booking Thursday at 17:00 for a student who has a standing thing every
 * Thursday at 17:00 is not a plan with a bad week in it — it is a plan built on a false map.
 * Left alone it fails the same way every week, and each failure looks to the student like
 * something they did, which is precisely the reading this product exists to prevent.
 *
 * So the engine reads the weeks that have already happened and asks about the pattern, not
 * about the person. Two rules keep that on the right side of the line:
 *
 *  - Nothing here counts, scores, or remembers failures. There is no streak to break and
 *    nothing to lose (docs/01-product-brief.md §3). A slot that keeps not working is
 *    evidence about the calendar, and the only question ever asked is what is really there.
 *  - Repetition, not volume, is what earns a question. One bad Thursday is a bad Thursday.
 *    The same Thursday three weeks running is a standing commitment nobody wrote down.
 */

/** A block that was planned and did not happen, however that came to light. */
export interface LostBlock {
  sessionId: string;
  workItemId: string;
  /** Scheduled start as an ISO instant. */
  startAt: string;
  endAt: string;
  /**
   * "reported" — the student told us it did not happen (skipped, or an outcome of
   * did_not_start). "silent" — its time simply passed while it still said planned.
   */
  source: "reported" | "silent";
}

/** Something the student named as having taken the time instead. */
export interface ReportedInterruption {
  id: string;
  /** Free text from the student: "shift got moved", "youth group". */
  title: string;
  kind: CommitmentType | null;
  /** The block it displaced, when it was recorded against one. */
  sessionId: string | null;
  startAt: string;
  endAt: string;
  /** The student's own answer to "does this happen every week?", if they gave one. */
  recurring: boolean | null;
}

/**
 * A previous answer about one slot, so the same question is not asked twice.
 *
 * `occurrences` records how many times the slot had come up when the answer was given. A
 * slot dismissed as a one-off that then happens twice more is worth raising again — the
 * student's answer was about the week they had, not a promise about the term.
 */
export interface SlotResolution {
  slotKey: string;
  resolution: "one_off" | "promoted" | "dismissed";
  occurrences: number;
}

export interface ReviewOccurrence {
  date: string;
  minutes: number;
  sessionIds: string[];
  /** What the student said took the time, when they said anything. */
  cause: string | null;
}

export interface ReviewQuestion {
  /** Stable across weeks: weekday plus the slot's start, e.g. "4:17:00". */
  slotKey: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  /** Distinct calendar weeks in which this slot lost time. */
  weeks: number;
  minutesLost: number;
  occurrences: ReviewOccurrence[];
  /**
   * The standing commitment this pattern suggests, ready to be accepted as-is. Null until
   * the slot has repeated enough to be worth proposing.
   */
  proposal: CommitmentProposal | null;
}

export interface CommitmentProposal {
  title: string;
  commitmentType: CommitmentType;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  /** True when the student named the thing; false when we only know the time is not free. */
  named: boolean;
}

export interface WeeklyReviewInput {
  lost: LostBlock[];
  reported: ReportedInterruption[];
  resolutions: SlotResolution[];
  /** ISO instant. Only blocks on days that are fully behind us are reviewed. */
  now: string;
  /** How far back to look. A term's worth of history makes for an interrogation. */
  lookbackDays?: number;
}

export interface WeeklyReview {
  questions: ReviewQuestion[];
  /** Total minutes the plan booked in the lookback that the week did not honour. */
  minutesLost: number;
  /** Blocks whose time passed with nothing recorded either way. */
  unanswered: number;
}

/** Three weeks of history: long enough for a pattern, short enough to still be true. */
const DEFAULT_LOOKBACK_DAYS = 21;

/** Seen in this many distinct weeks before it is worth proposing as a standing commitment. */
const RECURRENCE_THRESHOLD = 2;

/** Never ask about more than this at once. A review is a conversation, not an audit. */
const MAX_QUESTIONS = 3;

/**
 * How far apart two blocks lost on the *same* day can be and still be one obstacle. Wide
 * enough to bridge the break between consecutive blocks, narrow enough that an afternoon
 * interrupted at both ends does not swallow the hour in the middle that went fine.
 */
const CONTIGUOUS_GAP_MINUTES = 30;

/**
 * How far apart the same obstacle may drift from week to week. A block at 17:00 one week and
 * 17:20 the next is the same evening being lost, not two different ones.
 */
const ALIGNMENT_TOLERANCE_MINUTES = 90;

export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  /**
   * Today is off limits, however far through it we are.
   *
   * The obvious cutoff is "anything whose time has passed", and it nags: a student opening
   * the app at three in the afternoon, having not yet ticked off a block from nine that
   * morning, was asked what had taken the time — when the honest answer is that the day is
   * not over and they may well still do it. The card calls itself a look at recent weeks and
   * should mean it. A block only becomes evidence once its day is behind us.
   */
  const todayStart = dateToEpochMinutes(input.now.slice(0, 10));
  const since = todayStart - (input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * MINUTES_PER_DAY;

  const causeBySession = new Map<string, ReportedInterruption>();
  for (const report of input.reported) {
    if (report.sessionId) causeBySession.set(report.sessionId, report);
  }

  // Interruptions the student reported without a block attached still describe real time
  // that was taken, and they are the best-labelled evidence there is.
  const entries: SlotEntry[] = [];
  for (const block of input.lost) {
    const end = toEpochMinutes(block.endAt);
    if (end > todayStart || end < since) continue;
    entries.push({
      start: toEpochMinutes(block.startAt),
      end,
      sessionId: block.sessionId,
      cause: causeBySession.get(block.sessionId)?.title ?? null,
    });
  }
  for (const report of input.reported) {
    if (report.sessionId) continue; // Already carried by the block it displaced.
    const end = toEpochMinutes(report.endAt);
    if (end > todayStart || end < since) continue;
    entries.push({
      start: toEpochMinutes(report.startAt),
      end,
      sessionId: null,
      cause: report.title,
    });
  }

  const groups = groupIntoSlots(entries);
  const resolutionsByKey = new Map(input.resolutions.map((r) => [r.slotKey, r]));

  const questions: ReviewQuestion[] = [];
  for (const group of groups) {
    const question = toQuestion(group, input.reported);
    const previous = resolutionsByKey.get(question.slotKey);
    // A slot already turned into a commitment is answered for good. Anything else is only
    // settled until the pattern grows past what the student was answering about.
    if (previous?.resolution === "promoted") continue;
    if (previous && question.occurrences.length <= previous.occurrences) continue;
    questions.push(question);
  }

  questions.sort(
    (a, b) => b.weeks - a.weeks || b.minutesLost - a.minutesLost || a.slotKey.localeCompare(b.slotKey),
  );

  return {
    questions: questions.slice(0, MAX_QUESTIONS),
    minutesLost: entries.reduce((sum, e) => sum + Math.max(0, e.end - e.start), 0),
    unanswered: input.lost.filter((b) => {
      const end = toEpochMinutes(b.endAt);
      return b.source === "silent" && end <= todayStart && end >= since;
    }).length,
  };
}

interface SlotEntry {
  start: number;
  end: number;
  sessionId: string | null;
  cause: string | null;
}

interface SlotGroup {
  dayOfWeek: number;
  /** Minutes since midnight, widened to cover everything in the group. */
  startMinute: number;
  endMinute: number;
  entries: SlotEntry[];
}

/**
 * Buckets lost time by weekday and hour, in two passes with two different tolerances.
 *
 * Doing it in one pass with one tolerance was wrong in a way that only shows up on real
 * history: with blocks scheduled every forty-five minutes and a ninety-minute bridge, each
 * block reaches the next and the chain runs away, so a Wednesday afternoon with two separate
 * interruptions came out as a single obstacle from 13:00 to 17:30 — and would then have been
 * proposed as a four-and-a-half-hour standing commitment.
 *
 * Within a day, blocks join only if they are genuinely contiguous. Across weeks, runs join on
 * the looser tolerance, because the same obligation does drift by half an hour.
 */
function groupIntoSlots(entries: SlotEntry[]): SlotGroup[] {
  const byDay = new Map<number, SlotEntry[]>();
  for (const entry of entries) {
    const dow = dayOfWeekFor(entry.start);
    const list = byDay.get(dow);
    if (list) list.push(entry);
    else byDay.set(dow, [entry]);
  }

  const groups: SlotGroup[] = [];
  for (const [dayOfWeek, dayEntries] of [...byDay].sort((a, b) => a[0] - b[0])) {
    for (const run of contiguousRuns(dayEntries)) {
      const open = groups.find(
        (g) =>
          g.dayOfWeek === dayOfWeek &&
          run.startMinute <= g.endMinute + ALIGNMENT_TOLERANCE_MINUTES &&
          g.startMinute <= run.endMinute + ALIGNMENT_TOLERANCE_MINUTES,
      );
      if (open) {
        open.startMinute = Math.min(open.startMinute, run.startMinute);
        open.endMinute = Math.max(open.endMinute, run.endMinute);
        open.entries.push(...run.entries);
      } else {
        groups.push({ dayOfWeek, ...run });
      }
    }
  }
  return groups;
}

/** Unbroken stretches of lost time, computed per calendar date. */
function contiguousRuns(
  entries: SlotEntry[],
): { startMinute: number; endMinute: number; entries: SlotEntry[] }[] {
  const byDate = new Map<string, SlotEntry[]>();
  for (const entry of entries) {
    const date = new Date(entry.start * 60_000).toISOString().slice(0, 10);
    const list = byDate.get(date);
    if (list) list.push(entry);
    else byDate.set(date, [entry]);
  }

  const runs: { startMinute: number; endMinute: number; entries: SlotEntry[] }[] = [];
  for (const [, dateEntries] of [...byDate].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...dateEntries].sort((a, b) => a.start - b.start);
    for (const entry of sorted) {
      const start = minuteOfDay(entry.start);
      const end = start + Math.max(0, entry.end - entry.start);
      const open = runs[runs.length - 1];
      const sameRun =
        open !== undefined &&
        open.entries[0] !== undefined &&
        sameDate(open.entries[0]!, entry) &&
        start <= open.endMinute + CONTIGUOUS_GAP_MINUTES;
      if (sameRun) {
        open.endMinute = Math.max(open.endMinute, end);
        open.entries.push(entry);
      } else {
        runs.push({ startMinute: start, endMinute: end, entries: [entry] });
      }
    }
  }
  return runs;
}

function sameDate(a: SlotEntry, b: SlotEntry): boolean {
  return (
    new Date(a.start * 60_000).toISOString().slice(0, 10) ===
    new Date(b.start * 60_000).toISOString().slice(0, 10)
  );
}

function toQuestion(group: SlotGroup, reported: ReportedInterruption[]): ReviewQuestion {
  const byDate = new Map<string, ReviewOccurrence>();
  for (const entry of group.entries) {
    const date = new Date(entry.start * 60_000).toISOString().slice(0, 10);
    const existing = byDate.get(date);
    const minutes = Math.max(0, entry.end - entry.start);
    if (existing) {
      existing.minutes += minutes;
      if (entry.sessionId) existing.sessionIds.push(entry.sessionId);
      existing.cause ??= entry.cause;
    } else {
      byDate.set(date, {
        date,
        minutes,
        sessionIds: entry.sessionId ? [entry.sessionId] : [],
        cause: entry.cause,
      });
    }
  }

  const occurrences = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const startTime = formatTimeOfDay(group.startMinute);
  const endTime = formatTimeOfDay(group.endMinute);
  const slotKey = `${group.dayOfWeek}:${startTime}`;
  const weeks = new Set(occurrences.map((o) => isoWeekKey(o.date))).size;

  return {
    slotKey,
    dayOfWeek: group.dayOfWeek,
    startTime,
    endTime,
    weeks,
    minutesLost: occurrences.reduce((sum, o) => sum + o.minutes, 0),
    occurrences,
    proposal:
      weeks >= RECURRENCE_THRESHOLD
        ? buildProposal(group, occurrences, startTime, endTime, reported)
        : null,
  };
}

/**
 * Turns a repeated slot into a commitment the student can accept in one move.
 *
 * When they named the thing, the proposal uses their words and their category. When they
 * never said, it is still proposed — as time that is plainly not free — but the title says
 * so plainly rather than inventing an activity, and the student renames it.
 */
function buildProposal(
  group: SlotGroup,
  occurrences: ReviewOccurrence[],
  startTime: string,
  endTime: string,
  reported: ReportedInterruption[],
): CommitmentProposal {
  const named = occurrences.map((o) => o.cause).filter((c): c is string => Boolean(c));
  const counts = new Map<string, number>();
  for (const cause of named) counts.set(cause, (counts.get(cause) ?? 0) + 1);
  const commonest = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];

  const kinds = new Map<CommitmentType, number>();
  for (const report of reported) {
    if (!report.kind || report.title !== commonest) continue;
    kinds.set(report.kind, (kinds.get(report.kind) ?? 0) + 1);
  }
  const kind = [...kinds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";

  return {
    title: commonest ?? "Time that is not free",
    commitmentType: commonest ? kind : "other",
    daysOfWeek: [group.dayOfWeek],
    startTime,
    endTime,
    named: Boolean(commonest),
  };
}

function minuteOfDay(epochMinutes: number): number {
  const wrapped = ((epochMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return wrapped;
}

/**
 * Year plus ISO week number, so "the same slot in three different weeks" counts weeks and
 * not blocks. Two blocks lost on one Thursday are one Thursday.
 */
function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  // Shift to the Thursday of this week; ISO weeks are numbered by the year that Thursday
  // falls in, which is what makes the turn of the year come out right.
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Exported for the API, which stores the same key against the student's answer. */
export function slotKeyFor(dayOfWeek: number, startTime: string): string {
  return `${dayOfWeek}:${formatTimeOfDay(parseTimeOfDay(startTime))}`;
}

export { RECURRENCE_THRESHOLD, DEFAULT_LOOKBACK_DAYS };
