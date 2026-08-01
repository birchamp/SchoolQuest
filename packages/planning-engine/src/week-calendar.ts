import {
  dateToEpochMinutes,
  dayOfWeekFor,
  durationMinutes,
  epochMinutesToDate,
  MINUTES_PER_DAY,
  mergeIntervals,
  parseTimeOfDay,
  subtractIntervals,
  toEpochMinutes,
  type Commitment,
  type Interval,
  type MeetingPattern,
} from "@schoolquest/domain";
import type { MealBreak } from "./meals.js";

/**
 * The week as hours, with every one of them accounted for.
 *
 * The week map answers "what am I working on"; this answers "where does my time actually
 * go", and they are not the same question. A calendar that draws only the blocks the planner
 * booked leaves five-sixths of the week blank, and blank reads as free — which is exactly the
 * misreading that produces a student agreeing to a Thursday shift they do not have room for.
 *
 * So this builds a complete partition of each day: nothing is omitted, and free time is a
 * band in its own right rather than the absence of one. That completeness is the feature.
 * Time blindness is a documented deficit of the students this is for, and the fix is not a
 * prettier agenda — it is being able to see, without counting, that Tuesday has ninety
 * minutes in it and Sunday has seven hours.
 *
 * Pure and deterministic, like the rest of the engine. Overlaps are resolved by a fixed
 * precedence rather than by draw order, so two things claiming 14:00 always produce the same
 * answer and the answer is the one that is actually true of the student's body: a class they
 * are sitting in beats a study block the planner hoped for.
 */

export type SlotKind =
  /** A class meeting. */
  | "class"
  /** A commitment the student entered: work, club, appointment, travel. */
  | "commitment"
  /** Time held for a meal, theirs or the engine's. */
  | "meal"
  /** A study block from the plan. */
  | "study"
  /** Available and unbooked — real room, and the point of showing it. */
  | "free"
  /** Outside the hours the student said they are around. */
  | "off";

export interface CalendarSlot {
  kind: SlotKind;
  /** Epoch minutes. */
  start: number;
  end: number;
  minutes: number;
  /** What to print. Null for `free` and `off`, which name themselves. */
  title: string | null;
  /** Set for `class` and `study`, so the slot can carry the course's colour. */
  courseId: string | null;
  /** Set for `study`, so a block links back to the work it is for. */
  workItemId: string | null;
  /** Set for `commitment`, e.g. "work" or "club". */
  commitmentType: string | null;
}

export interface CalendarDay {
  date: string;
  dayOfWeek: number;
  slots: CalendarSlot[];
  /** Totals for the day, in minutes. Every kind, so the row always adds up. */
  totals: Record<SlotKind, number>;
  /** Earliest and latest minute-of-day the day has anything in it. */
  firstMinute: number | null;
  lastMinute: number | null;
}

export interface WeekCalendar {
  days: CalendarDay[];
  totals: Record<SlotKind, number>;
  /** The window worth drawing: the earliest start and latest end across the week. */
  windowStartMinute: number;
  windowEndMinute: number;
}

export interface WeekCalendarInput {
  horizonStart: string;
  horizonDays: number;
  meetingPatterns: readonly MeetingPattern[];
  commitments: readonly Commitment[];
  availability: readonly { dayOfWeek: number; startTime: string; endTime: string }[];
  sessions: readonly {
    workItemId: string;
    courseId: string;
    startAt: string;
    endAt: string;
    title?: string;
  }[];
  meals: readonly MealBreak[];
}

/**
 * Precedence when two things claim the same minute.
 *
 * Highest wins. This is the order in which the student's body is actually committed: they
 * cannot study through a lecture, and a meal the engine held is still time it deliberately
 * kept out of the plan. Resolving by precedence rather than by draw order is what stops the
 * same week rendering differently depending on which query returned first.
 */
const PRECEDENCE: Record<SlotKind, number> = {
  class: 5,
  commitment: 4,
  meal: 3,
  study: 2,
  free: 1,
  off: 0,
};

/** Rounds the drawn window out to whole hours so the grid has honest gridlines. */
const HOUR = 60;

