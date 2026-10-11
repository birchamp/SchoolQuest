import { afterEach, describe, expect, it } from "vitest";
import { setPlanTimeZone } from "./clock";
import { composeDueAt, DEFAULT_DUE_TIME, dueDatePart, dueTimePart, formatDueDay } from "./due-time";

/**
 * A due date is a UTC instant; the editor shows and takes it in the student's zone. The pairing
 * that matters is split-then-compose -- the row reads the two halves, hands them to two inputs,
 * and joins them back on every save. If that round trip is not exact, opening a row and saving it
 * moves the deadline, which an editor may never do.
 */
describe("due time, for a student in Chicago", () => {
  afterEach(() => setPlanTimeZone(null));

  it("shows a stored instant as the Chicago date and time it is", () => {
    setPlanTimeZone("America/Chicago");
    // 04:59 UTC on the 6th is 11:59pm on the 5th in Chicago (CDT).
    expect(dueDatePart("2026-10-06T04:59:00.000Z")).toBe("2026-10-05");
    expect(dueTimePart("2026-10-06T04:59:00.000Z")).toBe("23:59");
  });

  it("stores what the student typed as the UTC instant it means", () => {
    setPlanTimeZone("America/Chicago");
    expect(composeDueAt("2026-10-05", "09:00")).toBe("2026-10-05T14:00:00.000Z");
    expect(composeDueAt("2026-10-05", "")).toBe("2026-10-06T04:59:00.000Z");
  });

  it("round trips exactly: opening a deadline and saving it changes nothing", () => {
    setPlanTimeZone("America/Chicago");
    for (const stored of ["2026-10-05T14:30:00.000Z", "2026-10-06T04:59:00.000Z", "2026-12-01T15:00:00.000Z"]) {
      expect(composeDueAt(dueDatePart(stored), dueTimePart(stored))).toBe(stored);
    }
  });

  it("prints the deadline's day as the student lives it", () => {
    setPlanTimeZone("America/Chicago");
    expect(formatDueDay("2026-10-06T04:59:00.000Z", { day: "numeric" })).toBe("5");
    setPlanTimeZone("Asia/Tokyo");
    // The same instant is 1:59pm on the 6th in Tokyo.
    expect(formatDueDay("2026-10-06T04:59:00.000Z", { day: "numeric" })).toBe("6");
  });
});

describe("due time, edge cases", () => {
  afterEach(() => setPlanTimeZone(null));

  it("reads an undated item as no date and the end-of-day default", () => {
    expect(dueDatePart(null)).toBe("");
    expect(dueTimePart(null)).toBe(DEFAULT_DUE_TIME);
  });

  it("clearing the date clears the deadline, whatever the clock says", () => {
    expect(composeDueAt("", "09:00")).toBeNull();
  });

  it("never accepts an impossible clock into the stored instant", () => {
    setPlanTimeZone("UTC");
    expect(composeDueAt("2026-10-05", "24:00")).toBe("2026-10-05T23:59:00.000Z");
    expect(composeDueAt("2026-10-05", "9:00")).toBe("2026-10-05T23:59:00.000Z");
  });
});
