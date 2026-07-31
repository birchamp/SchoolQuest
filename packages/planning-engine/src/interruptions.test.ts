import { describe, expect, it } from "vitest";
import {
  buildWeeklyReview,
  slotKeyFor,
  type LostBlock,
  type ReportedInterruption,
} from "./interruptions.js";

/** Thursdays in September 2026: the 3rd, 10th, 17th and 24th. */
const NOW = "2026-09-28T09:00:00.000Z";

function lost(date: string, startTime = "17:00", minutes = 60, n = 1): LostBlock {
  const start = `${date}T${startTime}:00.000Z`;
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
  return {
    sessionId: `ses_${date}_${startTime}_${n}`,
    workItemId: `wi_${n}`,
    startAt: start,
    endAt: end,
    source: "silent",
  };
}

function reported(
  date: string,
  title: string,
  overrides: Partial<ReportedInterruption> = {},
): ReportedInterruption {
  const start = `${date}T17:00:00.000Z`;
  return {
    id: `int_${date}`,
    title,
    kind: null,
    sessionId: `ses_${date}_17:00_1`,
    startAt: start,
    endAt: new Date(Date.parse(start) + 60 * 60_000).toISOString(),
    recurring: null,
    ...overrides,
  };
}

const empty = { reported: [], resolutions: [], now: NOW };

describe("weekly review", () => {
  it("says nothing when the weeks went to plan", () => {
    const review = buildWeeklyReview({ lost: [], ...empty });
    expect(review.questions).toEqual([]);
    expect(review.minutesLost).toBe(0);
  });

  it("does not propose a standing commitment from a single bad day", () => {
    const review = buildWeeklyReview({ lost: [lost("2026-09-24")], ...empty });
    expect(review.questions).toHaveLength(1);
    expect(review.questions[0]!.weeks).toBe(1);
    expect(review.questions[0]!.proposal).toBeNull();
  });

  it("proposes a standing commitment once the same slot repeats across weeks", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-10"), lost("2026-09-17"), lost("2026-09-24")],
      ...empty,
    });
    const question = review.questions[0]!;
    expect(question.weeks).toBe(3);
    expect(question.dayOfWeek).toBe(4);
    expect(question.proposal).not.toBeNull();
    expect(question.proposal!.daysOfWeek).toEqual([4]);
    expect(question.proposal!.startTime).toBe("17:00");
  });

  it("counts weeks, not blocks, so one bad evening is one occurrence", () => {
    // Two blocks lost back to back on a single Thursday is still one Thursday.
    const review = buildWeeklyReview({
      lost: [lost("2026-09-24", "17:00", 60, 1), lost("2026-09-24", "18:10", 60, 2)],
      ...empty,
    });
    expect(review.questions[0]!.weeks).toBe(1);
    expect(review.questions[0]!.proposal).toBeNull();
  });

  it("treats nearby times on the same weekday as one slot", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-17", "17:00"), lost("2026-09-24", "17:30")],
      ...empty,
    });
    expect(review.questions).toHaveLength(1);
    expect(review.questions[0]!.weeks).toBe(2);
  });

  it("keeps different weekdays apart", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-22"), lost("2026-09-24")],
      ...empty,
    });
    expect(review.questions).toHaveLength(2);
    expect(new Set(review.questions.map((q) => q.dayOfWeek))).toEqual(new Set([2, 4]));
  });

  it("uses the student's own words for the proposal when they gave any", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-17"), lost("2026-09-24")],
      reported: [
        reported("2026-09-17", "Youth group", { kind: "worship" }),
        reported("2026-09-24", "Youth group", { kind: "worship" }),
      ],
      resolutions: [],
      now: NOW,
    });
    const proposal = review.questions[0]!.proposal!;
    expect(proposal.title).toBe("Youth group");
    expect(proposal.commitmentType).toBe("worship");
    expect(proposal.named).toBe(true);
  });

  it("proposes unnamed time plainly rather than inventing an activity", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-17"), lost("2026-09-24")],
      ...empty,
    });
    const proposal = review.questions[0]!.proposal!;
    expect(proposal.named).toBe(false);
    expect(proposal.commitmentType).toBe("other");
  });

  it("counts an interruption reported without a block", () => {
    const review = buildWeeklyReview({
      lost: [],
      reported: [
        reported("2026-09-17", "Shift moved", { sessionId: null }),
        reported("2026-09-24", "Shift moved", { sessionId: null }),
      ],
      resolutions: [],
      now: NOW,
    });
    expect(review.questions[0]!.proposal!.title).toBe("Shift moved");
  });

  it("does not double-count a reported interruption against its own block", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-24")],
      reported: [reported("2026-09-24", "Dentist")],
      resolutions: [],
      now: NOW,
    });
    expect(review.minutesLost).toBe(60);
    expect(review.questions[0]!.occurrences[0]!.cause).toBe("Dentist");
  });

  it("stops asking once the slot has become a commitment", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-10"), lost("2026-09-17"), lost("2026-09-24")],
      reported: [],
      resolutions: [{ slotKey: "4:17:00", resolution: "promoted", occurrences: 2 }],
      now: NOW,
    });
    expect(review.questions).toEqual([]);
  });

  it("lets a one-off answer stand until the pattern outgrows it", () => {
    const settled = buildWeeklyReview({
      lost: [lost("2026-09-17"), lost("2026-09-24")],
      reported: [],
      resolutions: [{ slotKey: "4:17:00", resolution: "one_off", occurrences: 2 }],
      now: NOW,
    });
    expect(settled.questions).toEqual([]);

    // A third Thursday is new evidence about the calendar, so it is worth asking again.
    const grown = buildWeeklyReview({
      lost: [lost("2026-09-10"), lost("2026-09-17"), lost("2026-09-24")],
      reported: [],
      resolutions: [{ slotKey: "4:17:00", resolution: "one_off", occurrences: 2 }],
      now: NOW,
    });
    expect(grown.questions).toHaveLength(1);
  });

  it("ignores blocks whose time has not passed yet", () => {
    const review = buildWeeklyReview({ lost: [lost("2026-10-01")], ...empty });
    expect(review.questions).toEqual([]);
  });

  it("ignores history older than the lookback", () => {
    const review = buildWeeklyReview({ lost: [lost("2026-07-02")], ...empty });
    expect(review.questions).toEqual([]);
  });

  it("never asks more than three questions at once", () => {
    const review = buildWeeklyReview({
      lost: [
        lost("2026-09-21", "09:00"),
        lost("2026-09-22", "11:00"),
        lost("2026-09-23", "13:00"),
        lost("2026-09-24", "15:00"),
        lost("2026-09-25", "17:00"),
      ],
      ...empty,
    });
    expect(review.questions.length).toBeLessThanOrEqual(3);
  });

  it("ranks the most repeated slot first", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-25", "09:00"), lost("2026-09-10"), lost("2026-09-17"), lost("2026-09-24")],
      ...empty,
    });
    expect(review.questions[0]!.dayOfWeek).toBe(4);
    expect(review.questions[0]!.weeks).toBe(3);
  });

  it("separates blocks the student answered for from ones that passed in silence", () => {
    const review = buildWeeklyReview({
      lost: [
        { ...lost("2026-09-24"), source: "reported" },
        { ...lost("2026-09-24", "19:00", 60, 2), source: "silent" },
      ],
      ...empty,
    });
    expect(review.unanswered).toBe(1);
  });

  it("agrees with the API on how a slot is keyed", () => {
    const review = buildWeeklyReview({ lost: [lost("2026-09-24")], ...empty });
    expect(review.questions[0]!.slotKey).toBe(slotKeyFor(4, "17:00"));
  });
});

