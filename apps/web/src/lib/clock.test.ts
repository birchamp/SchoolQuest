import { describe, expect, it } from "vitest";
import { planIsStale, wallClockNow } from "./clock.js";

describe("planIsStale", () => {
  it("rebuilds a plan whose week has ended", () => {
    expect(planIsStale({ horizonEnd: "2026-10-17", createdAt: "2026-10-10T08:00:00.000Z" }, "2026-10-18")).toBe(true);
    expect(planIsStale({ horizonEnd: "2026-10-17" }, "2026-10-17")).toBe(true);
  });

  it("rebuilds a plan made on an earlier day, so missed blocks get their time back", () => {
    expect(planIsStale({ horizonEnd: "2026-10-17", createdAt: "2026-10-10T21:00:00.000Z" }, "2026-10-11")).toBe(true);
  });

  it("keeps a plan made today", () => {
    expect(planIsStale({ horizonEnd: "2026-10-17", createdAt: "2026-10-10T08:00:00.000Z" }, "2026-10-10")).toBe(false);
  });
});

describe("wallClockNow", () => {
  it("writes the local time of day with a Z, as every stored time is written", () => {
    const at = new Date("2026-10-10T23:30:00.000Z");
    const local = wallClockNow(at);
    // Whatever zone the test runs in, the hours shown are the local ones.
    expect(Number(local.slice(11, 13))).toBe(at.getHours());
    expect(Number(local.slice(8, 10))).toBe(at.getDate());
  });
});
