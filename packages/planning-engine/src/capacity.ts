import {
  dateToEpochMinutes,
  dayOfWeekFor,
  durationMinutes,
  MINUTES_PER_DAY,
  mergeIntervals,
  parseTimeOfDay,
  subtractIntervals,
  toEpochMinutes,
  type Interval,
} from "@schoolquest/domain";
import type { PlanningInput, CapacityWindow } from "./types.js";

/**
 * Turns availability rules into concrete free windows by subtracting everything the
 * student has already committed to: class meetings, recurring commitments, and any
 * locked sessions carried over from the previous plan.
 *
 * Optional commitments are NOT subtracted — they are movable by definition, so treating
 * them as busy would hide real capacity.
 */
export function buildCapacityWindows(input: PlanningInput): CapacityWindow[] {
  const horizonStart = dateToEpochMinutes(input.horizonStart);
  const horizonEnd = horizonStart + input.horizonDays * MINUTES_PER_DAY;
  const now = toEpochMinutes(input.now);
  const busy = collectBusyIntervals(input, horizonStart, input.horizonDays);
  const protectedDays = new Set(input.preferences.protectedDaysOfWeek);

  const windows: CapacityWindow[] = [];

  for (let day = 0; day < input.horizonDays; day++) {
    const dayStart = horizonStart + day * MINUTES_PER_DAY;
    const dow = dayOfWeekFor(dayStart);
    if (protectedDays.has(dow)) continue;

    for (const rule of input.availabilityRules) {
      if (rule.dayOfWeek !== dow) continue;

      const ruleStart = dayStart + parseTimeOfDay(rule.startTime);
      const ruleEnd = dayStart + parseTimeOfDay(rule.endTime);
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

  return windows.sort((a, b) => a.start - b.start || a.end - b.end);
}

function collectBusyIntervals(
  input: PlanningInput,
  horizonStart: number,
  horizonDays: number,
): Interval[] {
  const busy: Interval[] = [];

  for (let day = 0; day < horizonDays; day++) {
    const dayStart = horizonStart + day * MINUTES_PER_DAY;
    const dow = dayOfWeekFor(dayStart);
    const date = new Date(dayStart * 60_000).toISOString().slice(0, 10);

    for (const pattern of input.meetingPatterns) {
      if (!pattern.daysOfWeek.includes(dow)) continue;
      if (pattern.effectiveStart && date < pattern.effectiveStart) continue;
      if (pattern.effectiveEnd && date > pattern.effectiveEnd) continue;
      busy.push({
        start: dayStart + parseTimeOfDay(pattern.startTime),
        end: dayStart + parseTimeOfDay(pattern.endTime),
      });
    }

    for (const commitment of input.commitments) {
      if (commitment.flexibility === "optional") continue;
      if (commitment.specificDate) {
        if (commitment.specificDate !== date) continue;
      } else if (!commitment.daysOfWeek.includes(dow)) {
        continue;
      }
      busy.push({
        start: dayStart + parseTimeOfDay(commitment.startTime),
        end: dayStart + parseTimeOfDay(commitment.endTime),
      });
    }
  }

  // Locked sessions hold their slot across replans (docs/04 §12).
  for (const session of input.existingSessions) {
    if (!session.locked) continue;
    if (session.status === "missed" || session.status === "skipped") continue;
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
