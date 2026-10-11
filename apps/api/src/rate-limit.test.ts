import { describe, expect, it } from "vitest";
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
    async increment(bucketKey, windowStart) {
      const key = `${bucketKey}@${windowStart}`;
      const next = (rows.get(key) ?? 0) + 1;
      rows.set(key, next);
      return next;
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
});

describe("refusalMessage", () => {
  it("says how long to wait in minutes", () => {
    expect(refusalMessage(RATE_LIMITS.coach, 50 * 60)).toMatch(/wait about 50 minutes and try again\.$/);
    expect(refusalMessage(RATE_LIMITS.coach, 30)).toMatch(/wait about a minute and try again\.$/);
  });
});
