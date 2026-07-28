import { computeCourseStanding, type CourseStanding } from "@schoolquest/domain";
import {
  buildSeedSemester,
  SEED_NOW,
  SEED_WEEK_START,
  type SeedSemester,
} from "@schoolquest/fixtures";
import type { PlanningInput } from "./types.js";

export { SEED_NOW, SEED_WEEK_START, buildSeedSemester };
export type { SeedSemester };

/**
 * Assembles a raw semester into a PlanningInput. Used by the regression tests and by the
 * API's seed script, so both exercise exactly the same assembly path.
 */
export function planningInputFor(
  seed: SeedSemester,
  options: { horizonStart: string; horizonDays?: number; now: string },
): PlanningInput {
  return {
    termId: seed.term.id,
    horizonStart: options.horizonStart,
    horizonDays: options.horizonDays ?? 7,
    now: options.now,
    preferences: seed.term.planningPreferences,
    courses: seed.courses,
    gradingCategories: seed.gradingCategories,
    meetingPatterns: seed.meetingPatterns,
    commitments: seed.commitments,
    availabilityRules: seed.availabilityRules,
    workItems: seed.workItems,
    dependencies: seed.dependencies,
    existingSessions: seed.existingSessions,
    courseStandings: standingsFor(seed),
    seed: 42,
  };
}

/** Course standing for every course in a semester, keyed by course id. */
export function standingsFor(seed: SeedSemester): Record<string, CourseStanding> {
  const standings: Record<string, CourseStanding> = {};
  for (const course of seed.courses) {
    const workItems = seed.workItems.filter((w) => w.courseId === course.id);
    const itemIds = new Set(workItems.map((w) => w.id));
    standings[course.id] = computeCourseStanding({
      workItems,
      grades: seed.grades.filter((g) => itemIds.has(g.workItemId)),
      categories: seed.gradingCategories.filter((c) => c.courseId === course.id),
    });
  }
  return standings;
}

/** The reference week from the seed scenario, ready to plan. */
export function seedPlanningInput(overrides: Partial<PlanningInput> = {}): PlanningInput {
  return {
    ...planningInputFor(buildSeedSemester(), {
      horizonStart: SEED_WEEK_START,
      now: SEED_NOW,
    }),
    ...overrides,
  };
}