export function buildWeekCalendar(input: WeekCalendarInput): WeekCalendar {
  const horizonStart = dateToEpochMinutes(input.horizonStart);
  const days: CalendarDay[] = [];

  for (let day = 0; day < input.horizonDays; day++) {
    const dayStart = horizonStart + day * MINUTES_PER_DAY;
    const dayEnd = dayStart + MINUTES_PER_DAY;
    const dow = dayOfWeekFor(dayStart);
    const date = epochMinutesToDate(dayStart);

    const claims: CalendarSlot[] = [
      ...classSlots(input.meetingPatterns, dayStart, dow, date),
      ...commitmentSlots(input.commitments, dayStart, dow, date),
      ...mealSlots(input.meals, date),
      ...studySlots(input.sessions, dayStart, dayEnd),
    ];

    // Available time the day declares, so "free" can be told apart from "off".
    const available = mergeIntervals(
      input.availability
        .filter((rule) => rule.dayOfWeek === dow)
        .map((rule) => ({
          start: dayStart + parseTimeOfDay(rule.startTime),
          end: dayStart + parseTimeOfDay(rule.endTime),
        }))
        .filter((i) => i.end > i.start),
    );

    const resolved = resolveOverlaps(claims);
    const claimed = mergeIntervals(resolved.map((s) => ({ start: s.start, end: s.end })));

    // Whatever the day's declared hours still hold after everything else is subtracted.
    const free: CalendarSlot[] = [];
    for (const window of available) {
      for (const gap of subtractIntervals(window, [...claimed])) {
        if (durationMinutes(gap) <= 0) continue;
        free.push(blank("free", gap));
      }
    }

    const slots = [...resolved, ...free].sort((a, b) => a.start - b.start || a.end - b.end);
    days.push({
      date,
      dayOfWeek: dow,
      slots,
      totals: totalsOf(slots),
      firstMinute: slots.length > 0 ? slots[0]!.start - dayStart : null,
      lastMinute: slots.length > 0 ? Math.max(...slots.map((s) => s.end)) - dayStart : null,
    });
  }

  // One shared window across the week, so every column's 09:00 is at the same height.
  const starts = days.map((d) => d.firstMinute).filter((m): m is number => m !== null);
  const ends = days.map((d) => d.lastMinute).filter((m): m is number => m !== null);
  const windowStartMinute = starts.length > 0 ? Math.floor(Math.min(...starts) / HOUR) * HOUR : 8 * HOUR;
  const windowEndMinute = ends.length > 0 ? Math.ceil(Math.max(...ends) / HOUR) * HOUR : 22 * HOUR;

  const totals = totalsOf(days.flatMap((d) => d.slots));
  return {
    days,
    totals,
    windowStartMinute,
    // A window with no height would divide by zero downstream; an empty week still draws.
    windowEndMinute: Math.max(windowEndMinute, windowStartMinute + HOUR),
  };
}

function classSlots(
  patterns: readonly MeetingPattern[],
  dayStart: number,
  dow: number,
  date: string,
): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  for (const pattern of patterns) {
    if (!pattern.daysOfWeek.includes(dow)) continue;
    // A pattern that has not started, or has finished, is not on this day's calendar.
    if (pattern.effectiveStart && date < pattern.effectiveStart) continue;
    if (pattern.effectiveEnd && date > pattern.effectiveEnd) continue;
    const start = dayStart + parseTimeOfDay(pattern.startTime);
    const end = dayStart + parseTimeOfDay(pattern.endTime);
    if (end <= start) continue;
    slots.push({
      kind: "class",
      start,
      end,
      minutes: end - start,
      title: pattern.location ?? "Class",
      courseId: pattern.courseId,
      workItemId: null,
      commitmentType: null,
    });
  }
  return slots;
}

