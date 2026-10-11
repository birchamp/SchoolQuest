import { afterEach, describe, expect, it } from "vitest";
import { fromLocal, localDate, localTime, planIsStale, setPlanTimeZone } from "./clock.js";

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
