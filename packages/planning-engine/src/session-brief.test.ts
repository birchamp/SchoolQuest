import { describe, expect, it } from "vitest";
import type { WorkItem, WorkStatus, WorkType } from "@schoolquest/domain";
import { buildSessionBrief, type BriefableSession } from "./session-brief.js";

const MONDAY = "2026-09-07";
const NOW = `${MONDAY}T08:00:00.000Z`;

let counter = 0;

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  counter += 1;
  return {
    id: `wi_${counter}`,
    courseId: "c1",
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
    status: "in_progress" as WorkStatus,
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

function block(workItemId: string, date: string, hour: number, minutes = 60): BriefableSession {
  return {
    id: `ws_${workItemId}_${date}_${hour}`,
    workItemId,
    startAt: `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    minutes,
  };
}

function brief(
  sessions: BriefableSession[],
  workItems: WorkItem[],
  slackMinutes?: number,
) {
  return buildSessionBrief({
    sessions,
    workItems,
    now: NOW,
    horizonStart: MONDAY,
    horizonDays: 7,
    ...(slackMinutes === undefined ? {} : { slackMinutes }),
  });
}

describe("encounter grouping", () => {
  it("collapses several blocks of one item on one day into a single beat", () => {
    const paper = item({ title: "Formal Lab Report" });
    const result = brief(
      [block(paper.id, MONDAY, 13), block(paper.id, MONDAY, 15), block(paper.id, MONDAY, 17)],
      [paper],
    );

    expect(result.encounters).toHaveLength(1);
    expect(result.encounters[0]).toMatchObject({ blocks: 3, minutes: 180, title: "Formal Lab Report" });
    expect(result.encounters[0]!.sessionIds).toHaveLength(3);
  });

  it("keeps the same item on different days as separate beats", () => {
    const paper = item();
    const result = brief([block(paper.id, MONDAY, 13), block(paper.id, "2026-09-08", 13)], [paper]);
    expect(result.encounters).toHaveLength(2);
  });
});

describe("encounter kinds", () => {
  it("calls the day a thing is due a major assessment, however short the block", () => {
    const exam = item({ workType: "exam", title: "Midterm", dueAt: `${MONDAY}T09:00:00.000Z` });
    const result = brief([block(exam.id, MONDAY, 9, 20)], [exam]);
    expect(result.encounters[0]!.kind).toBe("major_assessment");
  });

  it("does not call every block of exam prep a major assessment", () => {
    // Classifying on work type alone made 12 of 23 beats in the five-course test semester
    // a "set piece" — a half-hour revision block three weeks out ranked with the exam
    // itself. If everything is the climax, nothing is.
    const exam = item({ workType: "exam", title: "Midterm", dueAt: "2026-09-28T09:00:00.000Z" });
    const result = brief(
      [block(exam.id, MONDAY, 9, 30), block(exam.id, "2026-09-28", 9, 30)],
      [exam],
    );
    const [prep, event] = result.encounters;
    expect(prep!.date).toBe(MONDAY);
    expect(prep!.kind).not.toBe("major_assessment");
    expect(event!.kind).toBe("major_assessment");
  });

  it("treats exam prep as ordinary work, not as the event", () => {
    const prep = item({ workType: "exam_prep", title: "Midterm review", dueAt: `${MONDAY}T09:00:00.000Z` });
    const result = brief([block(prep.id, MONDAY, 9, 90)], [prep]);
    expect(result.encounters[0]!.kind).not.toBe("major_assessment");
  });

  it("marks a paper's due day, not the days of work leading to it", () => {
    const paper = item({ workType: "paper", dueAt: `${MONDAY}T23:59:00.000Z` });
    expect(brief([block(paper.id, MONDAY, 9, 60)], [paper]).encounters[0]!.kind).toBe(
      "major_assessment",
    );

    const distant = item({ workType: "paper", dueAt: "2026-10-30T23:59:00.000Z" });
    expect(brief([block(distant.id, MONDAY, 9, 60)], [distant]).encounters[0]!.kind).not.toBe(
      "major_assessment",
    );
  });

  it("names three blocks of one thing in a day back-to-back", () => {
    const lab = item({ title: "Lab Notebook" });
    const result = brief(
      [block(lab.id, MONDAY, 13, 30), block(lab.id, MONDAY, 14, 30), block(lab.id, MONDAY, 15, 30)],
      [lab],
    );
    // Short blocks, but three of them in a row is the day's character.
    expect(result.encounters[0]!.kind).toBe("back_to_back");
  });

  it("recognises a course's routine work by its recurring title", () => {
    const items = [1, 2, 3, 4].map((n) => item({ title: `Discussion Post ${n}`, status: "in_progress" }));
    const result = brief([block(items[0]!.id, MONDAY, 13, 45)], items);
    expect(result.encounters[0]!.kind).toBe("recurring");
  });

  it("does not treat two of a kind as routine", () => {
    const items = [1, 2].map((n) => item({ title: `Essay ${n}` }));
    const result = brief([block(items[0]!.id, MONDAY, 13, 45)], items);
    expect(result.encounters[0]!.kind).not.toBe("recurring");
  });

  it("marks untouched work as a first pass", () => {
    const fresh = item({ status: "not_started", estimatedMinutes: 90, remainingMinutes: 90 });
    expect(brief([block(fresh.id, MONDAY, 13, 45)], [fresh]).encounters[0]!.kind).toBe("first_pass");
  });

  it("does not call work in progress a first pass", () => {
    const started = item({ status: "in_progress", estimatedMinutes: 90, remainingMinutes: 30 });
    expect(brief([block(started.id, MONDAY, 13, 45)], [started]).encounters[0]!.kind).toBe(
      "sustained",
    );
  });

  it("falls back to a short block, then to sustained, on length", () => {
    const short = item({ status: "in_progress", remainingMinutes: 30 });
    expect(brief([block(short.id, MONDAY, 13, 25)], [short]).encounters[0]!.kind).toBe(
      "short_block",
    );
    const long = item({ status: "in_progress", remainingMinutes: 30 });
    expect(brief([block(long.id, MONDAY, 13, 120)], [long]).encounters[0]!.kind).toBe("sustained");
  });
});

describe("day shape", () => {
  it("weighs high-demand work more heavily than its clock time", () => {
    const easy = item({ cognitiveDemand: "low", status: "in_progress", remainingMinutes: 1 });
    const hard = item({ cognitiveDemand: "high", status: "in_progress", remainingMinutes: 1 });

    const easyDay = brief([block(easy.id, MONDAY, 9, 240)], [easy]).days[0]!;
    const hardDay = brief([block(hard.id, MONDAY, 9, 240)], [hard]).days[0]!;

    expect(easyDay.minutes).toBe(hardDay.minutes);
    expect(hardDay.weightedHours).toBeGreaterThan(easyDay.weightedHours);
    expect(hardDay.load).toBe("heavy");
    expect(easyDay.load).toBe("steady");
  });

  it("reports an empty day as clear rather than omitting it", () => {
    const result = brief([], [item()]);
    expect(result.days).toHaveLength(7);
    expect(result.days.every((d) => d.load === "clear")).toBe(true);
  });

  it("never calls a day carrying the exam itself light", () => {
    const exam = item({ workType: "exam", dueAt: `${MONDAY}T09:00:00.000Z` });
    const day = brief([block(exam.id, MONDAY, 9, 20)], [exam]).days[0]!;
    expect(day.load).toBe("steady");
    expect(day.carriesAssessment).toBe(true);
  });

  it("marks the set-piece day even when no time is booked for it", () => {
    // An exam you have scheduled nothing for is still the day's event — arguably more so.
    const exam = item({ workType: "exam", dueAt: "2026-09-10T09:00:00.000Z" });
    const days = brief([], [exam]).days;
    const examDay = days.find((d) => d.date === "2026-09-10")!;
    expect(examDay.carriesAssessment).toBe(true);
    expect(examDay.encounters).toBe(0);
    expect(examDay.load).toBe("steady");
  });
});

describe("the spine and the crux", () => {
  it("picks the item holding the most of the week", () => {
    const big = item({ title: "Research Paper" });
    const small = item({ title: "Reading" });
    const result = brief(
      [block(big.id, MONDAY, 13, 120), block(big.id, "2026-09-09", 13, 120), block(small.id, MONDAY, 9, 30)],
      [big, small],
    );
    expect(result.spine).toMatchObject({ workItemId: big.id, minutes: 240, blocks: 2 });
  });

  it("breaks a tie on minutes with the nearer due date", () => {
    const soon = item({ title: "Due Tuesday", dueAt: "2026-09-08T23:59:00.000Z" });
    const later = item({ title: "Due Friday", dueAt: "2026-09-11T23:59:00.000Z" });
    const result = brief([block(later.id, MONDAY, 9, 60), block(soon.id, MONDAY, 13, 60)], [soon, later]);
    expect(result.spine!.workItemId).toBe(soon.id);
  });

  it("prefers a known due date over an unknown one, rather than inventing one", () => {
    const dated = item({ dueAt: "2026-09-11T23:59:00.000Z" });
    const undated = item({ dueAt: null });
    const result = brief([block(undated.id, MONDAY, 9, 60), block(dated.id, MONDAY, 13, 60)], [dated, undated]);
    expect(result.spine!.workItemId).toBe(dated.id);
  });

  it("has no spine and no crux when nothing is scheduled", () => {
    const result = brief([], []);
    expect(result.spine).toBeNull();
    expect(result.crux).toBeNull();
  });

  it("puts the crux on the set piece even when another day is busier", () => {
    const exam = item({ workType: "exam", dueAt: "2026-09-10T09:00:00.000Z" });
    const grind = item({ cognitiveDemand: "high", status: "in_progress", remainingMinutes: 1 });
    const result = brief(
      [block(exam.id, "2026-09-10", 9, 60), block(grind.id, MONDAY, 9, 300)],
      [exam, grind],
    );
    expect(result.crux!.date).toBe("2026-09-10");
    expect(result.crux!.carriesAssessment).toBe(true);
  });

  it("otherwise puts the crux on the heaviest day", () => {
    const work = item({ status: "in_progress", remainingMinutes: 1 });
    const result = brief(
      [block(work.id, MONDAY, 9, 60), block(work.id, "2026-09-09", 9, 300)],
      [work],
    );
    expect(result.crux!.date).toBe("2026-09-09");
  });
});

describe("contingencies", () => {
  it("names the shortest block still ahead for a small window", () => {
    const long = item({ status: "in_progress", remainingMinutes: 1 });
    const quick = item({ status: "in_progress", remainingMinutes: 1 });
    const result = brief(
      [block(long.id, MONDAY, 13, 120), block(quick.id, MONDAY, 15, 25)],
      [long, quick],
    );
    const short = result.fallbacks.find((f) => f.code === "SHORT_WINDOW");
    expect(short).toMatchObject({ minutes: 25, workItemIds: [quick.id] });
  });

  it("names what breaks if the crux day is lost", () => {
    // All of this item's time is on the crux day and it is due the next morning, so there
    // is nowhere else for the work to go.
    const tight = item({ dueAt: "2026-09-08T09:00:00.000Z", status: "in_progress", remainingMinutes: 1 });
    const result = brief([block(tight.id, MONDAY, 13, 240)], [tight]);
    const lost = result.fallbacks.find((f) => f.code === "CRUX_DAY_LOST");
    expect(lost?.workItemIds).toEqual([tight.id]);
  });

  it("does not claim something breaks when it has time later in the week", () => {
    const roomy = item({ dueAt: "2026-09-13T23:59:00.000Z", status: "in_progress", remainingMinutes: 1 });
    const result = brief(
      [block(roomy.id, MONDAY, 13, 240), block(roomy.id, "2026-09-12", 13, 60)],
      [roomy],
    );
    expect(result.fallbacks.find((f) => f.code === "CRUX_DAY_LOST")).toBeUndefined();
  });

  it("states slack honestly in both directions", () => {
    const work = item();
    expect(brief([block(work.id, MONDAY, 13)], [work], 240).fallbacks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SLACK_REMAINING", minutes: 240 })]),
    );
    expect(brief([block(work.id, MONDAY, 13)], [work], 0).fallbacks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "NO_SLACK" })]),
    );
  });

  it("says nothing about slack when the caller does not know it", () => {
    const work = item();
    const codes = brief([block(work.id, MONDAY, 13)], [work]).fallbacks.map((f) => f.code);
    expect(codes).not.toContain("SLACK_REMAINING");
    expect(codes).not.toContain("NO_SLACK");
  });
});

describe("milestones", () => {
  it("reports how much preparation is already laid down", () => {
    const exam = item({ workType: "exam", title: "Midterm", dueAt: "2026-09-19T09:00:00.000Z" });
    const result = brief(
      [block(exam.id, "2026-09-16", 13, 60), block(exam.id, "2026-09-17", 13, 90)],
      [exam],
    );
    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0]).toMatchObject({
      title: "Midterm",
      prepBlocks: 2,
      prepMinutes: 150,
      daysAway: 12,
    });
  });

  it("says plainly when nothing is prepared yet", () => {
    const final = item({ workType: "exam", title: "Final", dueAt: "2026-12-14T09:00:00.000Z" });
    expect(brief([], [final]).milestones[0]).toMatchObject({ prepBlocks: 0, prepMinutes: 0 });
  });

  it("leaves out work with no known due date rather than guessing one", () => {
    const undated = item({ workType: "exam", dueAt: null });
    expect(brief([], [undated]).milestones).toHaveLength(0);
  });

  it("flags a due date that was inferred rather than stated", () => {
    const inferred = item({
      workType: "paper",
      dueAt: "2026-10-01T23:59:00.000Z",
      sourceConfidence: "high_inference",
    });
    expect(brief([], [inferred]).milestones[0]!.dueConfirmed).toBe(false);
  });

  it("drops milestones that are already finished", () => {
    const done = item({ workType: "exam", dueAt: "2026-09-19T09:00:00.000Z", status: "completed" });
    expect(brief([], [done]).milestones).toHaveLength(0);
  });

  it("keeps an overdue but still open milestone, with a negative distance", () => {
    const overdue = item({ workType: "paper", dueAt: "2026-09-01T09:00:00.000Z" });
    expect(brief([], [overdue]).milestones[0]!.daysAway).toBeLessThan(0);
  });

  it("orders milestones by due date", () => {
    const later = item({ workType: "exam", dueAt: "2026-11-01T09:00:00.000Z" });
    const sooner = item({ workType: "paper", dueAt: "2026-09-20T09:00:00.000Z" });
    expect(brief([], [later, sooner]).milestones.map((m) => m.workItemId)).toEqual([
      sooner.id,
      later.id,
    ]);
  });

  it("ignores routine work — a milestone is a landmark, not every deadline", () => {
    const reading = item({ workType: "reading", dueAt: "2026-09-20T09:00:00.000Z" });
    expect(brief([], [reading]).milestones).toHaveLength(0);
  });
});

describe("undated major work", () => {
  it("keeps an undated exam visible instead of dropping it", () => {
    // Twelve exam-type items were extracted from the five-course test semester and only
    // three carried a due date the syllabus actually stated. An arc built solely from dated
    // work showed three landmarks for a whole term and silently omitted every exam.
    const undated = item({ workType: "exam", title: "Final Exam", dueAt: null });
    const result = brief([], [undated]);
    expect(result.milestones).toHaveLength(0);
    expect(result.undatedMilestones).toHaveLength(1);
    expect(result.undatedMilestones[0]).toMatchObject({ title: "Final Exam", prepBlocks: 0 });
  });

  it("reports time already booked against an undated exam", () => {
    // Prep laid down for something nobody has dated means the plan is guessing, which is
    // worth saying out loud.
    const undated = item({ workType: "exam", dueAt: null });
    const result = brief([block(undated.id, MONDAY, 13, 60), block(undated.id, MONDAY, 15, 30)], [undated]);
    expect(result.undatedMilestones[0]).toMatchObject({ prepBlocks: 2, prepMinutes: 90 });
  });

  it("leaves finished work out of both lists", () => {
    const done = item({ workType: "exam", dueAt: null, status: "submitted" });
    const result = brief([], [done]);
    expect(result.undatedMilestones).toHaveLength(0);
    expect(result.milestones).toHaveLength(0);
  });

  it("ignores routine work with no date — an undated reading is not a landmark", () => {
    const reading = item({ workType: "reading", dueAt: null });
    expect(brief([], [reading]).undatedMilestones).toHaveLength(0);
  });
});
