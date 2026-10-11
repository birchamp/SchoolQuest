import { describe, expect, it } from "vitest";
import { USAGE_EVENTS, USAGE_MAX_COUNT, USAGE_MAX_KEYS, type UsageEvent } from "@schoolquest/domain";
import {
  cleanCounts,
  D1_MAX_PARAMS,
  recordUsage,
  retentionCutoff,
  upsertStatements,
  usageBody,
  usageSubject,
  utcDay,
} from "./usage.js";

const SECRET = "usage-test-secret";

describe("the usage report body", () => {
  it("accepts a map of names to counts", () => {
    expect(usageBody.safeParse({ events: { "tab.week": 2 } }).success).toBe(true);
  });

  it("refuses a report with more keys than the cap", () => {
    const events = Object.fromEntries(
      Array.from({ length: USAGE_MAX_KEYS + 1 }, (_, i) => [`x${i}`, 1]),
    );
    expect(usageBody.safeParse({ events }).success).toBe(false);
  });

  it("refuses anything that is not { events: {...} }", () => {
    expect(usageBody.safeParse(null).success).toBe(false);
    expect(usageBody.safeParse({ events: ["tab.week"] }).success).toBe(false);
  });
});

describe("cleaning counts", () => {
  it("drops names that are not on the allowlist", () => {
    const clean = cleanCounts({ "tab.week": 1, "course.Biology": 3, "tab.radar; DROP": 1 });
    expect([...clean.keys()]).toEqual(["tab.week"]);
  });

  it("clamps, floors, and drops counts that are not positive numbers", () => {
    const clean = cleanCounts({
      "tab.week": 1e9,
      "tab.radar": 2.7,
      "tab.today": 0,
      "tab.stats": -4,
      "tab.coach": "5",
      "tab.setup": Number.NaN,
    });
    expect(Object.fromEntries(clean)).toEqual({ "tab.week": USAGE_MAX_COUNT, "tab.radar": 2 });
  });
});

describe("the subject", () => {
  it("is an HMAC of the user id, not the id, and stable", async () => {
    const a = await usageSubject("user-123", SECRET);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("user-123");
    expect(await usageSubject("user-123", SECRET)).toBe(a);
  });

  it("differs per user and per secret", async () => {
    const a = await usageSubject("user-123", SECRET);
    expect(await usageSubject("user-124", SECRET)).not.toBe(a);
    expect(await usageSubject("user-123", "another-secret")).not.toBe(a);
  });

  it("is not a plain SHA-256 of the id, which anyone with the users table could recompute", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("user-123"));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await usageSubject("user-123", SECRET)).not.toBe(hex);
  });
});

describe("days", () => {
  it("are UTC dates", () => {
    // 23:30 in New York on 10 Oct is already 11 Oct in UTC.
    expect(utcDay(Date.parse("2026-10-11T03:30:00Z"))).toBe("2026-10-11");
  });

  it("keep 180 days", () => {
    expect(retentionCutoff(Date.parse("2026-10-11T12:00:00Z"))).toBe("2026-04-14");
  });
});

describe("upsert statements", () => {
  it("never bind more than D1's 100 parameters, and cover every row", () => {
    const counts = new Map(USAGE_EVENTS.map((e) => [e, 1] as [UsageEvent, number]));
    // More rows than fit one statement, whatever the allowlist's current length.
    expect(counts.size).toBeGreaterThan(25);
    const statements = upsertStatements("2026-10-11", "s", counts);
    expect(statements.length).toBeGreaterThan(1);
    for (const s of statements) {
      expect(s.params.length).toBeLessThanOrEqual(D1_MAX_PARAMS);
      expect(s.sql.split("?").length - 1).toBe(s.params.length);
    }
    const events = statements.flatMap((s) => s.params.filter((_, i) => i % 4 === 1));
    expect(events.sort()).toEqual([...USAGE_EVENTS].sort());
  });

  it("add to an existing count rather than replacing it", () => {
    const [s] = upsertStatements("2026-10-11", "s", new Map([["tab.week", 3]]));
    expect(s!.sql).toContain("ON CONFLICT (day, event, subject) DO UPDATE SET count = usage_daily.count + excluded.count");
    expect(s!.params).toEqual(["2026-10-11", "tab.week", "s", 3]);
  });
});

/** Enough of D1 to see what one report sends. */
function fakeD1() {
  const batches: { sql: string; params: unknown[] }[][] = [];
  const db = {
    prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ sql, params }) }),
    batch: async (statements: { sql: string; params: unknown[] }[]) => {
      batches.push(statements);
      return [];
    },
  };
  return { db: db as unknown as D1Database, batches };
}

describe("recording a report", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");

  it("writes in one batch, keyed by the HMAC subject", async () => {
    const { db, batches } = fakeD1();
    await recordUsage(db, {
      userId: "user-123",
      authSecret: SECRET,
      counts: new Map([["tab.week", 2]]),
      nowMs: now,
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    const params = batches[0]![0]!.params;
    expect(params).toEqual(["2026-10-11", "tab.week", await usageSubject("user-123", SECRET), 2]);
    expect(params).not.toContain("user-123");
  });

  it("prunes rows past the window on every write, in the same batch", async () => {
    const { db, batches } = fakeD1();
    await recordUsage(db, {
      userId: "u",
      authSecret: SECRET,
      counts: new Map([["tab.week", 1]]),
      nowMs: now,
    });
    expect(batches[0]!.at(-1)).toEqual({
      sql: "DELETE FROM usage_daily WHERE day < ?",
      params: ["2026-04-14"],
    });
  });

  it("writes nothing for an empty report", async () => {
    const { db, batches } = fakeD1();
    await recordUsage(db, { userId: "u", authSecret: SECRET, counts: new Map(), nowMs: now });
    expect(batches).toHaveLength(0);
  });
});
