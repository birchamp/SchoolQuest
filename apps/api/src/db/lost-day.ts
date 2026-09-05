/**
 * Which blocks "I lost today" gives up.
 *
 * Every block still open on that calendar day, in the app's UTC wall clock like every other
 * date here. A block already finished, skipped or released is history and is left alone; the
 * point of the action is to stop the day's remaining plan pretending it will still happen.
 */
export function isOpenOnDay(
  session: { startAt: string; status: string },
  date: string,
): boolean {
  return (
    (session.status === "planned" || session.status === "started") &&
    session.startAt.slice(0, 10) === date
  );
}
