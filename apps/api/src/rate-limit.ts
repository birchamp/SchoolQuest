import { lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context, MiddlewareHandler } from "hono";
import { rateLimits } from "./db/schema.js";
import { isDevMode, type AppBindings } from "./env.js";

/**
 * Fixed-window rate limiting, counted in D1.
 *
 * Two things in this API cost real money or reach real people per request: a sign-in sends an
 * email through Resend, and the AI routes spend an OpenRouter key. Neither had a ceiling, so a
 * loop could flood any inbox with sign-in links or run up a bill overnight.
 *
 * Fixed windows rather than a sliding log: one upsert per request, one row per bucket per window,
 * which keeps the write count well inside D1's free tier. The cost is that a burst straddling a
 * window boundary can reach twice the limit, which is fine for limits this generous -- they are a
 * ceiling on abuse, not a meter on use.
 */

export interface RateRule {
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
  /** Plain-language reason, shown to the student; the wait is appended. */
  message: string;
  /**
   * Whether a refused request still counts. True by default: a client hammering its own bucket
   * gains nothing. False for a bucket a stranger can fill on someone else's behalf, where every
   * counted refusal is lockout time inflicted on the bucket's owner.
   */
  countRefused?: boolean;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * Every limit in one place. Tuned so a real student never meets one: the busiest honest session
 * we can picture -- a term set up in an evening, a dozen syllabi re-read, a long talk with the
 * coach -- stays well under each. Raise a number here if that ever stops being true.
 */
export const RATE_LIMITS = {
  /**
   * Sign-in links sent to one address. A student retrying a slow inbox needs three or four.
   *
   * Anyone can type anyone's address, so a stranger can reach this limit for a victim. It is
   * shaped to make that cheap to recover from: a short window, so a lockout lasts minutes rather
   * than an hour, and only requests it lets through count -- a refused one never does, so the
   * stranger cannot keep the address locked by continuing to send. Sustained abuse from one
   * source is the per-network rule's job.
   */
  loginEmail: {
    limit: 5,
    windowSeconds: 15 * MINUTE,
    countRefused: false,
    message:
      "Too many sign-in links have been sent to that address. Check your inbox (and spam) for the last one",
  },
  /**
   * Sign-in requests from one network address, whatever the email. Higher than per-email because
   * a campus or household network puts many students behind one address.
   */
  loginIp: {
    limit: 60,
    windowSeconds: HOUR,
    message: "Too many sign-in requests have come from this network",
  },
  coach: {
    limit: 60,
    windowSeconds: HOUR,
    message: "That is a lot of coach messages for one hour. Your plan still works without it",
  },
  syllabusExtract: {
    limit: 30,
    windowSeconds: HOUR,
    message: "That is a lot of syllabus readings for one hour",
  },
  calendarPaste: {
    limit: 20,
    windowSeconds: HOUR,
    message: "That is a lot of calendar readings for one hour",
  },
  coursePaste: {
    limit: 20,
    windowSeconds: HOUR,
    message: "That is a lot of course-list readings for one hour",
  },
} satisfies Record<string, RateRule>;

export type RateRuleName = keyof typeof RATE_LIMITS;

/**
 * A local run gets ten times the headroom. The e2e and screenshot scripts sign in as the same
 * address over and over against one dev server, and a developer iterating on the coach can send
 * more than a student would. Still on, so the limiter is exercised by every local run.
 */
const DEV_MODE_MULTIPLIER = 10;

export function effectiveLimit(rule: RateRule, devMode: boolean): number {
  return devMode ? rule.limit * DEV_MODE_MULTIPLIER : rule.limit;
}

export function windowStartFor(nowMs: number, windowSeconds: number): number {
  const size = windowSeconds * 1000;
  return Math.floor(nowMs / size) * size;
}

/**
 * Atomically adds one to a bucket's count for a window and returns the new count. Given
 * `onlyBelow`, adds one only while the count is below it, and returns null -- having changed
 * nothing -- when it is not.
 */
export interface CounterStore {
  increment(bucketKey: string, windowStart: number, onlyBelow?: number): Promise<number | null>;
}

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the window resets; meaningful only when refused. */
  retryAfterSeconds: number;
}

