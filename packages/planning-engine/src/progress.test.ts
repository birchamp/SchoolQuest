import { describe, expect, it } from "vitest";
import type { WorkItem, WorkStatus } from "@schoolquest/domain";
import { computeCourseProgress, computeTermProgress, summarizeProgress } from "./progress.js";

let counter = 0;

function item(
  courseId: string,
  status: WorkStatus,
  pointsPossible: number | null = null,
): WorkItem {
  counter += 1;
  return {
    id: `wi_${counter}`,
    courseId,
    parentWorkItemId: null,
    title: `Item ${counter}`,
    description: null,
    workType: "problem_set",
    availableAt: null,
    dueAt: null,
    pointsPossible,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: 60,
    remainingMinutes: 60,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status,
    sourceConfidence: "confirmed",
    userPriority: 0,
  };
}

describe("course progress", () => {
  it("counts points only from items that state them", () => {
    const [progress] = computeCourseProgress(
      ["c1"],
      [item("c1", "completed", 40), item("c1", "not_started", 60), item("c1", "not_started")],
    );
    expect(progress).toMatchObject({
      basis: "points",
      pointsDone: 40,
      pointsTotal: 100,
      completionFraction: 0.4,
    });
    // Two of the three required items state a point value.
    expect(progress!.pointsCoverage).toBeCloseTo(2 / 3);
  });

  it("refuses to measure by points when barely any item states one", () => {
    // The shape real syllabi actually produce: one graded artifact with a point value
    // among many items that only carry a category weight. Measuring by points would call
    // this course 100% complete after a single assignment.
    const items = [item("c1", "completed", 100)];
    for (let i = 0; i < 17; i += 1) items.push(item("c1", "not_started"));

    const [progress] = computeCourseProgress(["c1"], items);
    expect(progress!.basis).toBe("items");
    expect(progress!.completionFraction).toBeCloseTo(1 / 18);
    // The raw sums are still reported — they are true, just not the right measure.
    expect(progress!.pointsDone).toBe(100);
    expect(progress!.pointsCoverage).toBeCloseTo(1 / 18);
  });

  it("falls back to item counts when no item states points", () => {
    const [progress] = computeCourseProgress(
      ["c1"],
      [item("c1", "submitted"), item("c1", "not_started"), item("c1", "in_progress")],
    );
    expect(progress).toMatchObject({ basis: "items", itemsDone: 1, itemsTotal: 3 });
    expect(progress!.completionFraction).toBeCloseTo(1 / 3);
  });

  it("treats submitted the same as completed and in_progress as not done", () => {
    const [progress] = computeCourseProgress(
      ["c1"],
      [item("c1", "submitted", 10), item("c1", "in_progress", 10)],
    );
    expect(progress!.pointsDone).toBe(10);
  });

  it("ignores cancelled work entirely", () => {
    const [progress] = computeCourseProgress(
      ["c1"],
      [item("c1", "completed", 50), item("c1", "canceled", 500)],
    );
    expect(progress).toMatchObject({ pointsTotal: 50, pointsDone: 50, itemsTotal: 1 });
  });

  it("credits optional work without adding it to what is owed", () => {
    const [none] = computeCourseProgress(
      ["c1"],
      [item("c1", "not_started", 100), item("c1", "optional", 25)],
    );
    expect(none).toMatchObject({ pointsTotal: 100, pointsDone: 0, itemsTotal: 1 });

    const [done] = computeCourseProgress(
      ["c1"],
      [item("c1", "not_started", 100), { ...item("c1", "optional", 25), status: "completed" }],
    );
    // The optional item is `completed`, so it now counts as done — and because it is no
    // longer flagged optional it also joins the denominator. What must never happen is
    // an unfinished optional item making the student look behind.
    expect(done!.pointsDone).toBe(25);
  });

  it("never reports more than fully complete", () => {
    const progress = summarizeProgress([
      {
        courseId: "c1",
        itemsTotal: 1,
        itemsDone: 3,
        pointsTotal: 10,
        pointsDone: 40,
        pointsCoverage: 1,
        completionFraction: 1,
        basis: "points",
      },
    ]);
    expect(progress.completionFraction).toBe(1);
    // The raw totals stay honest even when the ratio is capped.
    expect(progress.pointsDone).toBe(40);
  });

  it("keeps a row for a course that has no work items yet", () => {
    const progress = computeCourseProgress(["empty"], []);
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      courseId: "empty",
      itemsTotal: 0,
      completionFraction: 0,
      basis: "items",
    });
  });

  it("ignores work items belonging to courses not asked about", () => {
    const progress = computeCourseProgress(["c1"], [item("c1", "completed", 5), item("c2", "completed", 500)]);
    expect(progress[0]!.pointsDone).toBe(5);
  });
});

