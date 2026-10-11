import { afterEach, describe, expect, it, vi } from "vitest";
import {
  devNow,
  formatTime,
  fromLocal,
  localDate,
  localTime,
  planIsStale,
  planTimeZone,
  setPlanTimeZone,
} from "./clock.js";

describe("planIsStale", () => {
  afterEach(() => setPlanTimeZone(null));

  it("rebuilds a plan whose week has ended", () => {
    setPlanTimeZone("UTC");
    expect(planIsStale({ horizonEnd: "2026-10-17", createdAt: "2026-10-10T08:00:00.000Z" }, "2026-10-18")).toBe(true);
    expect(planIsStale({ horizonEnd: "2026-10-17" }, "2026-10-17")).toBe(true);
  });

  it("rebuilds a plan made on an earlier day, so missed blocks get their time back", () => {
    setPlanTimeZone("UTC");
    expect(planIsStale({ horizonEnd: "2026-10-17", createdAt: "2026-10-10T21:00:00.000Z" }, "2026-10-11")).toBe(true);
  });

  it("keeps a plan made today", () => {
    setPlanTimeZone("UTC");
    expect(planIsStale({ horizonEnd: "2026-10-17", createdAt: "2026-10-10T08:00:00.000Z" }, "2026-10-10")).toBe(false);
  });

  it("reads the plan's day in the student's zone, not Greenwich's", () => {
    // Made at 9pm on the 10th in Chicago, which is already the 11th in UTC: still today's plan.
    setPlanTimeZone("America/Chicago");
    expect(planIsStale({ horizonEnd: "2026-10-17", createdAt: "2026-10-11T02:00:00.000Z" }, "2026-10-10")).toBe(false);
  });
});

describe("the view edge", () => {
  afterEach(() => setPlanTimeZone(null));

  it("converts both ways in the student's zone", () => {
    setPlanTimeZone("America/Los_Angeles");
    const instant = fromLocal("2026-10-10", "21:30");
    expect(instant).toBe("2026-10-11T04:30:00.000Z");
    expect(localDate(instant)).toBe("2026-10-10");
    expect(localTime(instant)).toBe("21:30");
  });
});

describe("found in review", () => {
  afterEach(() => {
    setPlanTimeZone(null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("ignores a zone this browser does not know, rather than crashing every screen", () => {
    setPlanTimeZone("Mars/Olympus_Mons");
    expect(planTimeZone()).not.toBe("Mars/Olympus_Mons");
    expect(() => formatTime("2026-10-10T14:00:00.000Z")).not.toThrow();
  });

  it("never reads a simulated clock in a production build", () => {
    const store = new Map([["sq_dev_now", "2026-12-01T09:00:00.000Z"]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null });
    vi.stubEnv("DEV", true);
    expect(devNow()).toBe("2026-12-01T09:00:00.000Z");
    vi.stubEnv("DEV", false);
    expect(devNow()).toBeNull();
  });
});
