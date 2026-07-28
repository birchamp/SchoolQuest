import { describe, expect, it } from "vitest";
import { applyDropRule, computeCourseStanding, estimateAcademicValue, isGraded } from "./grades.js";
import type { GradeResult, GradingCategory, WorkItem } from "./entities.js";

function item(overrides: Partial<WorkItem> & Pick<WorkItem, "id">): WorkItem {
  return {
    courseId: "crs_1",
    parentWorkItemId: null,
    title: "Item",
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

function grade(overrides: Partial<GradeResult> & Pick<GradeResult, "id" | "workItemId">): GradeResult {
  return {
    pointsEarned: null,
    pointsPossible: null,
    letterGrade: null,
    postedAt: null,
    confirmationStatus: "confirmed",
    sourceDocumentId: null,
    dropped: false,
    ...overrides,
  };
}

const quizzes: GradingCategory = {
  id: "gcat_quiz",
  courseId: "crs_1",
  name: "Quizzes",
  weightPercent: 100,
  dropRule: null,
  confidenceStatus: "confirmed",
};

describe("pending grades", () => {
  it("does not treat an ungraded item as zero", () => {
    const workItems = [
      item({ id: "wi_1", gradingCategoryId: quizzes.id, pointsPossible: 10 }),
      item({ id: "wi_2", gradingCategoryId: quizzes.id, pointsPossible: 10 }),
    ];
    const grades = [
      grade({ id: "g1", workItemId: "wi_1", pointsEarned: 9, pointsPossible: 10 }),
      // Submitted but not graded — must be excluded, not scored as 0/10.
      grade({ id: "g2", workItemId: "wi_2", pointsEarned: null, pointsPossible: 10 }),
    ];

    const standing = computeCourseStanding({ workItems, grades, categories: [quizzes] });
    expect(standing.estimatedPercent).toBeCloseTo(90);
    expect(standing.categories[0]!.pendingCount).toBe(1);
  });

  it("reports unknown standing when nothing has been graded", () => {
    const standing = computeCourseStanding({
      workItems: [item({ id: "wi_1", gradingCategoryId: quizzes.id })],
      grades: [grade({ id: "g1", workItemId: "wi_1", pointsPossible: 10 })],
      categories: [quizzes],
    });
    expect(standing.estimatedPercent).toBeNull();
    expect(standing.confidence).toBe("unknown");
  });

  it("treats a dash or blank the same as pending", () => {
    expect(isGraded(grade({ id: "g", workItemId: "wi", pointsPossible: 10 }))).toBe(false);
    expect(isGraded(grade({ id: "g", workItemId: "wi", pointsEarned: 0, pointsPossible: 10 }))).toBe(
      true,
    );
  });
});

describe("drop rules", () => {
  it("drops the lowest graded score", () => {
    const grades = [
      grade({ id: "g1", workItemId: "wi_1", pointsEarned: 10, pointsPossible: 10 }),
      grade({ id: "g2", workItemId: "wi_2", pointsEarned: 4, pointsPossible: 10 }),
      grade({ id: "g3", workItemId: "wi_3", pointsEarned: 8, pointsPossible: 10 }),
    ];
    const dropped = applyDropRule(grades, { ...quizzes, dropRule: { dropLowest: 1 } });
    expect(dropped.find((g) => g.id === "g2")!.dropped).toBe(true);
    expect(dropped.filter((g) => g.dropped)).toHaveLength(1);
  });

  it("does not drop anything when there are too few scores", () => {
    const grades = [grade({ id: "g1", workItemId: "wi_1", pointsEarned: 4, pointsPossible: 10 })];
    expect(applyDropRule(grades, { ...quizzes, dropRule: { dropLowest: 1 } })).toEqual(grades);
  });
});

describe("academic value normalization", () => {
  it("weights by category, so points are never compared raw across courses", () => {
    const categories: GradingCategory[] = [
      { ...quizzes, id: "gcat_major", name: "Major", weightPercent: 60 },
      { ...quizzes, id: "gcat_quiz", name: "Quizzes", weightPercent: 40 },
    ];
    // A 50-point paper in a 60%-weighted category beats a 200-point quiz in a 40% one.
    const paper = item({
      id: "wi_paper",
      gradingCategoryId: "gcat_major",
      pointsPossible: 50,
      workType: "paper",
    });
    const quiz = item({ id: "wi_quiz", gradingCategoryId: "gcat_quiz", pointsPossible: 200 });
    const courseWorkItems = [paper, quiz];

    const paperValue = estimateAcademicValue(paper, { courseWorkItems, categories })!;
    const quizValue = estimateAcademicValue(quiz, { courseWorkItems, categories })!;
    expect(paperValue).toBeGreaterThan(quizValue);
  });

  it("returns null rather than inventing a value when nothing is known", () => {
    const orphan = item({ id: "wi_orphan" });
    expect(estimateAcademicValue(orphan, { courseWorkItems: [orphan], categories: [] })).toBeNull();
  });
});
