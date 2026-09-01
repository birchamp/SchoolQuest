import { describe, expect, it } from "vitest";
import { dateToEpochMinutes, type Commitment, type MeetingPattern } from "@schoolquest/domain";
import { buildWeekCalendar, type WeekCalendarInput } from "./week-calendar.js";
import type { MealBreak } from "./meals.js";

/** 2026-09-07 is a Monday. */
const MONDAY = "2026-09-07";
const BASE = dateToEpochMinutes(MONDAY);

const at = (hhmm: string) => BASE + Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const iso = (hhmm: string) => `${MONDAY}T${hhmm}:00.000Z`;

function meeting(o: Partial<MeetingPattern> = {}): MeetingPattern {
  return {
    id: "mtg_1",
    courseId: "crs_bio",
    daysOfWeek: [1],
    startTime: "09:00",
    endTime: "10:15",
    location: "Science 210",
    effectiveStart: null,
    effectiveEnd: null,
    ...o,
  };
}

function commitment(o: Partial<Commitment> = {}): Commitment {
  return {
    id: "cmt_1",
    termId: "trm_t",
    title: "Work shift",
    commitmentType: "work",
    daysOfWeek: [1],
    startTime: "17:00",
    endTime: "21:00",
    specificDate: null,
    flexibility: "fixed",
    locked: false,
    ...o,
  };
}

function build(o: Partial<WeekCalendarInput> = {}) {
  return buildWeekCalendar({
    horizonStart: MONDAY,
    horizonDays: 1,
    meetingPatterns: [],
    commitments: [],
    availability: [{ dayOfWeek: 1, startTime: "08:00", endTime: "22:00" }],
    sessions: [],
    meals: [],
    ...o,
  });
}

const day = (c: ReturnType<typeof build>) => c.days[0]!;
const kinds = (c: ReturnType<typeof build>) => day(c).slots.map((s) => s.kind);

describe("the week as hours", () => {
  it("fills an empty available day with free time and nothing else", () => {
    const c = build();
    expect(kinds(c)).toEqual(["free"]);
    expect(day(c).totals.free).toBe(14 * 60);
  });

  it("says nothing at all about a day the student is not available", () => {
    const c = build({ availability: [] });
    expect(day(c).slots).toEqual([]);
  });

  it("draws a class, and the free time either side of it", () => {
    const c = build({ meetingPatterns: [meeting()] });
    expect(kinds(c)).toEqual(["free", "class", "free"]);
    const cls = day(c).slots.find((s) => s.kind === "class")!;
    expect(cls.start).toBe(at("09:00"));
    expect(cls.end).toBe(at("10:15"));
    expect(cls.courseId).toBe("crs_bio");
  });

  it("leaves no hole: every minute of the available day is in exactly one slot", () => {
    const c = build({
      meetingPatterns: [meeting()],
      commitments: [commitment()],
      sessions: [
        { workItemId: "wi_1", courseId: "crs_bio", startAt: iso("13:00"), endAt: iso("14:30") },
      ],
      meals: [meal("12:00", "12:40")],
    });
    const slots = day(c).slots;
    const total = slots.reduce((sum, s) => sum + s.minutes, 0);
    // 08:00–22:00 available, and the shift runs to 21:00 inside it.
    expect(total).toBe(14 * 60);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.start).toBe(slots[i - 1]!.end);
    }
  });

  it("totals every kind so a day's figures add up to the day", () => {
    const c = build({
      meetingPatterns: [meeting()],
      sessions: [
        { workItemId: "wi_1", courseId: "crs_bio", startAt: iso("13:00"), endAt: iso("14:00") },
      ],
    });
    const t = day(c).totals;
    expect(t.class).toBe(75);
    expect(t.study).toBe(60);
    expect(t.class + t.study + t.free + t.commitment + t.meal).toBe(14 * 60);
  });
});

function meal(from: string, to: string, status: MealBreak["status"] = "reserved"): MealBreak {
  return {
    date: MONDAY,
    key: "lunch",
    label: "Lunch",
    status,
    start: at(from),
    end: at(to),
    minutes: at(to) - at(from),
  };
}

