import { describe, expect, it } from "vitest";
import { isTimeZone, wallClockNow } from "./wall-clock.js";

describe("wallClockNow", () => {
  const at = new Date("2026-10-11T01:30:15.250Z");

  it("writes the student's local time in the app's Z-suffixed frame", () => {
    // 01:30 in Greenwich is 18:30 the evening before in Los Angeles (PDT, UTC-7).
    expect(wallClockNow("America/Los_Angeles", at)).toBe("2026-10-10T18:30:15.250Z");
    expect(wallClockNow("Pacific/Honolulu", at)).toBe("2026-10-10T15:30:15.250Z");
    expect(wallClockNow("Asia/Tokyo", at)).toBe("2026-10-11T10:30:15.250Z");
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // New York is UTC-4 in October and UTC-5 in December.
    expect(wallClockNow("America/New_York", new Date("2026-10-10T12:00:00.000Z")).slice(11, 16)).toBe("08:00");
    expect(wallClockNow("America/New_York", new Date("2026-12-10T12:00:00.000Z")).slice(11, 16)).toBe("07:00");
  });

  it("falls back to UTC, the old behaviour, for a zone it does not know", () => {
    expect(wallClockNow("Mars/Olympus_Mons", at)).toBe(at.toISOString());
    expect(wallClockNow(null, at)).toBe(at.toISOString());
    expect(wallClockNow("UTC", at)).toBe(at.toISOString());
  });
});

describe("isTimeZone", () => {
  it("accepts IANA names and rejects anything else", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("not a zone")).toBe(false);
  });
});
