import { describe, expect, it } from "vitest";
import type { WorkItem } from "@schoolquest/domain";
import { buildCampaignRadar } from "./campaign-radar.js";

/**
 * A ceiling, not a benchmark. The radar is rebuilt on every plan read inside a Cloudflare
 * Worker's 10ms CPU budget, and `estimateAcademicValue` is O(items-per-course) per item, so
 * the build is quadratic per course. This pins the worst realistic term -- eight courses,
 * forty items each -- to a bound loose enough to pass on any CI machine and tight enough
 * that going accidentally cubic, or calling the build per-encounter, fails loudly.
 */
describe("buildCampaignRadar under a heavy term", () => {
  it("stays well inside a Worker's CPU budget", () => {
    const workItems: WorkItem[] = [];
    for (let course = 0; course < 8; course += 1) {
      for (let i = 0; i < 40; i += 1) {
        workItems.push({
          id: `wi_${course}_${i}`,
          courseId: `crs_${course}`,
          parentWorkItemId: null,
          title: `Item ${i}`,
          description: null,
          workType: i % 7 === 0 ? "exam" : "problem_set",
          availableAt: null,
          dueAt: new Date(Date.parse("2026-09-14T12:00:00Z") + (i - 8) * 86_400_000).toISOString(),
          pointsPossible: 10 + (i % 5) * 20,
          gradingCategoryId: null,
          categorySharePercent: null,
          estimatedMinutes: 60,
          remainingMinutes: null,
          cognitiveDemand: "medium",
          divisibility: "divisible",
          locationRequirement: "anywhere",
          status: "not_started",
          sourceConfidence: "confirmed",
          userPriority: 0,
        });
      }
    }
    const started = performance.now();
    const radar = buildCampaignRadar({
      workItems,
      gradingCategories: [],
      bookedByItem: {},
      now: "2026-09-14T09:00:00.000Z",
      termStartDate: "2026-08-31",
      termEndDate: "2026-12-11",
    });
    const elapsed = performance.now() - started;

    expect(radar.encounters.length).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(50);
  });
});
