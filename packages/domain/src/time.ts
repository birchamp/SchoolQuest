/**
 * Time helpers, and the one rule about time in SchoolQuest.
 *
 * **Inside the system every time is a UTC instant.** Due dates, study blocks, plan stamps, "now":
 * all real moments, stored and compared in UTC, as ISO strings with `Z` or as epoch minutes.
 * There is no second kind. `09:00:00.000Z` means nine o'clock in Greenwich and nothing else.
 *
 * The student's own zone (`users.timezone`) appears at exactly two edges:
 *
 * - **The view.** Times are shown, and typed in, in the student's zone. Converting is the
 *   screen's job (`apps/web/src/lib/clock.ts`); nothing it converts is ever stored unconverted.
 * - **Local rules becoming instants.** Some inputs are local by nature -- "free Mondays three to
 *   ten", "Biology meets at nine", "lunch around noon", a term that starts on the 24th. Those
 *   stay as dates and "HH:MM" strings, because that is what they are, and `ZoneCalendar` turns
 *   them into UTC instants for each real day, daylight saving included. Everything after that
 *   is UTC arithmetic.
 *
 * Calendar dates ("2026-09-07") are dates, not instants: a term's first day, a holiday. Which
 * instant a date *starts* at depends on the zone, and only `ZoneCalendar` answers that.
 *
 * Never format a stored time without naming the zone, and never take a day from a stored time
 * with `.slice(0, 10)`: that is the UTC date, which is the student's date only at UTC+0. Both
 * mistakes pass every test run at UTC+0 and break for everyone else, which is how this rule came
 * to be written down (issue #4).
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

/**
 * Epoch minutes for midnight UTC at the start of the given calendar date.
 *
 * Date arithmetic (day counts, adding days), or the start of a day *in UTC*. For when a student's
 * day starts, use `ZoneCalendar.dayStart`.
 */
export function dateToEpochMinutes(date: string): number {
  return toEpochMinutes(`${date}T00:00:00.000Z`);
}

/** The UTC date of an instant. For the student's date, use `ZoneCalendar.dateOf`. */
export function epochMinutesToDate(minutes: number): string {
  return fromEpochMinutes(minutes).slice(0, 10);
}

/** 0 = Sunday, the UTC weekday. For the student's weekday, use `ZoneCalendar.dayOfWeek`. */
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

/** Whether the runtime knows this IANA zone name. */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A student's calendar: where their days begin, what date and weekday an instant falls on, and
 * which instant a local time on a local date is.
 *
 * The only bridge between UTC and the student's zone, used at the two edges `time.ts` describes.
 * Built on `Intl`, so it follows the zone's real rules, daylight saving included.
 */
export interface ZoneCalendar {
  readonly timeZone: string;
  /** Minutes the zone is ahead of UTC at this instant (negative to the west). */
  offset(epochMinutes: number): number;
  /** The student's calendar date at this instant, "YYYY-MM-DD". */
  dateOf(epochMinutes: number): string;
  /** The student's weekday at this instant, 0 = Sunday. */
  dayOfWeek(epochMinutes: number): number;
  /** Minutes since the student's midnight at this instant. */
  minuteOfDay(epochMinutes: number): number;
  /**
   * The instant of a local time on a local date.
   *
   * A time that does not exist (inside a spring-forward gap) moves forward by the gap, as clocks
   * do; a time that happens twice (a fall-back hour) is its first occurrence.
   */
  at(date: string, minuteOfDay: number): number;
  /** The instant the student's day begins. */
  dayStart(date: string): number;
}

const utcCalendar: ZoneCalendar = {
  timeZone: "UTC",
  offset: () => 0,
  dateOf: (m) => epochMinutesToDate(m),
  dayOfWeek: (m) => dayOfWeekFor(m),
  minuteOfDay: (m) => ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
  at: (date, minute) => dateToEpochMinutes(date) + minute,
  dayStart: (date) => dateToEpochMinutes(date),
};

const calendars = new Map<string, ZoneCalendar>();

/** The calendar for an IANA zone. An unknown or missing zone is UTC, never an error. */
export function zoneCalendar(timeZone: string | null | undefined): ZoneCalendar {
  if (!timeZone || timeZone === "UTC" || timeZone === "Etc/UTC") return utcCalendar;
  // The cache first: validating a name builds an `Intl.DateTimeFormat`, which is the very cost
  // the cache is for, and the planner asks for the same calendar thousands of times.
  const cached = calendars.get(timeZone);
  if (cached) return cached;
  if (!isTimeZone(timeZone)) return utcCalendar;

  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  /** The zone's offset at one minute, straight from `Intl` -- slow. */
  const lookUp = (epochMinutes: number): number => {
    const at = epochMinutes * 60_000;
    const parts = Object.fromEntries(format.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
    const local = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    return Math.round((local - at) / 60_000);
  };
  /**
   * Offsets per UTC day: the offset the day starts with, the minute it changes (if it does), and
   * the offset after. Two lookups for an ordinary day, and a binary search to the exact minute
   * for a day with a transition in it -- which lands on any minute at all, not only a quarter
   * hour: before standard time, zones kept local mean time and changed at odd minutes. The
   * quarter-hour cache this replaces was inexact there and grew without limit over a long run;
   * this one holds a few years of days and starts over past that. Found in review.
   */
  const byDay = new Map<number, { change: number; before: number; after: number }>();
  const offset = (epochMinutes: number): number => {
    const day = Math.floor(epochMinutes / MINUTES_PER_DAY);
    let known = byDay.get(day);
    if (!known) {
      if (byDay.size >= 2048) byDay.clear();
      const start = day * MINUTES_PER_DAY;
      const end = start + MINUTES_PER_DAY;
      const before = lookUp(start);
      const after = lookUp(end);
      let change = end;
      if (before !== after) {
        // The first minute on the new offset: `lo` always reads `before`, `hi` never does.
        let lo = start;
        let hi = end;
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2);
          if (lookUp(mid) === before) lo = mid;
          else hi = mid;
        }
        change = hi;
      }
      known = { change, before, after };
      byDay.set(day, known);
    }
    return epochMinutes < known.change ? known.before : known.after;
  };

  const at = (date: string, minuteOfDay: number): number => {
    const naive = dateToEpochMinutes(date) + minuteOfDay;
    // The offset either side of the day; at most one transition falls between them.
    const before = naive - offset(naive - MINUTES_PER_DAY);
    const after = naive - offset(naive + MINUTES_PER_DAY);
    const valid = [before, after].filter((t) => t + offset(t) === naive);
    if (valid.length > 0) return Math.min(...valid);
    // A gap: the clocks skipped this time. Read it with the offset from before the jump, which
    // lands the same distance past the jump as the time was past the gap's start.
    return before;
  };

  const calendar: ZoneCalendar = {
    timeZone,
    offset,
    dateOf: (m) => epochMinutesToDate(m + offset(m)),
    dayOfWeek: (m) => dayOfWeekFor(m + offset(m)),
    minuteOfDay: (m) => utcCalendar.minuteOfDay(m + offset(m)),
    at,
    dayStart: (date) => at(date, 0),
  };
  calendars.set(timeZone, calendar);
  return calendar;
}
