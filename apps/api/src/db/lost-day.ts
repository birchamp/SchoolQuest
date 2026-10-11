import { toEpochMinutes, zoneCalendar } from "@schoolquest/domain";

/**
 * Which blocks "I lost today" gives up.
 *
 * Every block still open on that calendar day -- the student's day, read in their zone, since
 * the blocks themselves are UTC. A block already finished, skipped or released is history and
 * is left alone; the point of the action is to stop the day's remaining plan pretending it will
 * still happen.
 */
export function isOpenOnDay(
  session: { startAt: string; status: string },
  date: string,
  timeZone?: string,
): boolean {
  return (
    (session.status === "planned" || session.status === "started") &&
    zoneCalendar(timeZone).dateOf(toEpochMinutes(session.startAt)) === date
  );
}
