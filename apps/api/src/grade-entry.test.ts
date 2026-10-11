import { describe, expect, it } from "vitest";
import { gradeBody, resolveGradeEntry } from "./grade-entry.js";

function resolve(raw: unknown, itemPointsPossible: number | null = 10) {
  return resolveGradeEntry(gradeBody.parse(raw), itemPointsPossible);
}

describe("resolveGradeEntry", () => {
  it("records a score, falling back to the item's own total", () => {
    expect(resolve({ pointsEarned: 8 })).toEqual({
      entry: { pointsEarned: 8, pointsPossible: 10, letterGrade: null },
    });
    expect(resolve({ pointsEarned: 18, pointsPossible: 20 })).toEqual({
      entry: { pointsEarned: 18, pointsPossible: 20, letterGrade: null },
    });
  });

  // Issue #10: these used to store an empty result that marked the work as graded.
  it("rejects a body with nothing to record", () => {
    expect(resolve({})).toHaveProperty("error");
    expect(resolve({ score: 8 })).toHaveProperty("error");
    expect(resolve({ passfail: "pass" })).toHaveProperty("error");
    expect(resolve({ pointsEarned: null, pointsPossible: 10 })).toHaveProperty("error");
  });

  it("still accepts a letter grade on its own", () => {
    expect(resolve({ letterGrade: "B+" })).toEqual({
      entry: { pointsEarned: null, pointsPossible: 10, letterGrade: "B+" },
    });
  });

  // Issue #11: the check used to run before the fallback, so 15/10 was stored.
  it("rejects a score above the total it falls back to", () => {
    expect(resolve({ pointsEarned: 15 }, 10)).toHaveProperty("error");
    expect(resolve({ pointsEarned: 15, pointsPossible: 10 })).toHaveProperty("error");
    expect(resolve({ pointsEarned: 15, pointsPossible: 20 }, 10)).toHaveProperty("entry");
  });

  it("records Pass/Fail with no points, ignoring the item's total", () => {
    expect(resolve({ passFail: "pass" })).toEqual({
      entry: { pointsEarned: null, pointsPossible: null, letterGrade: "Pass" },
    });
    expect(resolve({ passFail: "fail" })).toEqual({
      entry: { pointsEarned: null, pointsPossible: null, letterGrade: "Fail" },
    });
  });

  // Issue #13: a letter sent with passFail used to be dropped without a word.
  it("rejects Pass/Fail mixed with a score or a letter", () => {
    expect(resolve({ passFail: "pass", pointsEarned: 8 })).toHaveProperty("error");
    expect(resolve({ passFail: "pass", pointsPossible: 10 })).toHaveProperty("error");
    expect(resolve({ passFail: "pass", letterGrade: "A" })).toHaveProperty("error");
  });
});
