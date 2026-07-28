/**
 * Time helpers.
 *
 * Everything the planning engine reasons about is an absolute UTC instant expressed as
 * epoch minutes. Wall-clock strings ("14:30") and dates ("2026-09-07") only appear at
 * the edges — recurrence rules and rendering.
 */

export const MINUTES_PER_DAY = 24 * 60;

export function toEpochMinutes(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 60_000);
}

export function fromEpochMinutes(minutes: number): string {
  return new Date(minutes * 60_000).toISOString();
}

/** Minutes since midnight for a "HH:MM" string. */
export function parseTimeOfDay(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

export function formatTimeOfDay(minutesSinceMidnight: number): string {
  const wrapped = ((minutesSinceMidnight % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Epoch minutes for midnight UTC at the start of the given calendar date. */
export function dateToEpochMinutes(date: string): number {
  return toEpochMinutes(`${date}T00:00:00.000Z`);
}

export function epochMinutesToDate(minutes: number): string {
  return fromEpochMinutes(minutes).slice(0, 10);
}

/** 0 = Sunday, matching Date#getUTCDay. */
export function dayOfWeekFor(epochMinutes: number): number {
  return new Date(epochMinutes * 60_000).getUTCDay();
}

export function addDays(date: string, days: number): string {
  return epochMinutesToDate(dateToEpochMinutes(date) + days * MINUTES_PER_DAY);
}

export interface Interval {
  start: number;
  end: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function durationMinutes(interval: Interval): number {
  return Math.max(0, interval.end - interval.start);
}

/**
 * Removes every busy interval from `base`, returning the free remainder in order.
 * Used to turn availability rules minus fixed commitments into capacity windows.
 */
export function subtractIntervals(base: Interval, busy: Interval[]): Interval[] {
  const relevant = busy
    .filter((b) => overlaps(base, b))
    .sort((a, b) => a.start - b.start);

  const free: Interval[] = [];
  let cursor = base.start;
  for (const block of relevant) {
    if (block.start > cursor) free.push({ start: cursor, end: Math.min(block.start, base.end) });
    cursor = Math.max(cursor, block.end);
    if (cursor >= base.end) break;
  }
  if (cursor < base.end) free.push({ start: cursor, end: base.end });

  return free.filter((i) => durationMinutes(i) > 0);
}

/** Merges overlapping or touching intervals into a minimal sorted set. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...sorted[0]! }];
  for (const next of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (next.start <= last.end) last.end = Math.max(last.end, next.end);
    else merged.push({ ...next });
  }
  return merged;
}