describe("who wins a contested minute", () => {
  it("gives a class the time a study block also claims", () => {
    const c = build({
      meetingPatterns: [meeting({ startTime: "09:00", endTime: "10:00" })],
      sessions: [
        { workItemId: "wi_1", courseId: "crs_bio", startAt: iso("09:30"), endAt: iso("11:00") },
      ],
    });
    const slots = day(c).slots.filter((s) => s.kind !== "free");
    expect(slots.map((s) => [s.kind, s.start - BASE, s.end - BASE])).toEqual([
      ["class", 9 * 60, 10 * 60],
      ["study", 10 * 60, 11 * 60],
    ]);
  });

  it("gives a shift the time a class does not want", () => {
    const c = build({
      commitments: [commitment({ startTime: "17:00", endTime: "21:00" })],
      sessions: [
        { workItemId: "wi_1", courseId: "crs_bio", startAt: iso("16:00"), endAt: iso("18:00") },
      ],
    });
    const study = day(c).slots.find((s) => s.kind === "study")!;
    expect(study.end).toBe(at("17:00"));
    expect(day(c).slots.find((s) => s.kind === "commitment")!.start).toBe(at("17:00"));
  });

  it("keeps held meal time out of a study block that overlaps it", () => {
    const c = build({
      sessions: [
        { workItemId: "wi_1", courseId: "crs_bio", startAt: iso("11:30"), endAt: iso("13:00") },
      ],
      meals: [meal("12:00", "12:40")],
    });
    expect(
      day(c)
        .slots.filter((s) => s.kind !== "free")
        .map((s) => s.kind),
    ).toEqual(["study", "meal", "study"]);
  });

  it("is the same calendar whichever order the claims arrive in", () => {
    // Resolving pairwise would let the answer depend on which query returned first.
    const parts = {
      meetingPatterns: [meeting({ startTime: "09:00", endTime: "12:00" })],
      commitments: [commitment({ startTime: "11:00", endTime: "13:00" })],
      sessions: [
        { workItemId: "wi_1", courseId: "crs_bio", startAt: iso("10:00"), endAt: iso("14:00") },
      ],
      meals: [meal("12:30", "13:10")],
    };
    const forwards = build(parts);
    const backwards = build({
      ...parts,
      commitments: [...parts.commitments].reverse(),
      meetingPatterns: [...parts.meetingPatterns].reverse(),
    });
    expect(backwards.days[0]!.slots).toEqual(forwards.days[0]!.slots);
  });

  it("does not draw an optional commitment as solid time", () => {
    // Optional commitments are never subtracted from capacity, so drawing them would put the
    // calendar at odds with the plan underneath it.
    const c = build({ commitments: [commitment({ flexibility: "optional" })] });
    expect(kinds(c)).toEqual(["free"]);
  });

  it("does not draw a class outside its effective dates", () => {
    const c = build({ meetingPatterns: [meeting({ effectiveStart: "2026-10-01" })] });
    expect(kinds(c)).toEqual(["free"]);
  });

  it("rejoins a block a boundary happened to cut in two", () => {
    // The sweep cuts at every edge; a class spanning an edge that changed nothing must not
    // come back as two adjacent boxes with the same label.
    const c = build({
      meetingPatterns: [meeting({ startTime: "09:00", endTime: "12:00" })],
      sessions: [
        { workItemId: "wi_1", courseId: "crs_bio", startAt: iso("10:00"), endAt: iso("10:30") },
      ],
    });
    expect(day(c).slots.filter((s) => s.kind === "class")).toHaveLength(1);
  });
});

describe("the drawn window", () => {
  it("rounds out to whole hours around everything in the week", () => {
    const c = build({
      availability: [{ dayOfWeek: 1, startTime: "08:20", endTime: "21:40" }],
    });
    expect(c.windowStartMinute).toBe(8 * 60);
    expect(c.windowEndMinute).toBe(22 * 60);
  });

  it("still has height when the week is completely empty", () => {
    const c = build({ availability: [] });
    expect(c.windowEndMinute).toBeGreaterThan(c.windowStartMinute);
  });

  it("covers every day of the horizon, including ones with nothing in them", () => {
    const c = buildWeekCalendar({
      horizonStart: MONDAY,
      horizonDays: 7,
      meetingPatterns: [],
      commitments: [],
      availability: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
      sessions: [],
      meals: [],
    });
    expect(c.days).toHaveLength(7);
    expect(c.days.filter((d) => d.slots.length > 0)).toHaveLength(1);
    expect(c.totals.free).toBe(8 * 60);
  });
});

