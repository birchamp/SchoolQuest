import { describe, expect, it } from "vitest";
import type { WorkItem, WorkStatus, WorkType } from "@schoolquest/domain";
import {
  computeProjectProgress,
  summarizeProjects,
  type CompletedBlock,
} from "./project-progress.js";

const NOW = "2026-09-14T09:00:00.000Z";

let counter = 0;

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  counter += 1;
  return {
    id: `wi_pp_${counter}`,
    courseId: "c1",
    parentWorkItemId: null,
    title: `Item ${counter}`,
    description: null,
    workType: "paper" as WorkType,
    availableAt: null,
    dueAt: "2026-10-30T23:59:00.000Z",
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: 600,
    remainingMinutes: 600,
    cognitiveDemand: "high",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "not_started" as WorkStatus,
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

function done(workItemId: string, minutes: number, endAt: string): CompletedBlock {
  return { workItemId, minutes, endAt };
}

/** 15 hours a week: a realistic study load, and the yardstick every claim is measured against. */
const WEEKLY_CAPACITY = 900;

function progress(
  workItems: WorkItem[],
  completed: CompletedBlock[] = [],
  booked: { workItemId: string; minutes: number }[] = [],
  weeklyCapacityMinutes = WEEKLY_CAPACITY,
) {
  return computeProjectProgress({ workItems, completed, booked, now: NOW, weeklyCapacityMinutes });
}

describe("what counts as a project", () => {
  it("includes anything too big for one sitting, whatever the syllabus called it", () => {
    const bigProblemSet = item({ workType: "problem_set", estimatedMinutes: 300, remainingMinutes: 300 });
    expect(progress([bigProblemSet])).toHaveLength(1);
  });

  it("excludes short work even when its type sounds important", () => {
    const shortPaper = item({ workType: "paper", estimatedMinutes: 30, remainingMinutes: 30 });
    expect(progress([shortPaper])).toHaveLength(0);
  });

  it("includes a parent that has been broken into stages, however small it looks itself", () => {
    const parent = item({ estimatedMinutes: 0, remainingMinutes: 0 });
    const stage = item({ parentWorkItemId: parent.id, estimatedMinutes: 90, remainingMinutes: 90 });
    const rows = progress([parent, stage]);
    // The parent is the project; the stage is not a project in its own right.
    expect(rows.map((r) => r.workItemId)).toEqual([parent.id]);
    expect(rows[0]!.stages).toHaveLength(1);
  });

  it("leaves cancelled work out", () => {
    expect(progress([item({ status: "canceled" })])).toHaveLength(0);
  });
});

describe("measuring where a project stands", () => {
  it("counts invested minutes from completed blocks only", () => {
    const project = item({ remainingMinutes: 400 });
    const [row] = progress(
      [project],
      [done(project.id, 120, "2026-09-10T11:00:00.000Z"), done(project.id, 80, "2026-09-12T11:00:00.000Z")],
    );
    expect(row!.investedMinutes).toBe(200);
    expect(row!.completionFraction).toBeCloseTo((600 - 400) / 600);
  });

  it("rolls stage effort and stage progress up into the parent", () => {
    const parent = item({ estimatedMinutes: null, remainingMinutes: null });
    const a = item({ parentWorkItemId: parent.id, estimatedMinutes: 200, remainingMinutes: 0, status: "completed" });
    const b = item({ parentWorkItemId: parent.id, estimatedMinutes: 200, remainingMinutes: 200 });
    const [row] = progress([parent, a, b], [done(a.id, 210, "2026-09-11T11:00:00.000Z")]);

    expect(row!.estimatedMinutes).toBe(400);
    expect(row!.remainingMinutes).toBe(200);
    expect(row!.investedMinutes).toBe(210);
    expect(row!.completionFraction).toBeCloseTo(0.5);
    expect(row!.stages.filter((s) => s.done)).toHaveLength(1);
  });

  it("falls back to counting stages when nobody estimated the effort", () => {
    const parent = item({ estimatedMinutes: null, remainingMinutes: null });
    const stages = [1, 2, 3, 4].map((n) =>
      item({
        parentWorkItemId: parent.id,
        title: `Stage ${n}`,
        estimatedMinutes: null,
        remainingMinutes: null,
        status: n === 1 ? "completed" : "not_started",
      }),
    );
    const [row] = progress([parent, ...stages]);
    // Dividing by an estimate nobody gave would be inventing a number; counting real
    // stages is a true statement about the same thing.
    expect(row!.completionFraction).toBeCloseTo(0.25);
  });

  it("states the minutes per week needed from here", () => {
    // The figure a student cannot compute in their head. 400 minutes due in 28 days is
    // 100 minutes a week; the same 400 due in 7 days is all of it at once.
    const project = item({ remainingMinutes: 400, dueAt: "2026-10-12T09:00:00.000Z" });
    expect(progress([project])[0]!.neededPerWeekMinutes).toBe(100);

    const soon = item({ remainingMinutes: 400, dueAt: "2026-09-21T09:00:00.000Z" });
    expect(progress([soon])[0]!.neededPerWeekMinutes).toBe(400);
  });

  it("reports no weekly figure when there is no deadline to work back from", () => {
    expect(progress([item({ dueAt: null })])[0]!.neededPerWeekMinutes).toBeNull();
  });

  it("still records booked minutes for the reader, without judging by them", () => {
    const project = item({ remainingMinutes: 400 });
    const [row] = progress([project], [], [{ workItemId: project.id, minutes: 120 }]);
    expect(row!.bookedMinutes).toBe(120);
  });

  it("reports days since progress, and null when there has been none", () => {
    const project = item();
    expect(progress([project])[0]!.daysSinceProgress).toBeNull();
    const [row] = progress([project], [done(project.id, 60, "2026-09-04T09:00:00.000Z")]);
    expect(row!.daysSinceProgress).toBe(10);
  });
});

describe("project health", () => {
  it("calls untouched work not started, without implying fault", () => {
    // A comfortable project: 600 minutes over six weeks against 900 minutes a week.
    const [row] = progress([item({ dueAt: "2026-10-26T09:00:00.000Z" })]);
    expect(row!.health).toBe("not_started");
  });

  it("does not flag a healthy paced project just because only one week is booked", () => {
    // The regression this model was rewritten to prevent. Long work is paced, so a
    // well-managed project holds one horizon's blocks and no more. Judging by booked-versus-
    // remaining reported every such project as short of time, permanently — and a warning
    // that is always on is noise that teaches the student to ignore the screen.
    const project = item({ remainingMinutes: 600, dueAt: "2026-10-26T09:00:00.000Z" });
    const [row] = progress(
      [project],
      [done(project.id, 120, "2026-09-13T11:00:00.000Z")],
      [{ workItemId: project.id, minutes: 150 }],
    );
    expect(row!.health).toBe("on_track");
  });

  it("says plainly when the work cannot fit before the deadline", () => {
    // 1200 minutes needed inside a week, against 900 minutes of study time. This is
    // arithmetic, so it can be stated without hedging.
    const project = item({ remainingMinutes: 1200, dueAt: "2026-09-20T09:00:00.000Z" });
    const [row] = progress([project], [done(project.id, 60, "2026-09-13T11:00:00.000Z")]);
    expect(row!.neededPerWeekMinutes).toBeGreaterThan(900);
    expect(row!.health).toBe("will_not_fit");
  });

  it("warns when one project would take over half of every study hour", () => {
    // Possible, but it crowds out five other courses — worth knowing before it is the only
    // option left.
    // 1000 minutes across two weeks is 500 a week, against 900 of capacity.
    const project = item({ remainingMinutes: 1000, dueAt: "2026-09-28T09:00:00.000Z" });
    const [row] = progress([project], [done(project.id, 60, "2026-09-13T11:00:00.000Z")]);
    expect(row!.neededPerWeekMinutes).toBeGreaterThan(450);
    expect(row!.neededPerWeekMinutes).toBeLessThan(900);
    expect(row!.health).toBe("crowding");
  });

  it("prefers the arithmetic warning over the historical one", () => {
    // Untouched for a month *and* impossible to fit: the student can act on the second.
    const project = item({ remainingMinutes: 1200, dueAt: "2026-09-20T09:00:00.000Z" });
    const [row] = progress([project], [done(project.id, 60, "2026-08-01T11:00:00.000Z")]);
    expect(row!.health).toBe("will_not_fit");
  });

  it("flags a stall when the timing is otherwise fine", () => {
    const project = item({ remainingMinutes: 300, dueAt: "2026-11-30T09:00:00.000Z" });
    const [row] = progress([project], [done(project.id, 300, "2026-08-25T11:00:00.000Z")]);
    expect(row!.daysSinceProgress).toBeGreaterThanOrEqual(10);
    expect(row!.health).toBe("stalled");
  });

  it("calls a recently advanced, comfortably timed project on track", () => {
    const project = item({ remainingMinutes: 300, dueAt: "2026-11-30T09:00:00.000Z" });
    const [row] = progress([project], [done(project.id, 300, "2026-09-13T11:00:00.000Z")]);
    expect(row!.health).toBe("on_track");
  });

  it("never claims a timing problem for work with no known due date", () => {
    // There is no "too late" without a deadline, and inventing urgency from a missing date
    // is exactly what the rest of this app refuses to do.
    const undated = item({ dueAt: null, remainingMinutes: 4000 });
    const [row] = progress([undated], [done(undated.id, 60, "2026-09-13T11:00:00.000Z")]);
    expect(row!.health).toBe("on_track");
  });

  it("makes no timing claim when capacity is unknown", () => {
    const project = item({ remainingMinutes: 4000, dueAt: "2026-09-20T09:00:00.000Z" });
    const [row] = progress([project], [done(project.id, 60, "2026-09-13T11:00:00.000Z")], [], 0);
    expect(row!.health).toBe("on_track");
  });

  it("recognises finished work from status and from zero remaining effort", () => {
    expect(progress([item({ status: "submitted" })])[0]!.health).toBe("finished");
    const byEffort = item({ remainingMinutes: 0 });
    expect(
      progress([byEffort], [done(byEffort.id, 600, "2026-09-12T11:00:00.000Z")])[0]!.health,
    ).toBe("finished");
  });
});

describe("ordering and summary", () => {
  it("orders by due date and puts undated projects last", () => {
    const later = item({ title: "Later", dueAt: "2026-11-01T09:00:00.000Z" });
    const sooner = item({ title: "Sooner", dueAt: "2026-09-20T09:00:00.000Z" });
    const undated = item({ title: "Undated", dueAt: null });
    expect(progress([undated, later, sooner]).map((r) => r.title)).toEqual([
      "Sooner",
      "Later",
      "Undated",
    ]);
  });

  it("summarizes the counts that are worth acting on", () => {
    const impossible = item({ title: "Impossible", remainingMinutes: 1200, dueAt: "2026-09-20T09:00:00.000Z" });
    const fine = item({
      title: "Fine",
      remainingMinutes: 100,
      estimatedMinutes: 400,
      dueAt: "2026-11-30T09:00:00.000Z",
    });
    const untouched = item({
      title: "Untouched",
      remainingMinutes: 300,
      dueAt: "2026-12-10T09:00:00.000Z",
    });
    const rows = progress(
      [impossible, fine, untouched],
      [done(fine.id, 300, "2026-09-13T11:00:00.000Z")],
      [
        { workItemId: impossible.id, minutes: 60 },
        { workItemId: fine.id, minutes: 120 },
      ],
    );
    const summary = summarizeProjects(rows, { investedMinutes: 300, sessionsCompleted: 5 });
    expect(summary).toMatchObject({
      projectsTotal: 3,
      projectsWillNotFit: 1,
      projectsNotStarted: 1,
      investedMinutes: 300,
      sessionsCompleted: 5,
      bookedMinutes: 180,
    });
  });
});

describe("a deadline that has already passed", () => {
  it("says so, rather than only that the work was never started", () => {
    // The real semester has exactly this row: a paper whose syllabus stated a 2025 date, so
    // it reads as 237 days overdue. "Not started" is true and useless; "past due" is what
    // the student can act on — and the action is usually to fix the date.
    const overdue = item({ dueAt: "2025-12-04T09:00:00.000Z", remainingMinutes: 240 });
    const [row] = progress([overdue]);
    expect(row!.daysAway).toBeLessThan(0);
    expect(row!.health).toBe("past_due");
  });

  it("still reports finished work as finished, not as overdue", () => {
    const done = item({ dueAt: "2025-12-04T09:00:00.000Z", status: "submitted" });
    expect(progress([done])[0]!.health).toBe("finished");
  });

  it("counts past-due projects in the summary", () => {
    const overdue = item({ dueAt: "2025-12-04T09:00:00.000Z", remainingMinutes: 240 });
    const summary = summarizeProjects(progress([overdue]), {
      investedMinutes: 0,
      sessionsCompleted: 0,
    });
    expect(summary.projectsPastDue).toBe(1);
  });
});
