import { describe, expect, it } from "vitest";
import type { WorkItem } from "@schoolquest/domain";
import { buildTerrain, runwayDays, type TerrainInput } from "./terrain.js";

const NOW = "2026-09-01T09:00:00.000Z";
const DEFAULTS = { quiz: 30, paper: 600, reading: 60, other: 60 };

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_1",
    courseId: "crs_a",
    parentWorkItemId: null,
    title: "Thing",
    description: null,
    workType: "quiz",
    availableAt: null,
    dueAt: null,
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: null,
    remainingMinutes: null,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "not_started",
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

/** `days` from NOW, as an ISO instant. */
function inDays(days: number): string {
  return new Date(Date.parse(NOW) + days * 86_400_000).toISOString();
}

function build(items: WorkItem[], booked: Record<string, number> = {}, courses = ["crs_a"]) {
  const input: TerrainInput = {
    workItems: items,
    bookedByItem: booked,
    courseIds: courses,
    now: NOW,
    defaultEffortMinutes: DEFAULTS,
  };
  return buildTerrain(input);
}

const first = (t: ReturnType<typeof build>) => t.markers[0]!;
/** Everything that got a place, on the ground or out in the distance. */
const all = (t: ReturnType<typeof build>) => [...t.markers, ...t.distant];
const find = (t: ReturnType<typeof build>, id: string) => all(t).find((m) => m.workItemId === id)!;

