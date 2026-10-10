import { eq } from "drizzle-orm";
import { users } from "./db/schema.js";
import type { Db } from "./db/repo.js";

/**
 * "Now" on the student's own clock, written the way the app writes every time.
 *
 * The app keeps wall-clock times with a `Z` on the end: a class at nine is `09:00Z`, a study
 * window from three to ten is `15:00Z`-`22:00Z`, an assignment due at midnight is `23:59Z`. That
 * frame is consistent with itself and was never anchored to the real moment, because "now" was
 * read as `new Date().toISOString()` -- the time in Greenwich. For a student in Chicago that runs
 * five or six hours ahead of their day, so the planner believed the afternoon was already over:
 * at three it booked from eight, and from about six in the evening it booked nothing today at
 * all, while their study hours were still ahead of them. Further west it was worse, and a
 * Honolulu student lost ten hours of every day. Found by the scheduling journey
 * (`tools/e2e/scheduling.mjs`), which runs the browser in a zone that is not UTC.
 *
 * This reads the real moment in the student's zone and writes it in that frame. An unknown or
 * malformed zone falls back to UTC, which is exactly the old behaviour, never to an error.
 */
export function wallClockNow(timeZone: string | null | undefined, at: Date = new Date()): string {
  if (!timeZone || !isTimeZone(timeZone)) return at.toISOString();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const ms = String(at.getUTCMilliseconds()).padStart(3, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${ms}Z`;
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

/** The signed-in student's wall-clock now. */
export async function studentNow(db: Db, userId: string): Promise<string> {
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  return wallClockNow(user?.timezone);
}
