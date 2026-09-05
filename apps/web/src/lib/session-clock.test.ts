import { describe, expect, it } from "vitest";
import { minutesBetween } from "./session-clock";

describe("minutesBetween", () => {
  const now = new Date("2026-09-05T10:45:30Z");

  it("counts whole minutes since the start", () => {
    expect(minutesBetween("2026-09-05T10:20:00Z", now)).toBe(25);
  });

  it("rounds down, so a block started fifty seconds ago has run for zero minutes", () => {
    expect(minutesBetween("2026-09-05T10:44:40Z", now)).toBe(0);
  });

  it("is null when this device never saw the session start", () => {
    expect(minutesBetween(null, now)).toBeNull();
  });

  it("is null rather than NaN for a value that is not a date", () => {
    expect(minutesBetween("yesterday-ish", now)).toBeNull();
  });

  it("never goes negative when the clock has moved backwards", () => {
    expect(minutesBetween("2026-09-05T11:00:00Z", now)).toBe(0);
  });
});
