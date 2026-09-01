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
 * ## Deadlines are drawn, not only the hours spent on them
 *
 * A block is time; a deadline is a fact about a day, and until now only the first was here.
 * That is how work ends up on the assignments board and nowhere on the calendar: the planner
 * books Monday for a paper due Thursday, so Monday carries a green band and Thursday --- the
 * day the thing is actually owed --- draws exactly nothing. Worse for anything the week could
 * not fit at all, which then appears on no day of the calendar whatsoever while sitting in
 * plain sight one tab away.
 *
 * So every open piece of work with a due date inside the seven days is returned on its day,
 * whether or not a single minute was booked for it, carrying whether a clock time was ever
 * stated and whether anything is booked for it this week. `day.due` is a complete list, which
 * is the property that lets a view promise the board and the calendar hold the same work.
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

/**
 * One deadline landing on one day.
 *
 * Not a slot, and deliberately not one: a deadline occupies no minutes, so folding it into the
 * band partition would either invent time the student does not owe or lose the fact entirely
 * behind whatever claims that minute. It rides alongside the slots instead, so the day can say
 * "three hours of History, and the response paper is due at nine" without the two contradicting
 * each other.
 */
export interface CalendarDeadline {
  workItemId: string;
  courseId: string;
  title: string;
  workType: string;
  /** Epoch minutes of the deadline itself. */
  at: number;
  /** Where it falls in the day, 0..1439. */
  minuteOfDay: number;
  /**
   * False when the stored instant carries the end-of-day default, which is what "due Friday"
   * has always meant here and what extraction writes when a syllabus states no clock time.
   *
   * A view must not print "23:59" for one of these. It is not a deadline anybody stated; it is
   * the absence of one, and showing it as a time invites a student to work until 23:30 on a
   * paper the instructor collects in a 9am lecture.
   */
  timeStated: boolean;
  /**
   * True when not one minute is booked toward this item anywhere in the drawn week.
   *
   * The number the calendar exists to expose. Work with a deadline on Thursday and no block
   * behind it is the case that used to render as an empty Thursday.
   */
  nothingBooked: boolean;
}

export interface CalendarDay {
  date: string;
  dayOfWeek: number;
  slots: CalendarSlot[];
  /**
   * Everything due this day, booked or not, earliest first. Complete by construction: this is
   * what lets a view state that the calendar holds every dated row the assignments board does.
   */
  due: CalendarDeadline[];
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

/** The minimum a piece of work must expose for its deadline to be drawn. */
export interface DeadlineInput {
  workItemId: string;
  courseId: string;
  title: string;
  workType: string;
  /** The stored instant. Items with no due date are simply not passed. */
  dueAt: string;
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
  /**
   * Open work carrying a due date. Omitted, the calendar draws hours only, exactly as before.
   *
   * Deliberately every open item rather than only the ones the planner touched: the whole point
   * is the row the plan has nothing to say about.
   */
  deadlines?: readonly DeadlineInput[];
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

/**
 * What "due Friday" resolves to when nobody stated a time -- the same default the deadline
 * editor writes, kept here as the one value that decides whether a clock time is real.
 */
const END_OF_DAY_MINUTE = 23 * HOUR + 59;

export function buildWeekCalendar(input: WeekCalendarInput): WeekCalendar {
  const horizonStart = dateToEpochMinutes(input.horizonStart);
  const days: CalendarDay[] = [];
  const due = deadlinesByDay(input.deadlines ?? [], {
    horizonStart: input.horizonStart,
    horizonDays: input.horizonDays,
    sessions: input.sessions,
  });

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
      due: due.get(date) ?? [],
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

/**
 * Every deadline in the drawn week, keyed by the day it falls on.
 *
 * Exported because two views need the same answer. The hour grid draws them as marks against
 * the clock; the week map lists them under the day. Deriving that twice is how the two screens
 * end up disagreeing about whether a quiz is on Wednesday, and this codebase has already paid
 * for one colour map kept in seven copies.
 *
 * ## The day comes from the characters, never from the epoch
 *
 * `dueAt.slice(0, 10)` is the day, and `dueAt.slice(11, 16)` is the clock, exactly as the
 * assignments board reads them. Re-deriving either through a `Date` renders in the reader's
 * zone: a deadline stored at 23:59 shows as the *next* day in Tokyo and one stored at 01:00 as
 * the previous day in Los Angeles, while the board -- formatting from the same ten characters
 * this does -- goes on showing the day the student typed. One assignment, two dates, two
 * screens of one app. `packages/domain/src/time.ts` states the convention; this obeys it.
 */
export function deadlinesByDay(
  deadlines: readonly DeadlineInput[],
  window: {
    horizonStart: string;
    horizonDays: number;
    /** This week's blocks, so a deadline can say whether anything is booked behind it. */
    sessions: readonly { workItemId: string; startAt: string; endAt: string }[];
  },
): Map<string, CalendarDeadline[]> {
  const horizonStart = dateToEpochMinutes(window.horizonStart);
  const horizonEnd = horizonStart + window.horizonDays * MINUTES_PER_DAY;

  // Booked *in the drawn week*. A block last month is history, not preparation the student can
  // see on this screen, and counting it would mark a bare Thursday as covered.
  const booked = new Set<string>();
  for (const session of window.sessions) {
    if (toEpochMinutes(session.endAt) <= horizonStart) continue;
    if (toEpochMinutes(session.startAt) >= horizonEnd) continue;
    booked.add(session.workItemId);
  }

  const dates = new Set<string>();
  for (let day = 0; day < window.horizonDays; day++) {
    dates.add(epochMinutesToDate(horizonStart + day * MINUTES_PER_DAY));
  }

  const byDay = new Map<string, CalendarDeadline[]>();
  for (const item of deadlines) {
    const date = item.dueAt.slice(0, 10);
    if (!dates.has(date)) continue;

    const clock = item.dueAt.slice(11, 16);
    const timeStated = /^([01]\d|2[0-3]):[0-5]\d$/.test(clock)
      ? parseTimeOfDay(clock) !== END_OF_DAY_MINUTE
      : false;
    const minuteOfDay = timeStated ? parseTimeOfDay(clock) : END_OF_DAY_MINUTE;

    const list = byDay.get(date) ?? [];
    list.push({
      workItemId: item.workItemId,
      courseId: item.courseId,
      title: item.title,
      workType: item.workType,
      at: dateToEpochMinutes(date) + minuteOfDay,
      minuteOfDay,
      timeStated,
      nothingBooked: !booked.has(item.workItemId),
    });
    byDay.set(date, list);
  }

  // Earliest first, and stable on the title where two things are due at the same minute --
  // which is the norm, since most of a term is due at the end of its day.
  for (const list of byDay.values()) {
    list.sort((a, b) => a.minuteOfDay - b.minuteOfDay || a.title.localeCompare(b.title));
  }
  return byDay;
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
