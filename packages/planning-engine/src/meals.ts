import {
  dateToEpochMinutes,
  dayOfWeekFor,
  durationMinutes,
  epochMinutesToDate,
  formatTimeOfDay,
  MINUTES_PER_DAY,
  mergeIntervals,
  parseTimeOfDay,
  subtractIntervals,
  toEpochMinutes,
  type Interval,
  type MealWindow,
} from "@schoolquest/domain";
import type { PlanningInput } from "./types.js";

/**
 * Meals, anticipated rather than assumed away.
 *
 * A meal was only ever honoured if the student had typed it in as a commitment. The seeded
 * semester happens to have Lunch and Dinner, so every screenshot looked fine — but a real
 * student who never entered them got study blocks planned straight through 12:00 and 18:00,
 * every day, and the plan quietly became one nobody could follow. A schedule that ignores
 * eating is not an ambitious schedule; it is a wrong one, and being wrong in a way the
 * student can feel is how a planner loses their trust for good.
 *
 * So the engine holds customary meal time open by default. Three rules keep that from
 * becoming presumptuous:
 *
 *  - The student's own commitments always win. If a meal commitment already overlaps the
 *    window, nothing is reserved — theirs is the answer.
 *  - Every reservation is reported, not silent, so the interface can say which minutes were
 *    held and why, and the student can move or drop them.
 *  - A window with no free time in it is never forced. The day is reported as having no gap,
 *    which is information the student can act on, instead of a block invented on top of class.
 */

export type MealStatus =
  /** A commitment of the student's own already covers this window. */
  | "planned"
  /** Nothing covered it, so the engine held the customary time open. */
  | "reserved"
  /** Less than a full meal was free; the engine held what there was. */
  | "squeezed"
  /** The window was solid — class, work, or another commitment straight through. */
  | "no_gap";

export interface MealBreak {
  /** "YYYY-MM-DD" in the planning calendar. */
  date: string;
  /** Which meal this is, matching the window's key. */
  key: string;
  label: string;
  status: MealStatus;
  /** Absent for `no_gap`, where there is nothing to hold. */
  start: number | null;
  end: number | null;
  minutes: number;
}

/**
 * Reserved and squeezed breaks are the ones the scheduler must subtract. Planned breaks are
 * already commitments, and `no_gap` days have nothing to take.
 */
export function reservedIntervals(breaks: readonly MealBreak[]): Interval[] {
  const held: Interval[] = [];
  for (const meal of breaks) {
    if (meal.status !== "reserved" && meal.status !== "squeezed") continue;
    if (meal.start === null || meal.end === null) continue;
    held.push({ start: meal.start, end: meal.end });
  }
  return mergeIntervals(held);
}

/**
 * Works out, day by day, where each meal falls.
 *
 * Takes the busy intervals the capacity pass has already collected so the two agree exactly
 * about what counts as taken — recomputing them here is how the reserved lunch and the
 * capacity window drift apart by one commitment and nobody notices for a month.
 */
export function planMealBreaks(input: PlanningInput, busy: readonly Interval[]): MealBreak[] {
  const windows = input.preferences.mealWindows;
  if (windows.length === 0) return [];

  const horizonStart = dateToEpochMinutes(input.horizonStart);
  const now = toEpochMinutes(input.now);
  const mealCommitments = input.commitments.filter(
    // An optional commitment is not subtracted from capacity, so it cannot be the thing
    // that holds the time either.
    (c) => c.commitmentType === "meal" && c.flexibility !== "optional",
  );

  const breaks: MealBreak[] = [];

  for (let day = 0; day < input.horizonDays; day++) {
    const dayStart = horizonStart + day * MINUTES_PER_DAY;
    const dow = dayOfWeekFor(dayStart);
    const date = epochMinutesToDate(dayStart);

    for (const window of windows) {
      const span: Interval = {
        start: dayStart + parseTimeOfDay(window.earliest),
        end: dayStart + parseTimeOfDay(window.latest),
      };
      if (durationMinutes(span) <= 0) continue;
      // A meal already behind us is not a plan, it is a memory.
      if (span.end <= now) continue;

      if (coveredByCommitment(mealCommitments, dayStart, dow, date, span)) {
        breaks.push({
          date,
          key: window.key,
          label: window.label,
          status: "planned",
          start: null,
          end: null,
          minutes: 0,
        });
        continue;
      }

      // Only the part of the window the student intended to be free is ours to shape. If
      // availability says they are not around at 08:00, breakfast is none of our business.
      const openable = generalTimeInWindow(input, dayStart, dow, span, now);
      if (openable.length === 0) continue;

      // The customary hour has to be part of this student's day for the meal to be part of
      // the plan. Availability that merely clips the tail of the window — up at 09:00, with
      // breakfast nominally running to 09:30 — is not an invitation to book breakfast at the
      // first minute they are free.
      const anchorMinute = dayStart + parseTimeOfDay(window.anchor);
      if (!openable.some((slice) => anchorMinute >= slice.start && anchorMinute < slice.end)) {
        continue;
      }

      const free = openable.flatMap((slice) => subtractIntervals(slice, [...busy]));
      const totalFree = free.reduce((sum, i) => sum + durationMinutes(i), 0);

      if (totalFree === 0) {
        breaks.push({
          date,
          key: window.key,
          label: window.label,
          status: "no_gap",
          start: null,
          end: null,
          minutes: 0,
        });
        continue;
      }

      const slot = chooseSlot(free, anchorMinute, window.minutes, {
        valueAt: (interval) => studyValue(input, dayStart, dow, interval),
        boundaries: specialisedBoundaries(input, dayStart, dow),
      });
      if (!slot) continue;

      breaks.push({
        date,
        key: window.key,
        label: window.label,
        status: durationMinutes(slot) >= window.minutes ? "reserved" : "squeezed",
        start: slot.start,
        end: slot.end,
        minutes: durationMinutes(slot),
      });
    }
  }

  return breaks.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0));
}

