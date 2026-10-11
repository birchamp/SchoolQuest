import { z } from "zod";
import { FAIL_LETTER, PASS_LETTER } from "@schoolquest/domain";

/**
 * The body of `PUT /work-items/:id/grade`, and the rules for turning it into a stored result.
 *
 * Kept apart from the route so the rules can be tested without a database. Each rule here was
 * found missing in review:
 *   - An empty or misspelled body (`{}`, `{ score: 8 }`) used to parse, fall back to the item's
 *     total, and store a result with nothing in it -- which marked the work as graded.
 *   - The score-above-total check ran before that fallback, so `{ pointsEarned: 15 }` on a
 *     10-point item stored 15/10 and pushed a category past 100%.
 *   - `passFail` alongside a `letterGrade` silently threw the letter away.
 */
export const gradeBody = z.object({
  pointsEarned: z.number().nonnegative().nullable().default(null),
  pointsPossible: z.number().positive().nullable().default(null),
  letterGrade: z.string().max(8).nullable().default(null),
  passFail: z.enum(["pass", "fail"]).nullable().default(null),
  confirmationStatus: z.enum(["confirmed", "extracted_unreviewed", "estimated"]).default("confirmed"),
});
export type GradeBody = z.infer<typeof gradeBody>;

export interface GradeEntry {
  pointsEarned: number | null;
  pointsPossible: number | null;
  letterGrade: string | null;
}

/**
 * Resolves a parsed body against the item's own total. Returns the values to store, or the
 * message to send back with a 400.
 */
export function resolveGradeEntry(
  body: GradeBody,
  itemPointsPossible: number | null,
): { entry: GradeEntry } | { error: string } {
  const { pointsEarned, pointsPossible, letterGrade, passFail } = body;

  if (passFail !== null) {
    // A Pass/Fail outcome is the whole result: no points, and the outcome as the letter.
    if (pointsEarned !== null || pointsPossible !== null || letterGrade !== null) {
      return { error: "A Pass/Fail result has no score or letter; send one or the other." };
    }
    return {
      entry: {
        pointsEarned: null,
        pointsPossible: null,
        letterGrade: passFail === "pass" ? PASS_LETTER : FAIL_LETTER,
      },
    };
  }

  if (pointsEarned === null && letterGrade === null) {
    return { error: "Nothing to record: send a score, a letter grade, or Pass/Fail." };
  }

  // Fall back to the item's own points when the student gives only a score -- the syllabus
  // already said what it was out of, and making them retype it invites a mismatch.
  const outOf = pointsPossible ?? itemPointsPossible ?? null;
  // Checked against the total that will actually be stored, fallback included.
  if (pointsEarned !== null && outOf !== null && pointsEarned > outOf) {
    return { error: "A score cannot be higher than the total it is out of." };
  }

  return { entry: { pointsEarned, pointsPossible: outOf, letterGrade } };
}