describe("term progress", () => {
  it("sums across courses and weights each course by its workload", () => {
    const term = computeTermProgress(
      ["c1", "c2"],
      [
        item("c1", "completed", 100),
        item("c1", "not_started", 100),
        item("c2", "not_started", 200),
      ],
    );
    expect(term).toMatchObject({ pointsDone: 100, pointsTotal: 400, itemsDone: 1, itemsTotal: 3 });
    // c1 is half done and holds two of the three items; c2 is untouched.
    expect(term.completionFraction).toBeCloseTo((0.5 * 2 + 0 * 1) / 3);
    expect(term.courses).toHaveLength(2);
  });

  it("does not let one points-bearing course speak for a term of courses without points", () => {
    // The five-course test semester in miniature: one course states points, the rest do
    // not. A ratio of summed points would read "100 of 100 — complete" while 20 items
    // in the other courses had not been touched.
    const items = [item("c1", "completed", 100)];
    for (let i = 0; i < 20; i += 1) items.push(item("c2", "not_started"));

    const term = computeTermProgress(["c1", "c2"], items);
    expect(term.basis).toBe("items");
    expect(term.completionFraction).toBeCloseTo(1 / 21);
    expect(term.pointsCoverage).toBeCloseTo(1 / 21);
  });

  it("uses points for the term when the syllabi actually state them", () => {
    const term = computeTermProgress(
      ["c1"],
      [item("c1", "completed", 25), item("c1", "not_started", 75)],
    );
    expect(term.basis).toBe("points");
    expect(term.completionFraction).toBeCloseTo(0.25);
  });

  it("is zero, not NaN, for an empty term", () => {
    const term = computeTermProgress([], []);
    expect(term.completionFraction).toBe(0);
    expect(term.pointsTotal).toBe(0);
    expect(term.basis).toBe("items");
  });
});

describe("projects broken into stages", () => {
  it("counts the stages, not the parent as well", () => {
    // Decomposing one paper into five stages pushed the test term from 56 tasks to 61,
    // because the parent stayed in the count beside its own children.
    const parent = item("c1", "not_started");
    const stages = [1, 2, 3, 4, 5].map(() => ({
      ...item("c1", "not_started"),
      parentWorkItemId: parent.id,
    }));
    const [progress] = computeCourseProgress(["c1"], [parent, ...stages]);
    expect(progress!.itemsTotal).toBe(5);
  });

  it("reads fully complete when every stage is done", () => {
    // With the parent counted too, a finished project would have sat at 5 of 6 forever.
    const parent = item("c1", "not_started");
    const stages = [1, 2, 3].map(() => ({
      ...item("c1", "completed" as const),
      parentWorkItemId: parent.id,
    }));
    const [progress] = computeCourseProgress(["c1"], [parent, ...stages]);
    expect(progress!.completionFraction).toBe(1);
  });

  it("still counts an undecomposed project normally", () => {
    const [progress] = computeCourseProgress(["c1"], [item("c1", "not_started")]);
    expect(progress!.itemsTotal).toBe(1);
  });
});
