/**
 * Due-date wording shared by the arc, the projects card, the terrain map and the radar.
 *
 * Two engine facts feed every one of these, and they answer different questions:
 *
 * - `daysAway` (`daysUntil`) is the calendar distance in the student's zone -- "today", "3d",
 *   "2d ago". It is a label and nothing else.
 * - `pastDue` (`isPastDue`, or the view model's status field derived from it) is whether the
 *   deadline instant has passed. It alone decides "overdue": colour, counts, bands, wording.
 *
 * They disagree on exactly one day. Work due at 09:00, looked at at 15:00, is `daysAway` 0 and
 * past due; inferring status from `daysAway < 0` called it "today" and kept it in the coming
 * week until midnight, offering the afternoon to something that can no longer be handed in.
 */
export interface DueFacts {
  /** Whole calendar days from now, in the student's zone. 0 is today, negative is earlier. */
  daysAway: number;
  /** The deadline instant has passed and the work is still open. */
  pastDue: boolean;
}

/** "3d", "today", "earlier today", "2d ago" -- the compact distance printed on a row. */
export function dueDistanceShort({ daysAway, pastDue }: DueFacts): string {
  if (daysAway < 0) return `${-daysAway}d ago`;
  if (daysAway === 0) return pastDue ? "earlier today" : "today";
  return `${daysAway}d`;
}

/** The same distance in words, for screen readers and the plain rendering. */
export function dueDistanceSpoken({ daysAway, pastDue }: DueFacts): string {
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  if (pastDue)
    return daysAway < 0 ? `past due by ${days(-daysAway)}` : "past due since earlier today";
  // Not past due but on an earlier date: finished work, whose date is history, not a warning.
  if (daysAway < 0) return `was due ${days(-daysAway)} ago`;
  if (daysAway === 0) return "due today";
  return `due in ${days(daysAway)}`;
}

/** Which band of the campaign arc a dated milestone sits in. Past due outranks every distance. */
export type ArcBand = "overdue" | "week" | "month" | "term";

export function arcBand({ daysAway, pastDue }: DueFacts): ArcBand {
  if (pastDue) return "overdue";
  if (daysAway <= 7) return "week";
  if (daysAway <= 30) return "month";
  return "term";
}

/** The radar's headline for an encounter: "2 days overdue", "Overdue since earlier today", "Tomorrow". */
export function radarDueWord({ daysAway, pastDue }: DueFacts, weekday: string): string {
  if (pastDue) {
    return daysAway < 0
      ? `${-daysAway} day${daysAway === -1 ? "" : "s"} overdue`
      : "Overdue since earlier today";
  }
  if (daysAway <= 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `${weekday} · ${daysAway} days`;
}

/** The terrain map's date line: "Mon 14 Sep · earlier today". */
export function terrainDueLine(when: string, facts: DueFacts): string {
  const { daysAway } = facts;
  if (daysAway < 0) return `${when} · ${-daysAway}d ago`;
  if (daysAway === 0) return `${when} · ${facts.pastDue ? "earlier today" : "today"}`;
  return `${when} · in ${daysAway}d`;
}
