import { dayOfWeekFor, overlaps, parseTimeOfDay, toEpochMinutes } from "@schoolquest/domain";

/**
 * Whether a block can be put where the student is putting it.
 *
 * The move route used to write whatever it was given. A block could land on top of another
 * block, inside a class, across a locked work shift or outside the term, and the planner only
 * found out on the next replan -- by which time the student had been shown a week that could
 * not happen. These are the checks the scheduler applies when it places a block itself, applied
 * once more at the one door where a human places one.
 *
 * Pure, so it is testable without a database; the route gathers the rows and asks.
 */

export interface MoveTarget {
  startAt: string;
  endAt: string;
}

export interface MoveSurroundings {
  /** Live blocks in the same term, the one being moved excluded. */
  sessions: readonly { id: string; startAt: string; endAt: string; title: string }[];
  /** Class meetings in the term. `daysOfWeek` is the stored "1,3" form. */
  meetings: readonly { daysOfWeek: string; startTime: string; endTime: string; courseName: string }[];
  /** Fixed and locked commitments. Flexible ones are the student's to trade away. */
  commitments: readonly {
    title: string;
    daysOfWeek: string;
    startTime: string;
    endTime: string;
    specificDate: string | null;
    flexibility: string;
    locked: boolean;
  }[];
  /** The term's dates, inclusive, as "YYYY-MM-DD". */
  termStartDate: string;
  termEndDate: string;
}

/** The reason the move is refused, or null when it is fine. */
export function findMoveConflict(target: MoveTarget, around: MoveSurroundings): string | null {
  const start = toEpochMinutes(target.startAt);
  const end = toEpochMinutes(target.endAt);
  const block = { start, end };
  const date = target.startAt.slice(0, 10);

  if (date < around.termStartDate || date > around.termEndDate) {
    return "That is outside the term. A block has to land between the term's start and end dates.";
  }

  for (const other of around.sessions) {
    if (overlaps(block, { start: toEpochMinutes(other.startAt), end: toEpochMinutes(other.endAt) })) {
      return `That time is already booked for ${other.title}. Move that block first, or pick another hour.`;
    }
  }

  const weekday = dayOfWeekFor(start);
  const minuteOfDay = start - toEpochMinutes(`${date}T00:00:00Z`);
  const minutesOnDay = { start: minuteOfDay, end: minuteOfDay + (end - start) };
  const onDay = (days: string) => days.split(",").map((d) => d.trim()).includes(String(weekday));

  for (const meeting of around.meetings) {
    if (!onDay(meeting.daysOfWeek)) continue;
    const window = { start: parseTimeOfDay(meeting.startTime), end: parseTimeOfDay(meeting.endTime) };
    if (overlaps(minutesOnDay, window)) {
      return `That is during ${meeting.courseName}. A study block cannot sit inside a class meeting.`;
    }
  }

  for (const c of around.commitments) {
    if (c.flexibility === "flexible" || c.flexibility === "optional") continue;
    const applies = c.specificDate ? c.specificDate === date : onDay(c.daysOfWeek);
    if (!applies) continue;
    const window = { start: parseTimeOfDay(c.startTime), end: parseTimeOfDay(c.endTime) };
    if (overlaps(minutesOnDay, window)) {
      return `That is during ${c.title}, which is fixed. Pick an hour that is free.`;
    }
  }

  return null;
}
