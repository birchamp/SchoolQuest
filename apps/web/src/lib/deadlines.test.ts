import { describe, expect, it } from "vitest";
import type { WorkItem, WorkStatus } from "@schoolquest/domain";
import { deadlinesByDay } from "@schoolquest/planning-engine";
import { openDeadlines } from "./deadlines";

/**
 * The board and the calendar must hold the same work.
 *
 * Reported by a student: assignments on the assignments board that are not on the calendar.
 * They were not lost records -- the calendar drew hours, a deadline costs none, so a piece of
 * work only ever reached the screen through a study block the planner happened to place inside
 * the seven days. Everything else was on the board and on no day of the week.
 *
 * These fix the equality rather than the symptom. The rule under test is not "deadlines render"
 * but "the set handed to the calendar is the set the board lists", because that is the property
 * a future filter can quietly break -- and it breaks invisibly, since the missing row looks
 * exactly like a day with nothing due on it.
 */

const MONDAY = "2026-09-07";

function item(o: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_1",
    termId: "trm_t",
    courseId: "crs_his",
    parentWorkItemId: null,
    title: "Response paper",
    workType: "paper",
    status: "not_started",
    dueAt: `${MONDAY}T23:59:00.000Z`,
    availableAt: null,
    estimatedMinutes: 90,
    remainingMinutes: null,
    pointsPossible: null,
    gradingCategoryId: null,
    weightFraction: null,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    userPriority: 0,
    sourceConfidence: "confirmed",
    sourceDocumentId: null,
    notes: null,
    ...o,
  } as WorkItem;
}

/** The assignments board's own rule, with "show finished" off (see `Tables.tsx`). */
function onTheBoard(items: WorkItem[]): WorkItem[] {
  return items.filter(
    (w) => w.status !== "completed" && w.status !== "submitted" && w.status !== "canceled",
  );
}

describe("what the calendar is handed", () => {
  it("carries every open dated row the assignments board lists", () => {
    const items = [
      item({ id: "wi_paper", title: "Response paper" }),
      item({ id: "wi_quiz", title: "Quiz 2", workType: "quiz", status: "in_progress" }),
      item({ id: "wi_lab", title: "Lab 3", workType: "lab", status: "blocked" }),
      // A project is scheduled through its stages and so never gets a block of its own. It is
      // still the biggest thing on the board, and it used to appear on no day of the calendar
      // for exactly that reason.
      item({ id: "wi_project", title: "Field project", workType: "group_project" }),
    ];

    const board = onTheBoard(items)
      .filter((w) => w.dueAt)
      .map((w) => w.id);
    const calendar = openDeadlines(items).map((d) => d.workItemId);
    expect([...calendar].sort()).toEqual([...board].sort());
  });

  it("drops the three states the board itself drops, and nothing else", () => {
    const dropped: WorkStatus[] = ["completed", "submitted", "canceled"];
    for (const status of dropped) {
      expect(openDeadlines([item({ status })])).toEqual([]);
    }
    // "Optional" is on the board, so it is on the calendar. A student who has been told a thing
    // is optional still has to see the date it stops being possible.
    expect(openDeadlines([item({ status: "optional" })])).toHaveLength(1);
  });

  it("leaves undated work out, because there is no day to draw it on", () => {
    expect(openDeadlines([item({ dueAt: null })])).toEqual([]);
  });

  it("lands work with no block booked on its own day", () => {
    const due = deadlinesByDay(openDeadlines([item({ id: "wi_paper" })]), {
      horizonStart: MONDAY,
      horizonDays: 7,
      // The whole point: the planner booked nothing at all this week.
      sessions: [],
    });
    expect(due.get(MONDAY)).toHaveLength(1);
    expect(due.get(MONDAY)![0]!.nothingBooked).toBe(true);
  });
});
