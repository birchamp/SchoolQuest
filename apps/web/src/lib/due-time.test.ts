import { describe, expect, it } from "vitest";
import {
  composeDueAt,
  DEFAULT_DUE_TIME,
  dueDatePart,
  dueTimePart,
  isDefaultDueTime,
} from "./due-time";

/**
 * The bug these guard: the due cell wrote `${date}T23:59:00.000Z` unconditionally, so no student
 * could say a quiz closes at 9am. The pairing that matters is split-then-compose -- the row reads
 * the two halves out of the stored instant, hands them to two inputs, and joins them back on
 * every save. If that round trip is not exact, editing the date silently moves the time, or
 * editing the time silently moves the date.
 */
describe("due time", () => {
  it("splits a stored instant into the halves the two inputs show", () => {
    expect(dueDatePart("2026-10-05T09:00:00.000Z")).toBe("2026-10-05");
    expect(dueTimePart("2026-10-05T09:00:00.000Z")).toBe("09:00");
  });

  it("round trips: splitting and rejoining changes nothing", () => {
    const stored = "2026-10-05T09:30:00.000Z";
    expect(composeDueAt(dueDatePart(stored), dueTimePart(stored))).toBe(stored);
  });

  it("keeps the day the characters say, not the reader's local day", () => {
    // Formatted through a Date in, say, UTC+9 this instant is the 6th. The row prints the 5th
    // everywhere else in the app, and the time box must agree with the date box beside it.
    expect(dueDatePart("2026-10-05T23:59:00.000Z")).toBe("2026-10-05");
  });

  it("reads an undated item as no date and the end-of-day default", () => {
    expect(dueDatePart(null)).toBe("");
    expect(dueTimePart(null)).toBe(DEFAULT_DUE_TIME);
  });

  it("falls back to end of day rather than showing a blank clock", () => {
    // Older rows, and anything a future writer stores as a bare date.
    expect(dueTimePart("2026-10-05")).toBe(DEFAULT_DUE_TIME);
    expect(dueTimePart("2026-10-05Tnonsense")).toBe(DEFAULT_DUE_TIME);
  });

  it("writes end of day when a date is given with no time", () => {
    expect(composeDueAt("2026-10-05", "")).toBe("2026-10-05T23:59:00.000Z");
  });

  it("clearing the date clears the deadline, whatever the clock says", () => {
    expect(composeDueAt("", "09:00")).toBeNull();
  });

  it("never accepts an impossible clock into the stored instant", () => {
    expect(composeDueAt("2026-10-05", "24:00")).toBe("2026-10-05T23:59:00.000Z");
    expect(composeDueAt("2026-10-05", "9:00")).toBe("2026-10-05T23:59:00.000Z");
  });

  it("knows a stated time from the one nobody has changed", () => {
    expect(isDefaultDueTime("2026-10-05T23:59:00.000Z")).toBe(true);
    expect(isDefaultDueTime("2026-10-05T09:00:00.000Z")).toBe(false);
    expect(isDefaultDueTime(null)).toBe(true);
  });
});
