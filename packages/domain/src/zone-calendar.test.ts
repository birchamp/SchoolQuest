import { describe, expect, it } from "vitest";
import { fromEpochMinutes, toEpochMinutes, zoneCalendar } from "./time.js";

const at = (iso: string) => toEpochMinutes(iso);

describe("zoneCalendar", () => {
  it("is plain UTC for UTC, for a missing zone, and for one it does not know", () => {
    for (const zone of ["UTC", null, "Mars/Olympus_Mons"]) {
      const cal = zoneCalendar(zone);
      expect(cal.dayStart("2026-10-10")).toBe(at("2026-10-10T00:00:00Z"));
      expect(cal.dateOf(at("2026-10-10T23:30:00Z"))).toBe("2026-10-10");
    }
  });

  it("puts a Chicago student's day where it begins in Chicago", () => {
    const chicago = zoneCalendar("America/Chicago");
    // CDT, UTC-5, in October.
    expect(fromEpochMinutes(chicago.dayStart("2026-10-10"))).toBe("2026-10-10T05:00:00.000Z");
    expect(fromEpochMinutes(chicago.at("2026-10-10", 9 * 60))).toBe("2026-10-10T14:00:00.000Z");
    // 02:00 UTC on the 11th is still the evening of the 10th, a Saturday, in Chicago.
    expect(chicago.dateOf(at("2026-10-11T02:00:00Z"))).toBe("2026-10-10");
    expect(chicago.dayOfWeek(at("2026-10-11T02:00:00Z"))).toBe(6);
    expect(chicago.minuteOfDay(at("2026-10-11T02:00:00Z"))).toBe(21 * 60);
  });

  it("goes the other way for Tokyo, which is ahead", () => {
    const tokyo = zoneCalendar("Asia/Tokyo");
    expect(fromEpochMinutes(tokyo.dayStart("2026-10-10"))).toBe("2026-10-09T15:00:00.000Z");
    expect(tokyo.dateOf(at("2026-10-09T20:00:00Z"))).toBe("2026-10-10");
  });

  it("keeps a nine o'clock class at nine across the end of daylight saving", () => {
    const ny = zoneCalendar("America/New_York");
    // Clocks go back at 2am on Sunday 1 November 2026.
    expect(fromEpochMinutes(ny.at("2026-10-30", 9 * 60))).toBe("2026-10-30T13:00:00.000Z");
    expect(fromEpochMinutes(ny.at("2026-11-02", 9 * 60))).toBe("2026-11-02T14:00:00.000Z");
    // That Sunday has twenty-five hours.
    expect(ny.dayStart("2026-11-02") - ny.dayStart("2026-11-01")).toBe(25 * 60);
    // 1:30 happens twice; the first one is meant.
    expect(fromEpochMinutes(ny.at("2026-11-01", 90))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("moves a time inside the spring-forward gap past the jump", () => {
    const ny = zoneCalendar("America/New_York");
    // Clocks jump from 2:00 to 3:00 on Sunday 14 March 2027; 2:30 does not exist.
    expect(fromEpochMinutes(ny.at("2027-03-14", 150))).toBe("2027-03-14T07:30:00.000Z");
    expect(ny.minuteOfDay(ny.at("2027-03-14", 150))).toBe(3 * 60 + 30);
    // And that Sunday has twenty-three hours.
    expect(ny.dayStart("2027-03-15") - ny.dayStart("2027-03-14")).toBe(23 * 60);
  });

  it("handles a zone on a half-hour offset", () => {
    const india = zoneCalendar("Asia/Kolkata");
    expect(fromEpochMinutes(india.at("2026-10-10", 9 * 60))).toBe("2026-10-10T03:30:00.000Z");
    expect(india.minuteOfDay(at("2026-10-10T03:30:00Z"))).toBe(9 * 60);
  });
});
