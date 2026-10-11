import { describe, expect, it } from "vitest";

import {
  arcBand,
  dueDistanceShort,
  dueDistanceSpoken,
  radarDueWord,
  terrainDueLine,
} from "./due-label.js";

/**
 * The case these exist for: due at 09:00, looked at at 15:00 the same day. The engine reports
 * `daysAway` 0 (same calendar day) and `pastDue` true (the instant has gone).
 */
const morningAtThree = { daysAway: 0, pastDue: true };
/** Due at 21:00, looked at at 15:00: same day, still ahead. */
const eveningAtThree = { daysAway: 0, pastDue: false };

describe("dueDistanceShort", () => {
  it("does not call a deadline that passed this morning 'today'", () => {
    expect(dueDistanceShort(morningAtThree)).toBe("earlier today");
  });

  it("calls a deadline still ahead today 'today'", () => {
    expect(dueDistanceShort(eveningAtThree)).toBe("today");
  });

  it("prints calendar distance either side", () => {
    expect(dueDistanceShort({ daysAway: -3, pastDue: true })).toBe("3d ago");
    expect(dueDistanceShort({ daysAway: 5, pastDue: false })).toBe("5d");
  });
});

describe("dueDistanceSpoken", () => {
  it("says past due for work due at 09:00 seen at 15:00", () => {
    expect(dueDistanceSpoken(morningAtThree)).toBe("past due since earlier today");
  });

  it("says due today while the deadline is still ahead", () => {
    expect(dueDistanceSpoken(eveningAtThree)).toBe("due today");
  });

  it("counts whole days past due and ahead", () => {
    expect(dueDistanceSpoken({ daysAway: -1, pastDue: true })).toBe("past due by 1 day");
    expect(dueDistanceSpoken({ daysAway: -4, pastDue: true })).toBe("past due by 4 days");
    expect(dueDistanceSpoken({ daysAway: 1, pastDue: false })).toBe("due in 1 day");
  });

  it("does not call finished work on an earlier date past due", () => {
    // The status field is false for finished work; the date alone is not a verdict.
    expect(dueDistanceSpoken({ daysAway: -2, pastDue: false })).toBe("was due 2 days ago");
  });
});

describe("arcBand", () => {
  it("moves work due at 09:00 out of 'within 7 days' by 15:00", () => {
    expect(arcBand(morningAtThree)).toBe("overdue");
  });

  it("keeps work due later today in the coming week", () => {
    expect(arcBand(eveningAtThree)).toBe("week");
  });

  it("bands the rest by distance", () => {
    expect(arcBand({ daysAway: 7, pastDue: false })).toBe("week");
    expect(arcBand({ daysAway: 8, pastDue: false })).toBe("month");
    expect(arcBand({ daysAway: 30, pastDue: false })).toBe("month");
    expect(arcBand({ daysAway: 31, pastDue: false })).toBe("term");
    expect(arcBand({ daysAway: -9, pastDue: true })).toBe("overdue");
  });
});

describe("radarDueWord", () => {
  it("calls work due at 09:00 overdue at 15:00, not 'Today'", () => {
    expect(radarDueWord(morningAtThree, "Monday")).toBe("Overdue since earlier today");
  });

  it("says Today while the deadline is still ahead", () => {
    expect(radarDueWord(eveningAtThree, "Monday")).toBe("Today");
  });

  it("keeps the other wordings", () => {
    expect(radarDueWord({ daysAway: -1, pastDue: true }, "Monday")).toBe("1 day overdue");
    expect(radarDueWord({ daysAway: -3, pastDue: true }, "Monday")).toBe("3 days overdue");
    expect(radarDueWord({ daysAway: 1, pastDue: false }, "Tuesday")).toBe("Tomorrow");
    expect(radarDueWord({ daysAway: 4, pastDue: false }, "Friday")).toBe("Friday · 4 days");
  });
});

describe("terrainDueLine", () => {
  it("does not print 'today' for a deadline that passed this morning", () => {
    expect(terrainDueLine("Mon 14 Sep", morningAtThree)).toBe("Mon 14 Sep · earlier today");
  });

  it("prints today, ago and ahead", () => {
    expect(terrainDueLine("Mon 14 Sep", eveningAtThree)).toBe("Mon 14 Sep · today");
    expect(terrainDueLine("Mon 14 Sep", { daysAway: -2, pastDue: true })).toBe(
      "Mon 14 Sep · 2d ago",
    );
    expect(terrainDueLine("Mon 14 Sep", { daysAway: 3, pastDue: false })).toBe(
      "Mon 14 Sep · in 3d",
    );
  });
});