/** Does one of the student's own meal commitments land in this window on this day? */
function coveredByCommitment(
  commitments: PlanningInput["commitments"],
  dayStart: number,
  dow: number,
  date: string,
  span: Interval,
): boolean {
  for (const commitment of commitments) {
    if (commitment.specificDate) {
      if (commitment.specificDate !== date) continue;
    } else if (!commitment.daysOfWeek.includes(dow)) {
      continue;
    }
    const start = dayStart + parseTimeOfDay(commitment.startTime);
    const end = dayStart + parseTimeOfDay(commitment.endTime);
    if (start < span.end && span.start < end) return true;
  }
  return false;
}

/**
 * The general-purpose availability inside the window, clipped to the future.
 *
 * Only rules with no location requirement are offered up. A student who wrote down
 * "Tuesday 13:00–14:30, library" has built a window on purpose, and the first version of
 * this took a forty-minute lunch out of the front of exactly that slot — which was the only
 * library time in the week, so the library-only task lost half its runway and the rest of it
 * landed on a Wednesday with no library at all. A narrow, purpose-built window is a
 * statement of intent, not spare room; broad "I am generally around" availability is where
 * a meal belongs.
 *
 * Protected days are deliberately not excluded. The scheduler leaves them empty, so there is
 * no study block to interrupt — but the day still has a lunchtime, and reporting it keeps
 * the week's shape honest rather than showing Sunday as a day without meals.
 */
function generalTimeInWindow(
  input: PlanningInput,
  dayStart: number,
  dow: number,
  span: Interval,
  now: number,
): Interval[] {
  const slices: Interval[] = [];
  for (const rule of input.availabilityRules) {
    if (rule.dayOfWeek !== dow) continue;
    if (rule.location !== "anywhere") continue;
    const start = Math.max(dayStart + parseTimeOfDay(rule.startTime), span.start, now);
    const end = Math.min(dayStart + parseTimeOfDay(rule.endTime), span.end);
    if (end > start) slices.push({ start, end });
  }
  return mergeIntervals(slices);
}

/**
 * How costly it would be to spend this stretch eating rather than studying.
 *
 * A gap that overlaps a specialised window is expensive even when the general availability
 * underneath it is broad — the student can only be in one place at a time, so a lunch there
 * still consumes the library hour. Sharp-focus time is worth protecting for the same reason
 * at lower cost.
 */
function studyValue(input: PlanningInput, dayStart: number, dow: number, gap: Interval): number {
  let value = 0;
  for (const rule of input.availabilityRules) {
    if (rule.dayOfWeek !== dow) continue;
    const start = dayStart + parseTimeOfDay(rule.startTime);
    const end = dayStart + parseTimeOfDay(rule.endTime);
    if (start >= gap.end || gap.start >= end) continue;
    if (rule.location !== "anywhere") value = Math.max(value, 3);
    else if (rule.energyLevel === "high") value = Math.max(value, 1);
  }
  return value;
}

/** Every edge of a specialised or high-energy window on this day, as a split point. */
function specialisedBoundaries(input: PlanningInput, dayStart: number, dow: number): number[] {
  const edges = new Set<number>();
  for (const rule of input.availabilityRules) {
    if (rule.dayOfWeek !== dow) continue;
    if (rule.location === "anywhere" && rule.energyLevel !== "high") continue;
    edges.add(dayStart + parseTimeOfDay(rule.startTime));
    edges.add(dayStart + parseTimeOfDay(rule.endTime));
  }
  return [...edges].sort((a, b) => a - b);
}

