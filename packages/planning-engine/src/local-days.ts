import {
  addDays,
  dateToEpochMinutes,
  dayOfWeekFor,
  parseTimeOfDay,
  zoneCalendar,
  type ZoneCalendar,
} from "@schoolquest/domain";

/**
 * One day of the horizon as the student lives it, in UTC.
 *
 * Weekly rules -- free hours, class meetings, shifts, meals -- are local by nature ("Mondays
 * three to ten"), and this is where they become instants. `start` and `end` are the UTC instants
 * of the student's midnights, so a day is 1440 minutes long except across a daylight-saving
 * change, where it is 1380 or 1500, as it really is.
 */
export interface LocalDay {
  /** The student's calendar date, "YYYY-MM-DD". */
  date: string;
  /** The student's weekday, 0 = Sunday. */
  dayOfWeek: number;
  /** UTC epoch minutes of the student's midnight starting this day. */
  start: number;
  /** UTC epoch minutes of the next one. */
  end: number;
  /** The UTC instant of a local "HH:MM" on this day. */
  at(time: string): number;
}

/** The calendar a planning input is read in: the student's zone, or UTC when none is given. */
export function calendarOf(input: { timeZone?: string }): ZoneCalendar {
  return zoneCalendar(input.timeZone);
}

/** Every day of the horizon, in order. */
export function horizonDays(input: {
  horizonStart: string;
  horizonDays: number;
  timeZone?: string;
}): LocalDay[] {
  const calendar = calendarOf(input);
  const days: LocalDay[] = [];
  for (let i = 0; i < input.horizonDays; i += 1) {
    const date = addDays(input.horizonStart, i);
    days.push({
      date,
      // A date's weekday does not depend on the zone; only where it starts does.
      dayOfWeek: dayOfWeekFor(dateToEpochMinutes(date)),
      start: calendar.dayStart(date),
      end: calendar.dayStart(addDays(date, 1)),
      at: (time) => calendar.at(date, parseTimeOfDay(time)),
    });
  }
  return days;
}

/** UTC instants bounding the horizon: the student's first midnight and the one after the last day. */
export function horizonBounds(input: {
  horizonStart: string;
  horizonDays: number;
  timeZone?: string;
}): { start: number; end: number } {
  const calendar = calendarOf(input);
  return {
    start: calendar.dayStart(input.horizonStart),
    end: calendar.dayStart(addDays(input.horizonStart, input.horizonDays)),
  };
}
