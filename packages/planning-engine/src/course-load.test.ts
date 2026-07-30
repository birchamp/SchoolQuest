import { describe, expect, it } from "vitest";
import type { WorkItem, WorkStatus, WorkType } from "@schoolquest/domain";
import { computeCourseLoad } from "./course-load.js";

const NOW = "2026-09-14T09:00:00.000Z";

let counter = 0;

function item(courseId: string, overrides: Partial<WorkItem> = {}): WorkItem {
  counter += 1;
  return {
    id: `wi_cl_${counter}`,
    courseId,
    parentWorkItemId: null,
    title: `Item ${counter}`,
    description: null,
    workType: "problem_set" as WorkType,
    availableAt: null,
    dueAt: null,
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: 60,
    remainingMinutes: 60,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "not_started" as WorkStatus,
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

function load(
  courseIds: string[],
  workItems: WorkItem[],
  booked: { workItemId: string; minutes: number }[] = [],
  completed: { workItemId: string; endAt: string; minutes: number }[] = [],
  capacityMinutes = 900,
) {
  return computeCourseLoad({ courseIds, workItems, booked, completed, capacityMinutes, now: NOW });
}

describe("dividing one week across several courses", () => {
  it("reports each course's share of the time actually booked", () => {
    const bio = item("bio");
    const his = item("his");
    const term = load(
      ["bio", "his"],
      [bio, his],
      [
        { workItemId: bio.id, minutes: 180 },
        { workItemId: his.id, minutes: 60 },
      ],
    );
    expect(term.bookedMinutes).toBe(240);
    expect(term.courses.find((c) => c.courseId === "bio")!.shareOfBooked).toBeCloseTo(0.75);
    expect(term.courses.find((c) => c.courseId === "his")!.shareOfBooked).toBeCloseTo(0.25);
  });

  it("shares sum to the whole, so the division is complete", () => {
    const items = ["bio", "his", "mat"].map((c) => item(c));
    const term = load(
      ["bio", "his", "mat"],
      items,
      items.map((i, n) => ({ workItemId: i.id, minutes: 30 * (n + 1) })),
    );
    const total = term.courses.reduce((sum, c) => sum + c.shareOfBooked, 0);
    expect(total).toBeCloseTo(1);
  });

  it("reports unbooked capacity as room, never as debt", () => {
    const bio = item("bio");
    const term = load(["bio"], [bio], [{ workItemId: bio.id, minutes: 120 }], [], 900);
    expect(term.unbookedMinutes).toBe(780);

    // Even if a plan somehow exceeded capacity, this is room remaining, not a deficit.
    const over = load(["bio"], [bio], [{ workItemId: bio.id, minutes: 1200 }], [], 900);
    expect(over.unbookedMinutes).toBe(0);
  });

  it("gives a course with nothing booked a zero share rather than omitting it", () => {
    // A quiet course must stay on the table. Dropping the row is how a course disappears.
    const bio = item("bio");
    const term = load(["bio", "his"], [bio, item("his")], [{ workItemId: bio.id, minutes: 60 }]);
    const his = term.courses.find((c) => c.courseId === "his")!;
    expect(his.bookedMinutes).toBe(0);
    expect(his.shareOfBooked).toBe(0);
    expect(term.coursesWithNothingBooked).toBe(1);
  });

  it("divides nothing by nothing without producing NaN", () => {
    const term = load(["bio"], [item("bio")]);
    expect(term.courses[0]!.shareOfBooked).toBe(0);
    expect(term.bookedMinutes).toBe(0);
  });
});

describe("what each course is carrying", () => {
  it("counts open work, excluding a project's parent alongside its stages", () => {
    const parent = item("bio", { estimatedMinutes: 600, remainingMinutes: 600 });
    const stages = [1, 2].map(() => item("bio", { parentWorkItemId: parent.id }));
    const term = load(["bio"], [parent, ...stages]);
    expect(term.courses[0]!.openItems).toBe(2);
  });

  it("names the next thing ahead, not the oldest overdue one", () => {
    // A stale date must not stand in for what is actually coming.
    const overdue = item("bio", { title: "Old Paper", dueAt: "2025-12-01T09:00:00.000Z" });
    const next = item("bio", { title: "Quiz 3", dueAt: "2026-09-18T09:00:00.000Z" });
    const later = item("bio", { title: "Final", dueAt: "2026-12-01T09:00:00.000Z" });
    const term = load(["bio"], [overdue, next, later]);
    expect(term.courses[0]!.nextDueTitle).toBe("Quiz 3");
  });

  it("reports no next deadline rather than inventing one", () => {
    const term = load(["bio"], [item("bio", { dueAt: null })]);
    expect(term.courses[0]!.nextDueAt).toBeNull();
    expect(term.courses[0]!.nextDueTitle).toBeNull();
  });

  it("totals invested time and days since progress per course", () => {
    const bio = item("bio");
    const term = load(
      ["bio"],
      [bio],
      [],
      [
        { workItemId: bio.id, endAt: "2026-09-04T10:00:00.000Z", minutes: 60 },
        { workItemId: bio.id, endAt: "2026-09-11T10:00:00.000Z", minutes: 30 },
      ],
    );
    expect(term.courses[0]!.investedMinutes).toBe(90);
    expect(term.courses[0]!.daysSinceProgress).toBe(2);
  });
});

describe("upkeep", () => {
  function routine(courseId: string, n: number, dueAt: string | null): WorkItem {
    return item(courseId, { title: `Discussion Post ${n}`, dueAt });
  }

  it("says a course has no routine work when it has none", () => {
    const term = load(["bio"], [item("bio", { title: "Midterm" })]);
    expect(term.courses[0]!.upkeep).toBe("no_routine");
  });

  it("is current when the recurring work is not overdue", () => {
    const items = [1, 2, 3, 4].map((n) => routine("bio", n, "2026-10-01T09:00:00.000Z"));
    const term = load(["bio"], items);
    expect(term.courses[0]!.upkeep).toBe("current");
    expect(term.courses[0]!.upkeepOverdue).toBe(0);
  });

  it("slips at one overdue routine item and is behind at two", () => {
    const base = [1, 2, 3].map((n) => routine("bio", n, "2026-10-01T09:00:00.000Z"));
    const one = load(["bio"], [...base, routine("bio", 4, "2026-09-01T09:00:00.000Z")]);
    expect(one.courses[0]!.upkeep).toBe("slipping");

    const two = load(["bio"], [
      ...base,
      routine("bio", 4, "2026-09-01T09:00:00.000Z"),
      routine("bio", 5, "2026-09-08T09:00:00.000Z"),
    ]);
    expect(two.courses[0]!.upkeep).toBe("behind");
    expect(two.courses[0]!.upkeepOverdue).toBe(2);
  });

  it("recovers the moment the overdue work is done — nothing is lost permanently", () => {
    const base = [1, 2, 3].map((n) => routine("bio", n, "2026-10-01T09:00:00.000Z"));
    const late = routine("bio", 4, "2026-09-01T09:00:00.000Z");
    expect(load(["bio"], [...base, late]).courses[0]!.upkeep).toBe("slipping");
    expect(
      load(["bio"], [...base, { ...late, status: "completed" as WorkStatus }]).courses[0]!.upkeep,
    ).toBe("current");
  });

  it("does not treat a one-off as routine", () => {
    const term = load(["bio"], [
      item("bio", { title: "Essay 1", dueAt: "2026-09-01T09:00:00.000Z" }),
      item("bio", { title: "Essay 2", dueAt: "2026-09-02T09:00:00.000Z" }),
    ]);
    expect(term.courses[0]!.upkeep).toBe("no_routine");
  });
});

describe("any number of courses", () => {
  // A student might carry three courses or seven. Nothing here may assume a count, and the
  // shares must still describe a whole week however many ways it is cut.
  function termOf(count: number) {
    const ids = Array.from({ length: count }, (_, i) => `c${i}`);
    const items = ids.map((id) => item(id));
    return load(
      ids,
      items,
      items.map((i) => ({ workItemId: i.id, minutes: 60 })),
    );
  }

  for (const count of [1, 2, 3, 5, 7, 9]) {
    it(`divides the week across ${count} course${count === 1 ? "" : "s"}`, () => {
      const term = termOf(count);
      expect(term.courses).toHaveLength(count);
      expect(term.bookedMinutes).toBe(60 * count);
      // Shares always sum to the whole, whatever the count.
      expect(term.courses.reduce((sum, c) => sum + c.shareOfBooked, 0)).toBeCloseTo(1);
      // And each is an equal cut here, so none is silently dropped or double-counted.
      for (const course of term.courses) {
        expect(course.shareOfBooked).toBeCloseTo(1 / count);
      }
    });
  }

  it("gives a single course the whole week without dividing by zero elsewhere", () => {
    const term = termOf(1);
    expect(term.courses[0]!.shareOfBooked).toBe(1);
    expect(term.coursesWithNothingBooked).toBe(0);
  });

  it("handles a term with no courses at all", () => {
    const term = load([], []);
    expect(term.courses).toEqual([]);
    expect(term.bookedMinutes).toBe(0);
    expect(term.unbookedMinutes).toBe(900);
  });

  it("keeps every course's row when only some have work booked", () => {
    const ids = Array.from({ length: 7 }, (_, i) => `c${i}`);
    const items = ids.map((id) => item(id));
    // Only two of the seven have anything booked this week.
    const term = load(ids, items, [
      { workItemId: items[0]!.id, minutes: 120 },
      { workItemId: items[3]!.id, minutes: 60 },
    ]);
    expect(term.courses).toHaveLength(7);
    expect(term.coursesWithNothingBooked).toBe(5);
    expect(term.courses.reduce((sum, c) => sum + c.shareOfBooked, 0)).toBeCloseTo(1);
  });
});
