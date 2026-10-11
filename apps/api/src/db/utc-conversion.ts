import { eq, inArray } from "drizzle-orm";
import {
  fromEpochMinutes,
  isTimeZone,
  toEpochMinutes,
  zoneCalendar,
  type ZoneCalendar,
} from "@schoolquest/domain";
import { courses, interruptions, terms, users, workItems, workSessions } from "./schema.js";
import type { Db } from "./repo.js";

/**
 * Moves one account's stored times onto the UTC standard (issue #4, migration 0008).
 *
 * Before this, scheduled times were the student's local wall-clock time spelled as UTC: an essay
 * due at midnight in Chicago was stored `23:59Z`. Read in the student's zone, that string names
 * the real instant; this writes the real instant, `04:59Z` or `05:59Z` the next day.
 *
 * Done lazily, per account, because SQLite has no zone rules to do it in the migration. Safe to
 * race and safe to fail, which a Worker serving a student's parallel requests needs:
 *
 * - **Atomic.** Every update and the flag that says "done" go in one D1 batch, which is a single
 *   transaction. A failure converts nothing, and the next request starts clean.
 * - **Once.** Every update is conditional on the flag still reading 0 inside that transaction,
 *   so two requests converting at once cannot shift a row twice.
 *
 * The zone is the one the caller passes: the device's, from the request, or the student's pinned
 * one. Never the stored zone on its own, which for most accounts is still the sign-up default.
 */
export async function ensureUtcStandard(
  db: Db,
  d1: D1Database,
  userId: string,
  /** The zone the records were written in: the device's, or the one the student pinned. */
  timeZone: string,
): Promise<boolean> {
  const [user] = await db
    .select({ timezone: users.timezone, timeStandard: users.timeStandard })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.timeStandard >= 1) return false;

  const calendar = zoneCalendar(isTimeZone(timeZone) ? timeZone : "UTC");
  const termIds = (await db.select({ id: terms.id }).from(terms).where(eq(terms.userId, userId))).map(
    (t) => t.id,
  );
  const courseIds =
    termIds.length === 0
      ? []
      : (await db.select({ id: courses.id }).from(courses).where(inArray(courses.termId, termIds))).map(
          (row) => row.id,
        );

  const items =
    courseIds.length === 0
      ? []
      : await db
          .select({ id: workItems.id, dueAt: workItems.dueAt, availableAt: workItems.availableAt })
          .from(workItems)
          .where(inArray(workItems.courseId, courseIds));
  const itemIds = items.map((i) => i.id);
  const sessions: { id: string; startAt: string; endAt: string }[] = [];
  for (let i = 0; i < itemIds.length; i += 90) {
    sessions.push(
      ...(await db
        .select({ id: workSessions.id, startAt: workSessions.startAt, endAt: workSessions.endAt })
        .from(workSessions)
        .where(inArray(workSessions.workItemId, itemIds.slice(i, i + 90)))),
    );
  }
  const reported =
    termIds.length === 0
      ? []
      : await db
          .select({ id: interruptions.id, startAt: interruptions.startAt, endAt: interruptions.endAt })
          .from(interruptions)
          .where(inArray(interruptions.termId, termIds));

  // Every change, as (table, column, id, from, to). Only values that actually move.
  const changes: { table: "work_items" | "work_sessions" | "interruptions"; column: string; id: string; to: string }[] = [];
  const note = (table: (typeof changes)[number]["table"], column: string, id: string, before: string | null) => {
    if (!before) return;
    const after = floatingToUtc(before, calendar);
    if (after !== before) changes.push({ table, column, id, to: after });
  };
  for (const item of items) {
    note("work_items", "due_at", item.id, item.dueAt);
    note("work_items", "available_at", item.id, item.availableAt);
  }
  for (const session of sessions) {
    note("work_sessions", "start_at", session.id, session.startAt);
    note("work_sessions", "end_at", session.id, session.endAt);
  }
  for (const row of reported) {
    note("interruptions", "start_at", row.id, row.startAt);
    note("interruptions", "end_at", row.id, row.endAt);
  }

  /**
   * One transaction, guarded by the flag *inside* it.
   *
   * Every update applies only while this account is still unconverted, read in the same
   * transaction, and the flag flips last. D1 runs a batch as one serialized transaction, so a
   * second request that read the flag as 0 before the first committed, and then read the already
   * converted values, finds the flag at 1 when its own batch runs and changes nothing -- a
   * compare-and-set on the values alone would have shifted every row a second time.
   *
   * Rows go thirty to a statement (`CASE id WHEN ? THEN ? ...`) to stay under D1's bound-parameter
   * ceiling with a handful of statements, rather than one statement per value.
   */
  // D1's own prepared statements: drizzle 0.38 cannot put raw SQL into a D1 batch. Table and
  // column names come only from the fixed set above; every value is bound.
  const statements: D1PreparedStatement[] = [];
  const groups = new Map<string, typeof changes>();
  for (const change of changes) {
    const key = `${change.table}.${change.column}`;
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }
  for (const [key, group] of groups) {
    const [table, column] = key.split(".") as [string, string];
    for (let i = 0; i < group.length; i += 30) {
      const batch = group.slice(i, i + 30);
      const cases = batch.map(() => "WHEN ? THEN ?").join(" ");
      const ids = batch.map(() => "?").join(", ");
      statements.push(
        d1
          .prepare(
            `UPDATE "${table}" SET "${column}" = CASE id ${cases} END ` +
              `WHERE id IN (${ids}) AND (SELECT time_standard FROM users WHERE id = ?) = 0`,
          )
          .bind(...batch.flatMap((c) => [c.id, c.to]), ...batch.map((c) => c.id), userId),
      );
    }
  }
  // The zone the records were read in becomes the account's, so the screens show them in it.
  statements.push(
    d1
      .prepare("UPDATE users SET time_standard = 1, timezone = ? WHERE id = ? AND time_standard = 0")
      .bind(timeZone, userId),
  );

  await d1.batch(statements);
  return changes.length > 0;
}

/**
 * A stored local wall-clock time, as the UTC instant it named.
 *
 * The characters are the student's local date and time of day. A time that never happened (inside
 * a spring-forward gap) moves past the jump, as a clock would; one that happened twice is its first.
 */
export function floatingToUtc(value: string, calendar: ZoneCalendar): string {
  const date = value.slice(0, 10);
  const floating = toEpochMinutes(value);
  const minuteOfDay = floating - toEpochMinutes(`${date}T00:00:00.000Z`);
  const seconds = value.slice(17, 23);
  const converted = fromEpochMinutes(calendar.at(date, minuteOfDay));
  // Keep any seconds the old value carried; the calendar works in whole minutes.
  return /^\d\d\.\d\d\d$/.test(seconds) ? `${converted.slice(0, 17)}${seconds}Z` : converted;
}
