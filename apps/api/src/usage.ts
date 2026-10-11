import { z } from "zod";
import { isUsageEvent, USAGE_MAX_COUNT, USAGE_MAX_KEYS, type UsageEvent } from "@schoolquest/domain";

/**
 * The usage log: which screens and controls get used, counted per UTC day.
 *
 * ## What is kept
 *
 * `usage_daily(day, event, subject, count)` and nothing else. `event` is a name from the shared
 * allowlist (`USAGE_EVENTS`); anything else is dropped before it reaches the database. `subject`
 * is an HMAC of the user id, so the owner can count distinct people ("how many students opened
 * the radar this month") without the table naming anyone. There is no column a course name, a
 * message, or anything typed could land in.
 *
 * ## Why an HMAC rather than a hash
 *
 * User ids are random, but a plain hash of one is still a stable pseudonym anybody holding the
 * users table can reverse by hashing every id. Keying it with a secret only the Worker holds means
 * a copy of the database alone cannot join usage rows back to accounts. The key is derived from
 * `AUTH_SECRET` with HKDF and its own info string -- the same pattern as `secrets.ts` -- so it is
 * a different key from the one signing sessions or sealing provider keys.
 *
 * ## Failure
 *
 * Nothing here is worth an error on a student's screen. The route logs and answers 204 on any
 * database failure, a missing table included (a Worker deployed ahead of migration 0012).
 */

/** Rows older than this are deleted, opportunistically, as new counts are written. */
export const RETENTION_DAYS = 180;
/** Share of writes that also prune old rows. One in a hundred keeps the table trimmed for free. */
export const PRUNE_PROBABILITY = 0.01;

/**
 * The body as sent. Values are loosely typed on purpose: one malformed count should cost only
 * itself, not the rest of the report, so they are cleaned in `cleanCounts` rather than refused.
 */
export const usageBody = z.object({
  events: z
    .record(z.string().max(64), z.unknown())
    .refine((events) => Object.keys(events).length <= USAGE_MAX_KEYS, "Too many events"),
});

/**
 * Only allowlisted names, each with a whole count clamped to 1..USAGE_MAX_COUNT. Anything that
 * is not a positive finite number is dropped rather than guessed at.
 */
export function cleanCounts(events: Record<string, unknown>): Map<UsageEvent, number> {
  const clean = new Map<UsageEvent, number>();
  for (const [name, raw] of Object.entries(events)) {
    if (!isUsageEvent(name)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const count = Math.min(USAGE_MAX_COUNT, Math.floor(raw));
    if (count < 1) continue;
    clean.set(name, count);
  }
  return clean;
}

/** The UTC calendar date of an instant, "YYYY-MM-DD". */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** The first day still kept; rows with an earlier `day` are pruned. */
export function retentionCutoff(nowMs: number): string {
  return utcDay(nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

async function subjectKey(authSecret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authSecret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      // Separates this key from every other use of AUTH_SECRET (see secrets.ts).
      info: new TextEncoder().encode("schoolquest:usage-subject:v1"),
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

/** HMAC-SHA256 of the user id, hex. Stable per user and secret; never the id itself. */
export async function usageSubject(userId: string, authSecret: string): Promise<string> {
  const key = await subjectKey(authSecret);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(userId));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Statement {
  sql: string;
  params: (string | number)[];
}

/** D1 refuses a statement with more than 100 bound parameters. */
export const D1_MAX_PARAMS = 100;
const PARAMS_PER_ROW = 4;
export const ROWS_PER_STATEMENT = Math.floor(D1_MAX_PARAMS / PARAMS_PER_ROW);

/**
 * Upsert-increments, chunked so no statement binds more than D1 allows. Each row adds its count
 * to whatever is already there for that day, event and person.
 */
export function upsertStatements(
  day: string,
  subject: string,
  counts: ReadonlyMap<UsageEvent, number>,
): Statement[] {
  const rows = [...counts];
  const statements: Statement[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
    statements.push({
      sql:
        "INSERT INTO usage_daily (day, event, subject, count) VALUES " +
        chunk.map(() => "(?, ?, ?, ?)").join(", ") +
        " ON CONFLICT (day, event, subject) DO UPDATE SET count = usage_daily.count + excluded.count",
      params: chunk.flatMap(([event, count]) => [day, event, subject, count]),
    });
  }
  return statements;
}

export function pruneStatement(nowMs: number): Statement {
  return { sql: "DELETE FROM usage_daily WHERE day < ?", params: [retentionCutoff(nowMs)] };
}

/**
 * Writes one report in a single D1 batch, pruning old rows on roughly one write in a hundred.
 * Throws on database failure; the route decides that nobody needs to hear about it.
 */
export async function recordUsage(
  db: D1Database,
  input: {
    userId: string;
    authSecret: string;
    counts: ReadonlyMap<UsageEvent, number>;
    nowMs: number;
    random?: () => number;
  },
): Promise<void> {
  if (input.counts.size === 0) return;
  const subject = await usageSubject(input.userId, input.authSecret);
  const statements = upsertStatements(utcDay(input.nowMs), subject, input.counts);
  if ((input.random ?? Math.random)() < PRUNE_PROBABILITY) statements.push(pruneStatement(input.nowMs));
  await db.batch(statements.map((s) => db.prepare(s.sql).bind(...s.params)));
}
