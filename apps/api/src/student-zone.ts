import { eq } from "drizzle-orm";
import { isTimeZone, zoneCalendar, type ZoneCalendar } from "@schoolquest/domain";
import { users } from "./db/schema.js";
import type { Db } from "./db/repo.js";

/**
 * The zone a student's days and weekly rules are read in.
 *
 * Every time the API stores, compares or returns is a UTC instant (the rule is at the top of
 * `packages/domain/src/time.ts`). The zone is not a time standard; it is the answer to "when does
 * this student's Monday begin, and when is their nine o'clock class", which the planner needs to
 * turn their weekly rules into instants. An unknown zone reads as UTC rather than failing.
 */
export async function studentZone(db: Db, userId: string): Promise<string> {
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  return user?.timezone && isTimeZone(user.timezone) ? user.timezone : "UTC";
}

/** The student's calendar: their dates, weekdays and midnights, as UTC instants. */
export async function studentCalendar(db: Db, userId: string): Promise<ZoneCalendar> {
  return zoneCalendar(await studentZone(db, userId));
}