/**
 * Counts this request against the bucket and decides. By default every attempt counts, refused
 * ones included, so hammering a closed bucket does not reopen it any sooner -- but the window
 * still ends on schedule. A rule with `countRefused: false` counts only what it allows.
 *
 * If the counter table does not exist the request is allowed. That is a Worker deployed ahead of
 * migration 0011, and refusing there would take sign-in down for everyone over a missing ceiling.
 */
export async function consume(
  store: CounterStore,
  bucketKey: string,
  rule: Pick<RateRule, "windowSeconds" | "countRefused">,
  limit: number,
  nowMs: number,
): Promise<RateDecision> {
  const windowStart = windowStartFor(nowMs, rule.windowSeconds);
  const windowEnd = windowStart + rule.windowSeconds * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - nowMs) / 1000));

  let count: number | null;
  try {
    count =
      rule.countRefused === false
        ? await store.increment(bucketKey, windowStart, limit)
        : await store.increment(bucketKey, windowStart);
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    console.warn(
      "[rate-limit] rate_limits table is missing; allowing the request. Apply migration 0011.",
      bucketKey.split(":")[0],
    );
    return { allowed: true, retryAfterSeconds };
  }
  return { allowed: count !== null && count <= limit, retryAfterSeconds };
}

/** D1's "no such table", wherever in the cause chain drizzle left it. */
function isMissingTable(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < 5; depth++) {
    if (/no such table:?\s*`?"?rate_limits/i.test(e.message)) return true;
    e = e.cause;
  }
  return false;
}

/** The refusal body, with the wait in words a person reads rather than a header they don't. */
export function refusalMessage(rule: RateRule, retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const wait = minutes <= 1 ? "about a minute" : `about ${minutes} minutes`;
  return `${rule.message}. Please wait ${wait} and try again.`;
}

/** Rows older than this are dead weight; the longest window is an hour. */
const RETAIN_MS = 24 * HOUR * 1000;

export function d1CounterStore(db: D1Database, nowMs: number): CounterStore {
  const orm = drizzle(db);
  return {
    async increment(bucketKey, windowStart, onlyBelow) {
      // With `onlyBelow`, the upsert's own WHERE skips the update at the ceiling, so no row comes
      // back -- one statement, so two concurrent requests cannot both slip under it.
      const [row] = await orm
        .insert(rateLimits)
        .values({ bucketKey, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [rateLimits.bucketKey, rateLimits.windowStart],
          set: { count: sql`${rateLimits.count} + 1` },
          ...(onlyBelow === undefined ? {} : { setWhere: sql`${rateLimits.count} < ${onlyBelow}` }),
        })
        .returning({ count: rateLimits.count });
      if (!row) return null;
      const count = row.count;
      // Opportunistic cleanup, as login_tokens does, so the table never needs a cron job. Only
      // on the first hit of a new window, so it runs at most once per bucket per window.
      if (count === 1) {
        await orm.delete(rateLimits).where(lt(rateLimits.windowStart, nowMs - RETAIN_MS));
      }
      return count;
    },
  };
}

/**
 * The bucket key never holds the raw subject. A hash is enough to count by, and it keeps the
 * table from becoming a record of which addresses tried to sign in from which networks.
 */
async function bucketKeyFor(name: RateRuleName, subject: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:${name}:${subject}`),
  );
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${name}:${hex.slice(0, 32)}`;
}

/**
 * Checks one rule for one subject. Returns null when allowed, or a ready 429 response.
 */
export async function limitOrRefuse(
  c: Context<AppBindings>,
  name: RateRuleName,
  subject: string,
): Promise<Response | null> {
  const rule = RATE_LIMITS[name];
  const now = Date.now();
  const decision = await consume(
    d1CounterStore(c.env.DB, now),
    await bucketKeyFor(name, subject, c.env.AUTH_SECRET),
    rule,
    effectiveLimit(rule, isDevMode(c.env)),
    now,
  );
  if (decision.allowed) return null;
  c.header("Retry-After", String(decision.retryAfterSeconds));
  return c.json({ error: refusalMessage(rule, decision.retryAfterSeconds) }, 429);
}

/** The caller's address as Cloudflare reports it. Absent only outside Cloudflare's edge. */
export function clientIp(c: Context<AppBindings>): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

/** Per-user limit for an authenticated route. Mount after `requireAuth`. */
export function rateLimitPerUser(name: RateRuleName): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const refused = await limitOrRefuse(c, name, c.get("userId"));
    if (refused) return refused;
    await next();
  };
}
