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

describe("placing work in the landscape", () => {
  it("puts sooner work nearer than later work", () => {
    const t = build([
      item({ id: "soon", dueAt: inDays(3) }),
      item({ id: "later", dueAt: inDays(40) }),
    ]);
    const soon = t.markers.find((m) => m.workItemId === "soon")!;
    const later = t.markers.find((m) => m.workItemId === "later")!;
    expect(soon.depth).toBeLessThan(later.depth);
  });

  it("lights near work more brightly than far work", () => {
    const t = build([
      item({ id: "soon", dueAt: inDays(2) }),
      item({ id: "later", dueAt: inDays(45) }),
    ]);
    expect(t.markers.find((m) => m.workItemId === "soon")!.glow).toBeGreaterThan(
      t.markers.find((m) => m.workItemId === "later")!.glow,
    );
  });

  it("gives the near ground more of the frame than a linear scale would", () => {
    // The whole reason for the curve: a term four months long must not squash the next
    // fortnight into the bottom tenth of the picture.
    const t = build([item({ id: "a", dueAt: inDays(14) }), item({ id: "far", dueAt: inDays(50) })]);
    const near = t.markers.find((m) => m.workItemId === "a")!;
    expect(near.depth).toBeGreaterThan(14 / 50);
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

  it("sets the horizon to the furthest thing, up to the drawn limit", () => {
    expect(build([item({ id: "a", dueAt: inDays(30) })]).horizonDays).toBe(30);
    expect(build([item({ id: "a", dueAt: inDays(200) })]).horizonDays).toBeLessThanOrEqual(56);
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
    expect(t.markers).toHaveLength(1);
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
    expect(first(t).state).toBe("waiting");
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