/**
 * The board-and-calendar agreement.
 *
 * Reported from use: work was showing on the assignments board and nowhere on the calendar.
 * It was not a dropped record -- the calendar drew only *hours*, and a deadline costs no
 * hours, so the day a thing was owed drew nothing at all unless the planner happened to book
 * that same day. A paper due Thursday with its block on Monday made Thursday look empty, and
 * anything the week could not fit made every day look empty.
 */
describe("deadlines on the calendar", () => {
  const paper = {
    workItemId: "wk_paper",
    courseId: "crs_his",
    title: "Response paper",
    workType: "paper",
  };

  it("draws work due on a day the plan booked nothing for", () => {
    const c = build({
      deadlines: [{ ...paper, dueAt: iso("23:59") }],
    });
    expect(day(c).due.map((d) => d.title)).toEqual(["Response paper"]);
    expect(day(c).due[0]!.nothingBooked).toBe(true);
  });

  it("keeps the deadline on its own day when the block for it sits on another", () => {
    const c = buildWeekCalendar({
      horizonStart: MONDAY,
      horizonDays: 7,
      meetingPatterns: [],
      commitments: [],
      availability: [{ dayOfWeek: 1, startTime: "08:00", endTime: "22:00" }],
      // Booked Monday; owed Thursday. The case that made Thursday render blank.
      sessions: [
        {
          workItemId: "wk_paper",
          courseId: "crs_his",
          startAt: `${MONDAY}T13:00:00.000Z`,
          endAt: `${MONDAY}T14:00:00.000Z`,
        },
      ],
      meals: [],
      deadlines: [{ ...paper, dueAt: "2026-09-10T23:59:00.000Z" }],
    });

    expect(c.days.map((d) => d.due.length)).toEqual([0, 0, 0, 1, 0, 0, 0]);
    // Booked this week, just not on the day it is due -- so the day says "due", not "due and
    // nothing set aside", which is a different and much louder claim.
    expect(c.days[3]!.due[0]!.nothingBooked).toBe(false);
  });

  it("tells a stated clock time apart from the end-of-day default", () => {
    const stated = build({ deadlines: [{ ...paper, dueAt: iso("09:00") }] });
    expect(day(stated).due[0]).toMatchObject({ timeStated: true, minuteOfDay: 9 * 60 });

    const silent = build({ deadlines: [{ ...paper, dueAt: iso("23:59") }] });
    expect(day(silent).due[0]).toMatchObject({ timeStated: false, minuteOfDay: 23 * 60 + 59 });
  });

  it("reads the day and the clock off the stored characters, never through a Date", () => {
    // A deadline one minute before midnight is the case a zone-sensitive reading slides into
    // the next day. Both halves have to come from the same ten-and-five characters the
    // assignments board formats from.
    const c = build({ deadlines: [{ ...paper, dueAt: `${MONDAY}T23:59:00.000Z` }] });
    expect(day(c).date).toBe(MONDAY);
    expect(day(c).due).toHaveLength(1);
    expect(day(c).due[0]!.at).toBe(at("23:59"));
  });

  it("orders a day's deadlines by the clock, then by title", () => {
    const c = build({
      deadlines: [
        { ...paper, workItemId: "wk_b", title: "Beta", dueAt: iso("23:59") },
        { ...paper, workItemId: "wk_a", title: "Alpha", dueAt: iso("23:59") },
        { ...paper, workItemId: "wk_q", title: "Quiz closes", dueAt: iso("09:00") },
      ],
    });
    expect(day(c).due.map((d) => d.title)).toEqual(["Quiz closes", "Alpha", "Beta"]);
  });

  it("ignores deadlines outside the drawn week", () => {
    const c = build({ deadlines: [{ ...paper, dueAt: "2026-12-01T23:59:00.000Z" }] });
    expect(day(c).due).toEqual([]);
  });

  it("draws hours only when no deadlines are passed", () => {
    expect(day(build()).due).toEqual([]);
  });
});
