import { describe, expect, it } from "vitest";
import { isOpenOnDay } from "./lost-day.js";

describe("isOpenOnDay", () => {
  const day = "2026-09-08";
  it("takes every planned or started block on the day, morning to midnight", () => {
    expect(isOpenOnDay({ startAt: "2026-09-08T00:15:00.000Z", status: "planned" }, day)).toBe(true);
    expect(isOpenOnDay({ startAt: "2026-09-08T23:30:00.000Z", status: "started" }, day)).toBe(true);
  });
  it("leaves finished, skipped and released blocks as they are", () => {
    for (const status of ["completed", "partial", "skipped", "missed", "released", "moved"]) {
      expect(isOpenOnDay({ startAt: "2026-09-08T10:00:00.000Z", status }, day)).toBe(false);
    }
  });
  it("does not reach into the next or previous day", () => {
    expect(isOpenOnDay({ startAt: "2026-09-09T00:00:00.000Z", status: "planned" }, day)).toBe(false);
    expect(isOpenOnDay({ startAt: "2026-09-07T23:59:00.000Z", status: "planned" }, day)).toBe(false);
  });
});
