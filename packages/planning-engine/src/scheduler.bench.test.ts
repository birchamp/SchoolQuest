import { describe, expect, it } from "vitest";
import { planningPreferences, type WorkItem } from "@schoolquest/domain";
import { generatePlan } from "./scheduler.js";

/**
 * A ceiling, not a benchmark. The scheduler runs inside a Cloudflare Worker request with about
 * 10ms of CPU, and the deadline rescue can try a displacement for every block against every
 * short item -- quadratic, and recursive. Unbounded it took about 45ms on this week, against
 * well under 1ms before the rescue existed; `RESCUE_STEP_BUDGET` holds it to a few. The bound is
 * loose enough for any CI machine and tight enough that losing the budget fails loudly.
 */
describe("generatePlan in a crunch week", () => {
  it("stays well inside a Worker's CPU budget", () => {
    // Forty pieces of work across five courses, all due within the week, evenings only.
    const workItems: WorkItem[] = Array.from({ length: 40 }, (_, i) => ({
      id: `wi_${i}`,
      courseId: `crs_${i % 5}`,
      parentWorkItemId: null,
      title: `Item ${i}`,
      description: null,
      workType: "other",
      availableAt: null,
      dueAt: `2026-10-${11 + (i % 6)}T23:59:00.000Z`,
      pointsPossible: null,
      gradingCategoryId: null,
      categorySharePercent: null,
      estimatedMinutes: 30 + (i % 4) * 30,
      remainingMinutes: 30 + (i % 4) * 30,
      cognitiveDemand: "medium",
      divisibility: "divisible",
      locationRequirement: "anywhere",
      status: "not_started",
      sourceConfidence: "confirmed",
      userPriority: (i % 5) - 2,
    }));
    const input = {
      termId: "term",
      horizonStart: "2026-10-10",
      horizonDays: 7,
      now: "2026-10-10T08:00:00.000Z",
      preferences: planningPreferences.parse({}),
      courses: [],
      gradingCategories: [],
      meetingPatterns: [],
      commitments: [],
      availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        id: `av_${d}`,
        termId: "term",
        dayOfWeek: d,
        startTime: "15:00",
        endTime: "22:00",
        energyLevel: "medium" as const,
        location: "anywhere" as const,
        hardness: "soft" as const,
      })),
      workItems,
      dependencies: [],
      existingSessions: [],
    };

    generatePlan(input, "warm");
    const runs = 10;
    const started = performance.now();
    for (let i = 0; i < runs; i += 1) generatePlan(input, "p");
    const average = (performance.now() - started) / runs;

    expect(average).toBeLessThan(15);
  });
});
