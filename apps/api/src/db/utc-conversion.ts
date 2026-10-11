import { eq, inArray } from "drizzle-orm";
import {
  dateToEpochMinutes,
  fromEpochMinutes,
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
  /** The zone the records were written in; see `conversionZone`. */
  timeZone: string,
  /** Whether the account takes `timeZone` as its own: only when it replaces the sign-up default. */
  adopt = false,
): Promise<boolean> {
  const [user] = await db
    .select({ timeStandard: users.timeStandard })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.timeStandard >= 1) return false;

  const calendar = zoneCalendar(timeZone);
  // Every lookup in chunks: D1 binds at most 100 parameters to a statement, and an account with a
  // long history of terms and courses would otherwise fail its conversion on every request.
  const termIds = (await db.select({ id: terms.id }).from(terms).where(eq(terms.userId, userId))).map(
    (t) => t.id,
  );
  const courseIds = (
    await inChunks(termIds, (ids) => db.select({ id: courses.id }).from(courses).where(inArray(courses.termId, ids)))
  ).map((row) => row.id);
  const items = await inChunks(courseIds, (ids) =>
    db
      .select({ id: workItems.id, dueAt: workItems.dueAt, availableAt: workItems.availableAt })
      .from(workItems)
      .where(inArray(workItems.courseId, ids)),
  );
  const sessions = await inChunks(
    items.map((i) => i.id),
    (ids) =>
      db
        .select({ id: workSessions.id, startAt: workSessions.startAt, endAt: workSessions.endAt })
        .from(workSessions)
        .where(inArray(workSessions.workItemId, ids)),
  );
  const reported = await inChunks(termIds, (ids) =>
    db
      .select({ id: interruptions.id, startAt: interruptions.startAt, endAt: interruptions.endAt })
      .from(interruptions)
      .where(inArray(interruptions.termId, ids)),
  );

  // Every change, as (table, column, id, to). Only values that actually move.
  type Table = "work_items" | "work_sessions" | "interruptions";
  const changes: { table: Table; column: string; id: string; to: string }[] = [];
  const put = (table: Table, column: string, id: string, before: string | null, after: string | null) => {
    if (before && after && after !== before) changes.push({ table, column, id, to: after });
  };
  for (const item of items) {
    put("work_items", "due_at", item.id, item.dueAt, item.dueAt ? floatingToUtc(item.dueAt, calendar) : null);
    put("work_items", "available_at", item.id, item.availableAt, item.availableAt ? floatingToUtc(item.availableAt, calendar) : null);
  }
  /**
   * A block keeps its length. Converting its start and end separately stretched an hour-long
   * block in the repeated hour on the night the clocks go back into two hours, and shrank one
   * across the spring-forward gap -- while its stored minutes still said sixty. Found in review.
   */
  const span = (row: { id: string; startAt: string | null; endAt: string | null }, table: Table) => {
    if (!row.startAt || !row.endAt) {
      put(table, "start_at", row.id, row.startAt, row.startAt ? floatingToUtc(row.startAt, calendar) : null);
      put(table, "end_at", row.id, row.endAt, row.endAt ? floatingToUtc(row.endAt, calendar) : null);
      return;
    }
    const start = floatingToUtc(row.startAt, calendar);
    const length = Date.parse(row.endAt) - Date.parse(row.startAt);
    if (start === null || !Number.isFinite(length)) return;
    put(table, "start_at", row.id, row.startAt, start);
    put(table, "end_at", row.id, row.endAt, new Date(Date.parse(start) + length).toISOString());
  };
  for (const session of sessions) span(session, "work_sessions");
  for (const row of reported) span(row, "interruptions");

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
    const group = groups.get(key);
    if (group) group.push(change);
    else groups.set(key, [change]);
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
  // The zone the records were read in becomes the account's only when it replaced the sign-up
  // default; a zone the student had is left for the app to compare with the device and ask.
  statements.push(
    adopt
      ? d1
          .prepare("UPDATE users SET time_standard = 1, timezone = ? WHERE id = ? AND time_standard = 0")
          .bind(timeZone, userId)
      : d1.prepare("UPDATE users SET time_standard = 1 WHERE id = ? AND time_standard = 0").bind(userId),
  );

  await d1.batch(statements);
  return changes.length > 0;
}

/** Runs a lookup over ids in chunks small enough for D1's bound-parameter limit. */
async function inChunks<T>(ids: string[], query: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += 90) rows.push(...(await query(ids.slice(i, i + 90))));
  return rows;
}

/**
 * A stored local wall-clock time, as the UTC instant it named; null for a value that is not a
 * time at all.
 *
 * The characters are the student's local date and time of day. A time that never happened (inside
 * a spring-forward gap) moves past the jump, as a clock would; one that happened twice is its first.
 * An unreadable value is left alone rather than thrown on: one bad row must not stop an account's
 * conversion, and with it the account, for good.
 */
export function floatingToUtc(value: string, calendar: ZoneCalendar): string | null {
  const floating = toEpochMinutes(value);
  if (!Number.isFinite(floating) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = value.slice(0, 10);
  const minuteOfDay = floating - dateToEpochMinutes(date);
  const seconds = value.slice(17, 23);
  const converted = fromEpochMinutes(calendar.at(date, minuteOfDay));
  // Keep any seconds the old value carried; the calendar works in whole minutes.
  return /^\d\d\.\d\d\d$/.test(seconds) ? `${converted.slice(0, 17)}${seconds}Z` : converted;
}
