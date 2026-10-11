import { describe, expect, it } from "vitest";
import { zoneCalendar } from "@schoolquest/domain";
import { floatingToUtc } from "./utc-conversion.js";

describe("floatingToUtc", () => {
  const chicago = zoneCalendar("America/Chicago");

  it("turns a local wall-clock time spelled as UTC into the instant it named", () => {
    // Midnight Friday in Chicago, stored the old way, is early Saturday in UTC.
    expect(floatingToUtc("2026-10-16T23:59:00.000Z", chicago)).toBe("2026-10-17T04:59:00.000Z");
    // Six hours west in winter, five in summer.
    expect(floatingToUtc("2026-12-04T09:00:00.000Z", chicago)).toBe("2026-12-04T15:00:00.000Z");
  });

  it("leaves a UTC student's times exactly as they were", () => {
    expect(floatingToUtc("2026-10-16T23:59:00.000Z", zoneCalendar("UTC"))).toBe("2026-10-16T23:59:00.000Z");
  });

  it("keeps seconds, and copes with the daylight-saving edges", () => {
    expect(floatingToUtc("2026-10-16T09:15:30.250Z", chicago)).toBe("2026-10-16T14:15:30.250Z");
    // 1:30 on 1 November happens twice in Chicago; the first is meant.
    expect(floatingToUtc("2026-11-01T01:30:00.000Z", chicago)).toBe("2026-11-01T06:30:00.000Z");
    // 2:30 on 14 March 2027 never happens; it lands where 3:30 does.
    expect(floatingToUtc("2027-03-14T02:30:00.000Z", chicago)).toBe("2027-03-14T08:30:00.000Z");
  });

  it("is to the minute east of Greenwich too", () => {
    expect(floatingToUtc("2026-10-16T09:00:00.000Z", zoneCalendar("Asia/Kolkata"))).toBe("2026-10-16T03:30:00.000Z");
  });
});