/**
 * Picks where in the free time the meal goes: out of the least useful study time available,
 * then as close to the customary hour as the day allows, and never straddling something
 * already booked.
 *
 * Each free stretch is offered whole *and* cut at the edges of any specialised window
 * crossing it. Scoring whole gaps alone was not enough: broad availability from 09:00 to
 * 21:00 with a library window from 12:00 to 13:30 inside it is a single gap over lunchtime,
 * so there was nothing to prefer, and the meal landed at the anchor in the middle of the
 * library hour. Cutting the gap gives the scorer the choice it needs, while keeping the
 * whole gap as a candidate means a meal can still span a boundary when that is all there is.
 *
 * When nothing is long enough the longest stretch is taken instead of nothing. Twenty-five
 * minutes to eat is a real answer; a plan that says the student simply will not eat is not.
 */
function chooseSlot(
  free: Interval[],
  anchor: number,
  minutes: number,
  scoring: { valueAt: (interval: Interval) => number; boundaries: number[] },
): Interval | null {
  interface Candidate {
    slot: Interval;
    fits: boolean;
    value: number;
    length: number;
    distance: number;
  }

  const candidates: Candidate[] = [];
  const consider = (region: Interval): void => {
    const length = durationMinutes(region);
    if (length <= 0) return;
    const take = Math.min(minutes, length);
    // Sit the meal at the customary hour where that is free, and otherwise at the edge of
    // the region nearest to it — which also leaves the remainder in one piece rather than
    // splitting a usable stretch into two unusable ones.
    const start = Math.min(Math.max(anchor, region.start), region.end - take);
    const slot = { start, end: start + take };
    candidates.push({
      slot,
      fits: take >= minutes,
      // Judged on the minutes actually taken, not on the region offered, so a meal at the
      // quiet end of a mixed stretch is not condemned by the busy end of it.
      value: scoring.valueAt(slot),
      length,
      distance: Math.abs(start - anchor),
    });
  };

  for (const gap of free) {
    consider(gap);
    for (const piece of splitAt(gap, scoring.boundaries)) consider(piece);
  }

  candidates.sort(
    (a, b) =>
      Number(b.fits) - Number(a.fits) ||
      a.value - b.value ||
      (a.fits ? 0 : b.length - a.length) ||
      a.distance - b.distance ||
      a.slot.start - b.slot.start,
  );

  return candidates[0]?.slot ?? null;
}

/** Cuts an interval at every boundary strictly inside it. */
function splitAt(interval: Interval, boundaries: readonly number[]): Interval[] {
  const inside = boundaries.filter((b) => b > interval.start && b < interval.end);
  if (inside.length === 0) return [];

  const pieces: Interval[] = [];
  let cursor = interval.start;
  for (const edge of inside) {
    pieces.push({ start: cursor, end: edge });
    cursor = edge;
  }
  pieces.push({ start: cursor, end: interval.end });
  return pieces;
}

/**
 * A one-line summary per day, for the interface and for the coach.
 *
 * Days where everything is already covered say nothing at all — the point is to surface the
 * assumptions the engine made and the days that leave no room to eat, not to narrate meals.
 */
export interface MealNote {
  date: string;
  kind: "reserved" | "squeezed" | "no_gap";
  text: string;
}

export function mealNotes(breaks: readonly MealBreak[]): MealNote[] {
  const notes: MealNote[] = [];
  for (const meal of breaks) {
    const when =
      meal.start !== null && meal.end !== null
        ? `${clock(meal.start)}–${clock(meal.end)}`
        : null;
    if (meal.status === "reserved" && when) {
      notes.push({
        date: meal.date,
        kind: "reserved",
        text: `${when} is being held for ${meal.label.toLowerCase()}.`,
      });
    } else if (meal.status === "squeezed" && when) {
      notes.push({
        date: meal.date,
        kind: "squeezed",
        text:
          `Only ${meal.minutes} minutes are free around ${meal.label.toLowerCase()}; ` +
          `${when} is being held.`,
      });
    } else if (meal.status === "no_gap") {
      notes.push({
        date: meal.date,
        kind: "no_gap",
        text: `There is no gap for ${meal.label.toLowerCase()} on this day.`,
      });
    }
  }
  return notes;
}

function clock(epochMinutes: number): string {
  return formatTimeOfDay(epochMinutes - dateToEpochMinutes(epochMinutesToDate(epochMinutes)));
}

export type { MealWindow };
