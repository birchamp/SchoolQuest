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

describe("zoneCalendar, found in review", () => {
  it("is exact in a zone whose clocks change at half past", () => {
    // Lord Howe Island moves from +10:30 to +11 at 2am local on 4 October 2026, i.e. 15:30 UTC
    // on the 3rd -- half past, not on the hour.
    const lordHowe = zoneCalendar("Australia/Lord_Howe");
    expect(lordHowe.offset(at("2026-10-03T15:20:00Z"))).toBe(630);
    expect(lordHowe.offset(at("2026-10-03T15:40:00Z"))).toBe(660);
  });

  it("knows where a day starts when its midnight does not exist", () => {
    // Santiago springs forward at midnight; 6 September 2026 starts at 1am.
    const santiago = zoneCalendar("America/Santiago");
    const start = santiago.dayStart("2026-09-06");
    // The label says where the day starts, so that is what is checked: at 1am (04:00 UTC), not
    // merely somewhere on the right date.
    expect(fromEpochMinutes(start)).toBe("2026-09-06T04:00:00.000Z");
    expect(santiago.minuteOfDay(start)).toBe(60);
    expect(santiago.dateOf(start)).toBe("2026-09-06");
    expect(santiago.dateOf(start - 1)).toBe("2026-09-05");
  });
});

describe("offsets at every minute, not only on the quarter hour", () => {
  /** The offset straight from `Intl`, independently of the calendar's cache. */
  function direct(timeZone: string, epochMinutes: number): number {
    const at = epochMinutes * 60_000;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      })
        .formatToParts(new Date(at))
        .map((p) => [p.type, p.value]),
    );
    const local = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!);
    return Math.round((local - at) / 60_000);
  }

  it.each([
    // Dublin left Dublin Mean Time (+0:34:39) for Greenwich at 02:25:21 UTC: no quarter hour.
    ["Europe/Dublin", "1916-10-01T01:00:00.000Z"],
    // Lord Howe Island moves its clocks by half an hour, at 2am.
    ["Australia/Lord_Howe", "2026-10-03T14:00:00.000Z"],
    ["America/Chicago", "2026-11-01T05:00:00.000Z"],
  ])("agrees with Intl around a transition in %s", (timeZone, from) => {
    const calendar = zoneCalendar(timeZone);
    const start = toEpochMinutes(from);
    const wrong: number[] = [];
    for (let m = start; m < start + 4 * 60; m += 1) {
      if (calendar.offset(m) !== direct(timeZone, m)) wrong.push(m);
    }
    expect(wrong).toEqual([]);
  });
});