describe("slot grouping", () => {
  it("keeps an interrupted afternoon from swallowing the hour that went fine", () => {
    // The regression: with one loose tolerance, each block reached the next and the whole
    // afternoon chained into a single four-and-a-half-hour "obstacle".
    const review = buildWeeklyReview({
      lost: [
        lost("2026-09-24", "13:00", 60, 1),
        // 14:00–16:00 went to plan and is not in the list.
        lost("2026-09-24", "16:00", 60, 2),
      ],
      ...empty,
    });
    expect(review.questions).toHaveLength(2);
    for (const question of review.questions) {
      expect(question.endTime <= "17:00").toBe(true);
    }
  });

  it("still joins blocks lost back to back in one sitting", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-24", "17:00", 45, 1), lost("2026-09-24", "17:55", 45, 2)],
      ...empty,
    });
    expect(review.questions).toHaveLength(1);
    expect(review.questions[0]!.startTime).toBe("17:00");
    expect(review.questions[0]!.endTime).toBe("18:40");
  });
});

describe("today is off limits", () => {
  /** 2026-09-28 is a Monday; NOW is 09:00 that morning. */
  it("does not ask about a block earlier the same day", () => {
    const review = buildWeeklyReview({
      lost: [lost("2026-09-28", "07:00", 60)],
      ...empty,
    });
    expect(review.questions).toEqual([]);
    expect(review.unanswered).toBe(0);
  });

  it("still asks about yesterday", () => {
    const review = buildWeeklyReview({ lost: [lost("2026-09-27", "07:00", 60)], ...empty });
    expect(review.questions).toHaveLength(1);
  });

  it("measures the lookback from the start of today, not from this minute", () => {
    // A block 21 days back to the minute must not slip out of the window purely because
    // the student happened to open the app in the afternoon.
    const review = buildWeeklyReview({ lost: [lost("2026-09-07", "23:00", 30)], ...empty });
    expect(review.questions).toHaveLength(1);
  });
});
