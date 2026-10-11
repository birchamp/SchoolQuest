import { describe, expect, it, vi } from "vitest";
import {
  consume,
  effectiveLimit,
  RATE_LIMITS,
  refusalMessage,
  windowStartFor,
  type CounterStore,
} from "./rate-limit.js";

/** The same semantics as the D1 upsert: one counter per (bucket, window), incremented atomically. */
function memoryStore(): CounterStore & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    async increment(bucketKey, windowStart, onlyBelow) {
      const key = `${bucketKey}@${windowStart}`;
      const current = rows.get(key) ?? 0;
      if (onlyBelow !== undefined && current >= onlyBelow) return null;
      rows.set(key, current + 1);
      return current + 1;
    },
  };
}

/** A store whose every call fails the way D1 does before a migration has created the table. */
function brokenStore(message: string): CounterStore {
  return {
    async increment() {
      throw new Error(message, { cause: new Error(`D1_ERROR: ${message}: SQLITE_ERROR`) });
    },
  };
}

const HOUR_MS = 60 * 60 * 1000;
const rule = { windowSeconds: 3600 };
// An instant 10 minutes into an hour window.
const T0 = 1_800_000 * HOUR_MS + 10 * 60 * 1000;

describe("consume", () => {
  it("allows up to the limit, then refuses", async () => {
    const store = memoryStore();
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await consume(store, "b", rule, 3, T0)).allowed);
    expect(results).toEqual([true, true, true, false]);
  });

  it("keeps refusing a hammered bucket for the rest of the window", async () => {
    const store = memoryStore();
    for (let i = 0; i < 3; i++) await consume(store, "b", rule, 3, T0);
    for (let i = 0; i < 20; i++) {
      expect((await consume(store, "b", rule, 3, T0 + i * 60_000)).allowed).toBe(false);
    }
  });

  it("opens again when the next window starts", async () => {
    const store = memoryStore();
    for (let i = 0; i < 4; i++) await consume(store, "b", rule, 3, T0);
    const nextWindow = windowStartFor(T0, 3600) + HOUR_MS;
    expect((await consume(store, "b", rule, 3, nextWindow)).allowed).toBe(true);
  });

  it("counts each bucket separately", async () => {
    const store = memoryStore();
    for (let i = 0; i < 3; i++) await consume(store, "a", rule, 3, T0);
    expect((await consume(store, "a", rule, 3, T0)).allowed).toBe(false);
    expect((await consume(store, "b", rule, 3, T0)).allowed).toBe(true);
  });

  it("reports the time left in the window as the wait", async () => {
    const store = memoryStore();
    const decision = await consume(store, "b", rule, 0, T0);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(50 * 60);
  });

  it("never reports a zero wait at the very end of a window", async () => {
    const store = memoryStore();
    const end = windowStartFor(T0, 3600) + HOUR_MS - 1;
    expect((await consume(store, "b", rule, 0, end)).retryAfterSeconds).toBe(1);
  });
});

describe("consume, for a rule that does not count refusals", () => {
  const sparing = { windowSeconds: 900, countRefused: false };

  it("allows up to the limit, then refuses", async () => {
    const store = memoryStore();
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await consume(store, "b", sparing, 3, T0)).allowed);
    expect(results).toEqual([true, true, true, false]);
  });

  it("never counts a refused request, so hammering cannot extend or deepen a lockout", async () => {
    const store = memoryStore();
    for (let i = 0; i < 50; i++) await consume(store, "b", sparing, 3, T0);
    expect([...store.rows.values()]).toEqual([3]);
  });
});

describe("consume, before the rate_limits table exists", () => {
  it("fails open: a Worker deployed ahead of its migration still lets people sign in", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const decision = await consume(
      brokenStore('Failed query: insert into "rate_limits" ... no such table: rate_limits'),
      "b",
      rule,
      3,
      T0,
    );
    expect(decision.allowed).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/rate_limits/), expect.anything());
    warn.mockRestore();
  });

  it("finds the missing table in the error's cause, where drizzle puts D1's message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store: CounterStore = {
      async increment() {
        throw new Error("Failed query", {
          cause: new Error("D1_ERROR: no such table: rate_limits"),
        });
      },
    };
    expect((await consume(store, "b", rule, 3, T0)).allowed).toBe(true);
    warn.mockRestore();
  });

  it("still fails on any other database error", async () => {
    await expect(consume(brokenStore("database is locked"), "b", rule, 3, T0)).rejects.toThrow(
      /locked/,
    );
  });
});

describe("windowStartFor", () => {
  it("floors to the window and is stable inside it", () => {
    const start = windowStartFor(T0, 3600);
    expect(start % HOUR_MS).toBe(0);
    expect(windowStartFor(start + HOUR_MS - 1, 3600)).toBe(start);
    expect(windowStartFor(start + HOUR_MS, 3600)).toBe(start + HOUR_MS);
  });
});

describe("limits", () => {
  it("relaxes but does not remove limits in dev mode", () => {
    const login = RATE_LIMITS.loginEmail;
    expect(effectiveLimit(login, false)).toBe(login.limit);
    expect(effectiveLimit(login, true)).toBeGreaterThan(login.limit);
    expect(Number.isFinite(effectiveLimit(login, true))).toBe(true);
  });

  it("gives every rule a positive limit, a window and a message", () => {
    for (const r of Object.values(RATE_LIMITS)) {
      expect(r.limit).toBeGreaterThan(0);
      expect(r.windowSeconds).toBeGreaterThan(0);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("lets more sign-ins through per network than per address", () => {
    expect(RATE_LIMITS.loginIp.limit).toBeGreaterThan(RATE_LIMITS.loginEmail.limit);
  });

  it("keeps a per-address lockout brief, and never counts refusals against an address", () => {
    // Anyone can type a victim's address, so this limit is reachable by a stranger. It must not
    // lock the owner out for long, and a stranger's refused requests must not keep it shut.
    expect(RATE_LIMITS.loginEmail.windowSeconds).toBeLessThanOrEqual(15 * 60);
    expect(RATE_LIMITS.loginEmail.countRefused).toBe(false);
  });
});

describe("refusalMessage", () => {
  it("says how long to wait in minutes", () => {
    expect(refusalMessage(RATE_LIMITS.coach, 50 * 60)).toMatch(
      /wait about 50 minutes and try again\.$/,
    );
    expect(refusalMessage(RATE_LIMITS.coach, 30)).toMatch(/wait about a minute and try again\.$/);
  });
});
