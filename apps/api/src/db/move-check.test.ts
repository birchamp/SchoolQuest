import { describe, expect, it } from "vitest";
import { findMoveConflict, type MoveSurroundings } from "./move-check.js";

const around: MoveSurroundings = {
  sessions: [{ id: "s1", startAt: "2026-09-08T14:00:00Z", endAt: "2026-09-08T15:00:00Z", title: "Lab report" }],
  // Monday and Wednesday, 10:00-10:50.
  meetings: [{ daysOfWeek: "1,3", startTime: "10:00", endTime: "10:50", courseName: "Biology 101" }],
  commitments: [
    { title: "Work shift", daysOfWeek: "2", startTime: "17:00", endTime: "21:00", specificDate: null, flexibility: "fixed", locked: true },
    { title: "Dinner", daysOfWeek: "0,1,2,3,4,5,6", startTime: "18:00", endTime: "18:45", specificDate: null, flexibility: "flexible", locked: false },
    { title: "Dentist", daysOfWeek: "", startTime: "09:00", endTime: "10:00", specificDate: "2026-09-10", flexibility: "fixed", locked: false },
  ],
  termStartDate: "2026-08-24",
  termEndDate: "2026-12-11",
};

const move = (start: string, end: string) => findMoveConflict({ startAt: start, endAt: end }, around);

describe("findMoveConflict", () => {
  it("allows a free hour", () => {
    expect(move("2026-09-08T09:00:00Z", "2026-09-08T10:00:00Z")).toBeNull();
  });

  it("refuses to land on another block, and names it", () => {
    expect(move("2026-09-08T14:30:00Z", "2026-09-08T15:30:00Z")).toMatch(/Lab report/);
  });

  it("touching edges is not an overlap", () => {
    expect(move("2026-09-08T15:00:00Z", "2026-09-08T16:00:00Z")).toBeNull();
  });

  it("refuses a class meeting on a meeting day and allows the same hour on another day", () => {
    // 2026-09-07 is a Monday.
    expect(move("2026-09-07T10:15:00Z", "2026-09-07T11:00:00Z")).toMatch(/Biology 101/);
    expect(move("2026-09-08T10:15:00Z", "2026-09-08T11:00:00Z")).toBeNull();
  });

  it("refuses a fixed commitment but lets a flexible one be traded away", () => {
    // Tuesday shift.
    expect(move("2026-09-08T18:00:00Z", "2026-09-08T19:00:00Z")).toMatch(/Work shift/);
    // Wednesday dinner is flexible.
    expect(move("2026-09-09T18:00:00Z", "2026-09-09T18:30:00Z")).toBeNull();
  });

  it("honours a one-off dated commitment only on its date", () => {
    expect(move("2026-09-10T09:15:00Z", "2026-09-10T09:45:00Z")).toMatch(/Dentist/);
    expect(move("2026-09-11T09:15:00Z", "2026-09-11T09:45:00Z")).toBeNull();
  });

  it("keeps a block inside the term", () => {
    expect(move("2026-12-12T09:00:00Z", "2026-12-12T10:00:00Z")).toMatch(/outside the term/);
    expect(move("2026-08-23T09:00:00Z", "2026-08-23T10:00:00Z")).toMatch(/outside the term/);
  });
});
