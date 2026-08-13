import { describe, expect, it } from "vitest";

import {
  RADAR_CENTER,
  RADAR_RADIUS,
  RADAR_VIEWBOX,
  dayLabelGeometry,
  hashId,
  isDistant,
  markerSize,
  projectEncounter,
  ringGeometry,
  spokeGeometry,
  tooltipPosition,
  weekdayName,
} from "./radar-geometry.js";
import type { RadarEncounterView } from "./types.js";

const encounter = (over: Partial<RadarEncounterView> & { id: string }): RadarEncounterView => ({
  boss: false,
  memberIds: [over.id],
  courseIds: ["crs_1"],
  title: "Problem set",
  workType: "problem_set",
  dueAt: "2026-09-17T12:00:00.000Z",
  dueDate: "2026-09-17",
  daysAway: 3,
  distanceDays: 3,
  bearingIndex: 3,
  dayOfWeek: 4,
  tier: 3,
  gradeShare: 0.08,
  hoursNeeded: 2,
  hoursBanked: 1,
  hoursExpected: 1,
  coverage: 0.5,
  readiness: 1,
  health: "ok",
  overdue: false,
  shortfallHours: 0,
  advice: "HOLD",
  ...over,
});

describe("hashId", () => {
  it("is stable, so a marker never moves between renders", () => {
    expect(hashId("wi_123")).toBe(hashId("wi_123"));
  });

  it("survives the merged-encounter ids, which are not numbers", () => {
    // The prototype hashed a numeric id; a NaN here silently drops a marker into the corner.
    const hash = hashId("boss:2026-10-02");
    expect(Number.isFinite(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
  });

  it("separates ids that differ only at the end", () => {
    expect(hashId("wi_a")).not.toBe(hashId("wi_b"));
  });
});

describe("projectEncounter", () => {
  it("puts today's work near the centre and the horizon at the outer ring", () => {
    const near = projectEncounter(encounter({ id: "a", daysAway: 0, distanceDays: 0.2 }), 4)!;
    const far = projectEncounter(encounter({ id: "b", daysAway: 28, distanceDays: 28 }), 4)!;
    expect(near.radius).toBeLessThan(60);
    expect(far.radius).toBeGreaterThan(RADAR_RADIUS - 20);
  });

  it("never lets today's work collapse onto the student's own mark", () => {
    const p = projectEncounter(encounter({ id: "a", daysAway: 0, distanceDays: 0 }), 4)!;
    expect(p.radius).toBeGreaterThanOrEqual(23);
  });

  it("draws everything above the baseline, never behind the student", () => {
    for (let bearing = 0; bearing < 7; bearing += 1) {
      const p = projectEncounter(
        encounter({ id: `b${bearing}`, bearingIndex: bearing, distanceDays: bearing + 1, daysAway: bearing + 1 }),
        4,
      )!;
      expect(p.y).toBeLessThanOrEqual(RADAR_CENTER.y);
    }
  });

  it("runs today's column down the left and the sixth day down the right", () => {
    const today = projectEncounter(encounter({ id: "a", bearingIndex: 0 }), 4)!;
    const sixth = projectEncounter(encounter({ id: "b", bearingIndex: 6 }), 4)!;
    expect(today.x).toBeLessThan(RADAR_CENTER.x);
    expect(sixth.x).toBeGreaterThan(RADAR_CENTER.x);
  });

  it("drops what lies past the horizon rather than drawing it off the scale", () => {
    const far = encounter({ id: "a", daysAway: 20, distanceDays: 20 });
    expect(projectEncounter(far, 4)).not.toBeNull();
    expect(projectEncounter(far, 2)).toBeNull();
  });

  describe("overdue work", () => {
    const late = (id: string, daysAway: number) =>
      projectEncounter(encounter({ id, daysAway, distanceDays: 0, overdue: true }), 4)!;

    it("draws it behind the student, below the baseline", () => {
      const p = late("a", -4);
      expect(p.behind).toBe(true);
      expect(p.y).toBeGreaterThan(RADAR_CENTER.y);
    });

    it("separates two late items instead of stacking them on the centre mark", () => {
      // Clamping distance to zero — the obvious reading of the original geometry — put every
      // late item on top of the "you are here" square. A real term six weeks in has nineteen.
      const a = late("wi_a", -3);
      const b = late("wi_b", -19);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(30);
    });

    it("puts longer-overdue work further back", () => {
      expect(late("a", -14).radius).toBeGreaterThan(late("a", -2).radius);
    });

    it("stops the band growing once late is simply late", () => {
      expect(late("a", -60).radius).toBeCloseTo(late("a", -21).radius, 5);
    });

    it("stays inside the frame", () => {
      for (let d = -1; d > -60; d -= 1) {
        const p = late(`wi_${d}`, d);
        expect(p.y).toBeLessThan(RADAR_VIEWBOX.height);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(RADAR_VIEWBOX.width);
      }
    });

    it("keeps a late Monday under the same column as next Monday", () => {
      // The engine gives a late Monday and next Monday the same bearing; the projection has
      // to draw that as the same column above and below the line, or the mirror is decorative.
      const lastMonday = projectEncounter(
        encounter({ id: "a", daysAway: -3, distanceDays: 0, bearingIndex: 4, overdue: true }),
        4,
      )!;
      const nextMonday = projectEncounter(
        encounter({ id: "a", daysAway: 4, distanceDays: 4, bearingIndex: 4 }),
        4,
      )!;
      expect(lastMonday.degrees).toBeCloseTo(nextMonday.degrees, 10);
      expect(lastMonday.y).toBeGreaterThan(RADAR_CENTER.y);
      expect(nextMonday.y).toBeLessThan(RADAR_CENTER.y);
    });
  });

  it("zooming in spreads the same week across the whole sweep", () => {
    const item = encounter({ id: "a", daysAway: 3, distanceDays: 3 });
    const wide = projectEncounter(item, 4)!;
    const tight = projectEncounter(item, 1)!;
    expect(tight.radius).toBeGreaterThan(wide.radius * 2);
    // Zoom changes distance only. The day it lands on does not move.
    expect(tight.degrees).toBeCloseTo(wide.degrees, 10);
  });

  it("scatters two things due the same day without moving them off their column", () => {
    const a = projectEncounter(encounter({ id: "wi_a" }), 4)!;
    const b = projectEncounter(encounter({ id: "wi_b" }), 4)!;
    expect(a.x).not.toBeCloseTo(b.x, 3);
    // Half a column is 12.85 degrees; the scatter must stay well inside it.
    expect(Math.abs(a.degrees - b.degrees)).toBeLessThan(6);
  });

  it("is deterministic across renders", () => {
    const item = encounter({ id: "wi_a" });
    expect(projectEncounter(item, 4)).toEqual(projectEncounter(item, 4));
  });
});

describe("markerSize", () => {
  it("grows with the share of the grade", () => {
    expect(markerSize(1, false)).toBeLessThan(markerSize(5, false));
  });

  it("draws a boss bigger than anything it merged", () => {
    expect(markerSize(5, true)).toBeGreaterThan(markerSize(5, false));
  });
});

describe("isDistant", () => {
  it("dims what is far away and on pace", () => {
    expect(isDistant(encounter({ id: "a", daysAway: 20, health: "ok" }))).toBe(true);
  });

  it("never dims something that needs attention, however far out it is", () => {
    expect(isDistant(encounter({ id: "a", daysAway: 26, health: "crit" }))).toBe(false);
    expect(isDistant(encounter({ id: "b", daysAway: 26, health: "warn" }))).toBe(false);
  });
});

describe("ringGeometry", () => {
  it("draws one arc per week and names the week of the term it lands in", () => {
    const rings = ringGeometry(4, 6);
    expect(rings).toHaveLength(4);
    expect(rings[0]!.label).toBe("1 (wk 7)");
    expect(rings[3]!.label).toBe("4 (wk 10)");
  });

  it("says only what it knows when the term has no dates", () => {
    expect(ringGeometry(2, null)[0]!.label).toBe("1 wk");
  });

  it("spaces the arcs evenly out to the full radius", () => {
    const rings = ringGeometry(4, null);
    expect(rings[3]!.d).toContain(String(RADAR_CENTER.x - RADAR_RADIUS));
  });

  it("sets the labels off the baseline, where near work crowds", () => {
    for (const ring of ringGeometry(4, 6)) {
      expect(ring.labelY).toBeLessThan(RADAR_CENTER.y - 10);
      expect(ring.labelX).toBeLessThan(RADAR_CENTER.x);
    }
  });

  it("keeps the labels off the weekday ring outside the sweep", () => {
    // They used to climb the "today" column, straight into the day label capping it.
    const days = dayLabelGeometry(0);
    for (const ring of ringGeometry(4, 6)) {
      for (const day of days) {
        expect(Math.hypot(ring.labelX - day.x, ring.labelY - day.y)).toBeGreaterThan(40);
      }
    }
  });

  it("keeps consecutive labels apart", () => {
    const rings = ringGeometry(4, 6);
    for (let i = 1; i < rings.length; i += 1) {
      const gap = Math.hypot(
        rings[i]!.labelX - rings[i - 1]!.labelX,
        rings[i]!.labelY - rings[i - 1]!.labelY,
      );
      expect(gap).toBeGreaterThan(60);
    }
  });
});

describe("spokeGeometry", () => {
  it("draws eight rays to bound seven day columns", () => {
    expect(spokeGeometry()).toHaveLength(8);
  });

  it("starts every ray at the student", () => {
    for (const spoke of spokeGeometry()) {
      expect(spoke.x1).toBe(RADAR_CENTER.x);
      expect(spoke.y1).toBe(RADAR_CENTER.y);
    }
  });
});

describe("dayLabelGeometry", () => {
  it("labels the columns forward from today, not from Monday", () => {
    // Today is Thursday (4). The prototype hard-coded Monday at the left, which mislabels
    // every column on six days out of seven.
    const labels = dayLabelGeometry(4).map((l) => l.label);
    expect(labels).toEqual(["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]);
  });

  it("wraps the week without gaps whatever day it starts on", () => {
    for (let dow = 0; dow < 7; dow += 1) {
      expect(new Set(dayLabelGeometry(dow).map((l) => l.label)).size).toBe(7);
    }
  });

  it("puts them outside the outer ring", () => {
    for (const l of dayLabelGeometry(0)) {
      const dx = l.x - RADAR_CENTER.x;
      const dy = l.y - RADAR_CENTER.y;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(RADAR_RADIUS);
    }
  });
});

describe("weekdayName", () => {
  it("names every day and tolerates a wrapped index", () => {
    expect(weekdayName(0)).toBe("Sun");
    expect(weekdayName(6)).toBe("Sat");
    expect(weekdayName(7)).toBe("Sun");
  });
});

describe("tooltipPosition", () => {
  it("flips the card before it leaves the frame", () => {
    expect(tooltipPosition({ x: 900, y: 200 }).x).toBeLessThan(900);
    expect(tooltipPosition({ x: 100, y: 200 }).x).toBeGreaterThan(100);
  });

  it("never lets the card's own top edge be cut off", () => {
    expect(tooltipPosition({ x: 100, y: 0 }).y).toBeGreaterThanOrEqual(6);
  });
});