function commitmentSlots(
  commitments: readonly Commitment[],
  dayStart: number,
  dow: number,
  date: string,
): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  for (const commitment of commitments) {
    if (commitment.specificDate) {
      if (commitment.specificDate !== date) continue;
    } else if (!commitment.daysOfWeek.includes(dow)) {
      continue;
    }
    // Optional commitments are not subtracted from capacity, so drawing them as solid
    // would contradict the plan sitting underneath them.
    if (commitment.flexibility === "optional") continue;
    const start = dayStart + parseTimeOfDay(commitment.startTime);
    const end = dayStart + parseTimeOfDay(commitment.endTime);
    if (end <= start) continue;
    slots.push({
      kind: commitment.commitmentType === "meal" ? "meal" : "commitment",
      start,
      end,
      minutes: end - start,
      title: commitment.title,
      courseId: null,
      workItemId: null,
      commitmentType: commitment.commitmentType,
    });
  }
  return slots;
}

/** Only time the engine actually held; the student's own meals arrive as commitments. */
function mealSlots(meals: readonly MealBreak[], date: string): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  for (const meal of meals) {
    if (meal.date !== date) continue;
    if (meal.start === null || meal.end === null) continue;
    if (meal.status !== "reserved" && meal.status !== "squeezed") continue;
    slots.push({
      kind: "meal",
      start: meal.start,
      end: meal.end,
      minutes: meal.minutes,
      title: meal.label,
      courseId: null,
      workItemId: null,
      commitmentType: "meal",
    });
  }
  return slots;
}

function studySlots(
  sessions: WeekCalendarInput["sessions"],
  dayStart: number,
  dayEnd: number,
): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  for (const session of sessions) {
    const start = toEpochMinutes(session.startAt);
    const end = toEpochMinutes(session.endAt);
    if (end <= dayStart || start >= dayEnd) continue;
    slots.push({
      kind: "study",
      start: Math.max(start, dayStart),
      end: Math.min(end, dayEnd),
      minutes: Math.min(end, dayEnd) - Math.max(start, dayStart),
      title: session.title ?? "Study",
      courseId: session.courseId,
      workItemId: session.workItemId,
      commitmentType: null,
    });
  }
  return slots;
}

/**
 * Cuts overlapping claims down to a non-overlapping set, highest precedence winning.
 *
 * Done by sweeping the boundaries rather than by subtracting pairwise: with four sources
 * feeding the same day, pairwise subtraction depends on the order the pairs are visited and
 * quietly produces a different calendar for the same week.
 */
function resolveOverlaps(claims: readonly CalendarSlot[]): CalendarSlot[] {
  if (claims.length === 0) return [];

  const edges = new Set<number>();
  for (const claim of claims) {
    edges.add(claim.start);
    edges.add(claim.end);
  }
  const points = [...edges].sort((a, b) => a - b);

  const pieces: CalendarSlot[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;

    let winner: CalendarSlot | null = null;
    for (const claim of claims) {
      if (claim.start > start || claim.end < end) continue;
      if (!winner || PRECEDENCE[claim.kind] > PRECEDENCE[winner.kind]) winner = claim;
    }
    if (!winner) continue;
    pieces.push({ ...winner, start, end, minutes: end - start });
  }

  // Rejoin neighbouring pieces that came from the same claim, so a class interrupted by a
  // boundary that turned out not to matter is not drawn as two adjacent boxes.
  const merged: CalendarSlot[] = [];
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.end === piece.start &&
      previous.kind === piece.kind &&
      previous.title === piece.title &&
      previous.workItemId === piece.workItemId &&
      previous.courseId === piece.courseId
    ) {
      previous.end = piece.end;
      previous.minutes = previous.end - previous.start;
      continue;
    }
    merged.push({ ...piece });
  }
  return merged;
}

function blank(kind: SlotKind, interval: Interval): CalendarSlot {
  return {
    kind,
    start: interval.start,
    end: interval.end,
    minutes: durationMinutes(interval),
    title: null,
    courseId: null,
    workItemId: null,
    commitmentType: null,
  };
}

function totalsOf(slots: readonly CalendarSlot[]): Record<SlotKind, number> {
  const totals: Record<SlotKind, number> = {
    class: 0,
    commitment: 0,
    meal: 0,
    study: 0,
    free: 0,
    off: 0,
  };
  for (const slot of slots) totals[slot.kind] += slot.minutes;
  return totals;
}