describe("placing work in the landscape", () => {
  it("puts sooner work nearer than later work", () => {
    const t = build([
      item({ id: "soon", dueAt: inDays(3) }),
      item({ id: "later", dueAt: inDays(25) }),
    ]);
    expect(find(t, "soon").depth).toBeLessThan(find(t, "later").depth);
  });

  it("lights near work more brightly than far work", () => {
    const t = build([
      item({ id: "soon", dueAt: inDays(2) }),
      item({ id: "later", dueAt: inDays(26) }),
    ]);
    expect(find(t, "soon").glow).toBeGreaterThan(find(t, "later").glow);
  });

  it("measures the ground linearly in days, so a week is always a quarter of it", () => {
    // Seen from above there is no horizon to rescue, so bending time would be distortion
    // with nothing bought by it — and the week rules would stop being trustworthy.
    const t = build([
      item({ id: "w1", dueAt: inDays(7) }),
      item({ id: "w2", dueAt: inDays(14) }),
      item({ id: "w3", dueAt: inDays(21) }),
    ]);
    expect(find(t, "w1").depth).toBeCloseTo(0.25, 5);
    expect(find(t, "w2").depth).toBeCloseTo(0.5, 5);
    expect(find(t, "w3").depth).toBeCloseTo(0.75, 5);
  });

  it("draws bigger work as higher ground", () => {
    const t = build([
      item({ id: "quiz", dueAt: inDays(10), estimatedMinutes: 30 }),
      item({ id: "paper", dueAt: inDays(10), estimatedMinutes: 900 }),
    ]);
    expect(t.markers.find((m) => m.workItemId === "paper")!.rise).toBeGreaterThan(
      t.markers.find((m) => m.workItemId === "quiz")!.rise,
    );
  });

  it("keeps each course in its own lane", () => {
    const t = build(
      [
        item({ id: "a", courseId: "crs_a", dueAt: inDays(10) }),
        item({ id: "b", courseId: "crs_c", dueAt: inDays(10) }),
      ],
      {},
      ["crs_a", "crs_b", "crs_c"],
    );
    const a = t.markers.find((m) => m.workItemId === "a")!;
    const b = t.markers.find((m) => m.workItemId === "b")!;
    expect(a.lateral).toBeLessThan(b.lateral);
  });

  it("draws the same landscape every time", () => {
    // The scatter is hashed, never random: a map that rearranges itself between glances is
    // worse than no map.
    const items = [item({ id: "a", dueAt: inDays(5) }), item({ id: "b", dueAt: inDays(5) })];
    expect(build(items).markers).toEqual(build(items).markers);
  });

  it("keeps everything inside the frame", () => {
    const t = build(
      Array.from({ length: 40 }, (_, i) =>
        item({ id: `w${i}`, courseId: `crs_${i % 7}`, dueAt: inDays(i) }),
      ),
      {},
      Array.from({ length: 7 }, (_, i) => `crs_${i}`),
    );
    for (const m of t.markers) {
      expect(m.lateral).toBeGreaterThanOrEqual(-1);
      expect(m.lateral).toBeLessThanOrEqual(1);
      expect(m.depth).toBeGreaterThanOrEqual(0);
      expect(m.depth).toBeLessThanOrEqual(1);
    }
  });

  it("sets the horizon to the furthest thing, up to the placed limit", () => {
    expect(build([item({ id: "a", dueAt: inDays(50) })]).horizonDays).toBe(50);
    expect(build([item({ id: "a", dueAt: inDays(200) })]).horizonDays).toBeLessThanOrEqual(84);
  });

  it("never shrinks the ground below the four weeks it is a map of", () => {
    // A term with nothing past next week still draws a month, or the scale would change
    // shape every time something was finished.
    const t = build([item({ id: "a", dueAt: inDays(2) })]);
    expect(t.focusDays).toBe(28);
    expect(t.horizonDays).toBeGreaterThanOrEqual(28);
  });

  it("counts work past the horizon rather than squeezing it in", () => {
    // Drawing a whole four-month term put the next fortnight in the bottom fifth of the
    // frame and piled fifty markers into an unreadable band at the back.
    const t = build([
      item({ id: "near", dueAt: inDays(5) }),
      item({ id: "far", dueAt: inDays(120) }),
    ]);
    expect(t.markers.map((m) => m.workItemId)).toEqual(["near"]);
    expect(t.beyond.map((m) => m.workItemId)).toEqual(["far"]);
  });

  it("puts work past the ground into the distance rather than onto the ground", () => {
    const t = build([
      item({ id: "onmap", dueAt: inDays(20) }),
      item({ id: "outthere", dueAt: inDays(50) }),
    ]);
    expect(t.markers.map((m) => m.workItemId)).toEqual(["onmap"]);
    expect(t.distant.map((m) => m.workItemId)).toEqual(["outthere"]);
  });

  it("measures the distance on its own scale, not as a continuation of the ground", () => {
    // The two bands are drawn as different kinds of thing, so sharing one number would make
    // the renderer quietly lie about which one a marker belongs to.
    const t = build([
      item({ id: "justpast", dueAt: inDays(29) }),
      item({ id: "horizon", dueAt: inDays(84) }),
    ]);
    expect(find(t, "justpast").depth).toBeLessThan(0.1);
    expect(find(t, "horizon").depth).toBeCloseTo(1, 5);
  });

  it("dims the distance, but never dims a warning to nothing", () => {
    const t = build([
      item({ id: "calm", dueAt: inDays(60), estimatedMinutes: 30 }),
      // Past the ground, but inside its own runway: a twenty-five-hour paper a month out
      // is the exact case a date-sorted list buries and this view exists to surface.
      item({ id: "asking", workType: "paper", dueAt: inDays(31), estimatedMinutes: 1500 }),
    ]);
    const calm = find(t, "calm");
    const asking = find(t, "asking");
    expect(calm.state).toBe("waiting");
    expect(asking.state).toBe("needs_time");
    // Both are out in the distance; only one of them is asking for a decision today.
    expect(t.distant).toHaveLength(2);
    expect(asking.glow).toBeGreaterThan(calm.glow * 3);
  });

  it("still counts what it does not draw", () => {
    // A legend that totalled only what fits would be the one number on the screen that is
    // quietly false.
    const t = build([
      item({ id: "near", dueAt: inDays(3) }),
      item({ id: "far", dueAt: inDays(120) }),
      item({ id: "nodate", dueAt: null }),
    ]);
    const total = Object.values(t.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });

  it("honours a caller that wants to see further", () => {
    const t = buildTerrain({
      workItems: [item({ id: "far", dueAt: inDays(100) })],
      bookedByItem: {},
      courseIds: ["crs_a"],
      now: NOW,
      defaultEffortMinutes: DEFAULTS,
      visibleDays: 120,
    });
    expect(t.distant).toHaveLength(1);
    expect(t.beyond).toHaveLength(0);
  });

  it("still has a horizon when everything is imminent", () => {
    expect(build([item({ id: "a", dueAt: inDays(1) })]).horizonDays).toBeGreaterThan(0);
  });
});

describe("what the lights mean", () => {
  it("burns for work whose date has passed", () => {
    const t = build([item({ id: "a", dueAt: inDays(-2) })]);
    expect(first(t).state).toBe("overdue");
    expect(first(t).glow).toBe(1);
  });

  it("asks for time once work is close and nothing is booked", () => {
    const t = build([item({ id: "a", dueAt: inDays(4), estimatedMinutes: 60 })]);
    expect(first(t).state).toBe("needs_time");
    expect(first(t).detail).toContain("no time is booked");
  });

  it("stays calm about the same work while it is still far off", () => {
    const t = build([item({ id: "a", dueAt: inDays(40), estimatedMinutes: 60 })]);
    expect(find(t, "a").state).toBe("waiting");
  });

  it("asks earlier for bigger work", () => {
    // A fifteen-hour paper and a half-hour quiz both due in three weeks are not the same
    // situation, and a rule that treats them alike is useless for one of them.
    const t = build([
      item({ id: "paper", workType: "paper", dueAt: inDays(21), estimatedMinutes: 900 }),
      item({ id: "quiz", workType: "quiz", dueAt: inDays(21), estimatedMinutes: 30 }),
    ]);
    expect(t.markers.find((m) => m.workItemId === "paper")!.state).toBe("needs_time");
    expect(t.markers.find((m) => m.workItemId === "quiz")!.state).toBe("waiting");
  });

  it("gives even the smallest work a real warning window", () => {
    // Runway alone gives a thirty-minute quiz one day, which is a notification rather than a
    // warning. Walking the real semester forward showed sixteen items going past their date
    // with only one ever lit on the way.
    expect(runwayDays(30)).toBeGreaterThanOrEqual(10);
    const t = build([item({ id: "a", dueAt: inDays(6), estimatedMinutes: 30 })]);
    expect(first(t).state).toBe("needs_time");
  });

  it("goes calm the moment time is booked for it", () => {
    const due = { id: "a", dueAt: inDays(4), estimatedMinutes: 60 };
    expect(first(build([item(due)])).state).toBe("needs_time");
    expect(first(build([item(due)], { a: 60 })).state).toBe("covered");
  });

  it("says so when the booking does not cover the work", () => {
    const t = build([item({ id: "a", dueAt: inDays(4), estimatedMinutes: 240 })], { a: 60 });
    expect(first(t).state).toBe("partly_covered");
    expect(first(t).detail).toContain("1 hours booked");
  });

  it("treats finished work as a cold ember rather than removing it", () => {
    const t = build([item({ id: "a", dueAt: inDays(-5), status: "completed" })]);
    expect(first(t).state).toBe("done");
  });

  it("never counts a cancelled item at all", () => {
    expect(build([item({ id: "a", dueAt: inDays(4), status: "canceled" })]).markers).toEqual([]);
  });

  it("sets undated work aside rather than inventing a place for it", () => {
    const t = build([item({ id: "a", dueAt: null })]);
    expect(t.markers).toEqual([]);
    expect(t.undated).toHaveLength(1);
    expect(t.undated[0]!.detail).toContain("No date is known");
  });

  it("every marker carries a sentence, so colour is never the only signal", () => {
    const t = build([
      item({ id: "a", dueAt: inDays(-1) }),
      item({ id: "b", dueAt: inDays(3) }),
      item({ id: "c", dueAt: inDays(90) }),
      item({ id: "d", dueAt: null }),
    ]);
    for (const m of [...t.markers, ...t.undated]) expect(m.detail.length).toBeGreaterThan(10);
  });

  it("counts what is on the landscape", () => {
    const t = build([
      item({ id: "a", dueAt: inDays(-1) }),
      item({ id: "b", dueAt: inDays(3) }),
      item({ id: "c", dueAt: inDays(90) }),
    ]);
    expect(t.counts.overdue).toBe(1);
    expect(t.counts.needs_time).toBe(1);
    expect(t.counts.waiting).toBe(1);
  });
});

/** Nearest sample index to `value` in an ascending-or-descending axis. */
function nearest(axis: readonly number[], value: number): number {
  let best = 0;
  for (let i = 1; i < axis.length; i += 1) {
    if (Math.abs(axis[i]! - value) < Math.abs(axis[best]! - value)) best = i;
  }
  return best;
}

/** The height of the land directly under a marker. */
function heightUnder(t: ReturnType<typeof build>, workItemId: string): number {
  const m = t.markers.find((x) => x.workItemId === workItemId)!;
  return t.field.rows[nearest(t.field.depths, m.depth)]![nearest(t.field.laterals, m.lateral)]!;
}

describe("the relief under the work", () => {
  it("covers the whole ground in a fixed grid, so a renderer can walk it", () => {
    const t = build([item({ id: "a", dueAt: inDays(5) })]);
    expect(t.field.rows).toHaveLength(t.field.depths.length);
    for (const row of t.field.rows) expect(row).toHaveLength(t.field.laterals.length);
  });

  it("runs back to front, so near ground can be painted over far ground", () => {
    const t = build([item({ id: "a", dueAt: inDays(5) })]);
    expect(t.field.depths[0]).toBeCloseTo(1);
    expect(t.field.depths.at(-1)).toBeCloseTo(0);
    for (let i = 1; i < t.field.depths.length; i += 1) {
      expect(t.field.depths[i]!).toBeLessThan(t.field.depths[i - 1]!);
    }
  });

  it("spans the full width of the ground", () => {
    const t = build([item({ id: "a", dueAt: inDays(5) })]);
    expect(t.field.laterals[0]).toBeCloseTo(-1);
    expect(t.field.laterals.at(-1)).toBeCloseTo(1);
  });

  it("keeps every height on the scale a renderer expects", () => {
    const t = build([
      item({ id: "a", dueAt: inDays(2), estimatedMinutes: 1200 }),
      item({ id: "b", dueAt: inDays(20), estimatedMinutes: 30 }),
    ]);
    for (const row of t.field.rows) {
      for (const h of row) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(1);
      }
    }
  });

  it("raises the land where the work is heavy", () => {
    const t = build([
      item({ id: "heavy", dueAt: inDays(6), estimatedMinutes: 900 }),
      item({ id: "light", dueAt: inDays(24), estimatedMinutes: 30 }),
    ]);
    expect(heightUnder(t, "heavy")).toBeGreaterThan(heightUnder(t, "light"));
  });

  it("stacks a crowded fortnight into one ridge rather than leaving it flat", () => {
    const crowded = build([
      item({ id: "a", dueAt: inDays(6), estimatedMinutes: 200 }),
      item({ id: "b", dueAt: inDays(7), estimatedMinutes: 200 }),
      item({ id: "c", dueAt: inDays(8), estimatedMinutes: 200 }),
      item({ id: "far", dueAt: inDays(26), estimatedMinutes: 200 }),
    ]);
    expect(heightUnder(crowded, "a")).toBeGreaterThan(heightUnder(crowded, "far"));
  });

  it("still draws land when nothing is due, so empty ground is landscape and not a floor", () => {
    const t = build([]);
    const heights = t.field.rows.flat();
    expect(Math.max(...heights)).toBeGreaterThan(0);
    // ...but nothing empty ever climbs into the range work occupies.
    expect(Math.max(...heights)).toBeLessThan(0.2);
  });

  it("is the same landscape every time it is built", () => {
    const items = [item({ id: "a", dueAt: inDays(4) }), item({ id: "b", dueAt: inDays(22) })];
    expect(build(items).field).toEqual(build(items).field);
  });

  it("is not raised by work out in the distance", () => {
    // Distant work has a place but no ground under it. Letting it push up the relief would
    // put a mountain in the four-week map for something due in week nine.
    const near = build([item({ id: "a", dueAt: inDays(10), estimatedMinutes: 60 })]);
    const alsoFar = build([
      item({ id: "a", dueAt: inDays(10), estimatedMinutes: 60 }),
      item({ id: "b", dueAt: inDays(60), estimatedMinutes: 1800 }),
    ]);
    expect(alsoFar.field).toEqual(near.field);
  });
});
