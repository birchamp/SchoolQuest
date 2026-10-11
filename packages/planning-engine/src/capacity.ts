import {
  durationMinutes,
  mergeIntervals,
  subtractIntervals,
  toEpochMinutes,
  type Interval,
} from "@schoolquest/domain";
import { horizonBounds, horizonDays } from "./local-days.js";
import { planMealBreaks, reservedIntervals, type MealBreak } from "./meals.js";
import type { PlanningInput, CapacityWindow } from "./types.js";

/** Free time to work in, plus the meal time that was held out of it. */
export interface Capacity {
  windows: CapacityWindow[];
  meals: MealBreak[];
}

/**
 * Turns availability rules into concrete free windows by subtracting everything the
 * student has already committed to: class meetings, recurring commitments, any locked
 * sessions carried over from the previous plan, and customary meal time.
 *
 * Optional commitments are NOT subtracted — they are movable by definition, so treating
 * them as busy would hide real capacity.
 */
export function buildCapacity(input: PlanningInput): Capacity {
  const { end: horizonEnd } = horizonBounds(input);
  const now = toEpochMinutes(input.now);
  const committed = collectBusyIntervals(input);

  // Meals are worked out against exactly the same busy set the windows are cut from, so the
  // held lunch and the capacity around it can never disagree about what is already taken.
  const meals = planMealBreaks(input, committed);
  const busy = mergeIntervals([...committed, ...reservedIntervals(meals)]);

  const protectedDays = new Set(input.preferences.protectedDaysOfWeek);

  const windows: CapacityWindow[] = [];

  for (const day of horizonDays(input)) {
    if (protectedDays.has(day.dayOfWeek)) continue;

    for (const rule of input.availabilityRules) {
      if (rule.dayOfWeek !== day.dayOfWeek) continue;

      const ruleStart = day.at(rule.startTime);
      const ruleEnd = day.at(rule.endTime);
      if (ruleEnd <= ruleStart) continue;

      // Never plan into the past, and never past the horizon.
      const base: Interval = {
        start: Math.max(ruleStart, now),
        end: Math.min(ruleEnd, horizonEnd),
      };
      if (durationMinutes(base) <= 0) continue;

      for (const free of subtractIntervals(base, busy)) {
        windows.push({
          start: free.start,
          end: free.end,
          energyLevel: rule.energyLevel,
          location: rule.location,
          hardness: rule.hardness,
        });
      }
    }
  }

  return { windows: windows.sort((a, b) => a.start - b.start || a.end - b.end), meals };
}

/** The windows alone, for callers that do not care how the day was shaped. */
export function buildCapacityWindows(input: PlanningInput): CapacityWindow[] {
  return buildCapacity(input).windows;
}

function collectBusyIntervals(input: PlanningInput): Interval[] {
  const busy: Interval[] = [];

  for (const day of horizonDays(input)) {
    const { date, dayOfWeek: dow } = day;

    for (const pattern of input.meetingPatterns) {
      if (!pattern.daysOfWeek.includes(dow)) continue;
      if (pattern.effectiveStart && date < pattern.effectiveStart) continue;
      if (pattern.effectiveEnd && date > pattern.effectiveEnd) continue;
      busy.push({ start: day.at(pattern.startTime), end: day.at(pattern.endTime) });
    }

    for (const commitment of input.commitments) {
      if (commitment.flexibility === "optional") continue;
      if (commitment.specificDate) {
        if (commitment.specificDate !== date) continue;
      } else if (!commitment.daysOfWeek.includes(dow)) {
        continue;
      }
      busy.push({ start: day.at(commitment.startTime), end: day.at(commitment.endTime) });
    }
  }

  for (const session of input.existingSessions) {
    // A block the student skipped is an hour they said they do not have. "Not now" replans so
    // the work gets its time back, and without this the earliest free time it found was the
    // very hour just declined -- "not now" answered with "now". Only the skipped block's own
    // hour is held; the rest of the day is still free.
    if (session.status === "skipped") {
      busy.push({ start: toEpochMinutes(session.startAt), end: toEpochMinutes(session.endAt) });
      continue;
    }
    // Locked sessions hold their slot across replans (docs/04 §12).
    if (!session.locked) continue;
    if (session.status === "missed") continue;
    busy.push({ start: toEpochMinutes(session.startAt), end: toEpochMinutes(session.endAt) });
  }

  return mergeIntervals(busy);
}

/** Total minutes of capacity, used for the "capacity used vs available" readout. */
export function totalCapacityMinutes(windows: CapacityWindow[]): number {
  return mergeIntervals(windows.map((w) => ({ start: w.start, end: w.end }))).reduce(
    (sum, i) => sum + durationMinutes(i),
    0,
  );
}
