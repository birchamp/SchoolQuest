import { describe, expect, it } from "vitest";
import { seedPlanningInput } from "./seed-input.js";
import { toEpochMinutes, type WorkSession } from "@schoolquest/domain";
import { generatePlan } from "./scheduler.js";
import type { PlanningInput, PlannedSession } from "./types.js";

/**
 * End-to-end scenarios for the scheduling work: skip, move + pin, a day passing untouched,
 * paced stability across repeated replans, and a deadline moving earlier.
 *
 * These simulate the real loop the API runs: plan, persist the sessions, then replan in minimal
 * mode with those sessions fed back as `existingSessions` -- exactly what the generate route does.
 * The point is not one function's output but the *behaviour over a sequence of replans*, which is
 * where stability and reflow either hold together or fall apart.
 */

const PREV = "plan_prev";

/** Turn a plan's blocks back into stored sessions, as the API would persist them. */
function persist(
  sessions: PlannedSession[],
  override: (s: PlannedSession) => Partial<WorkSession> = () => ({}),
): WorkSession[] {
  return sessions.map((s) => ({
    id: s.id,
    workItemId: s.workItemId,
    planVersionId: PREV,
    startAt: s.startAt,
    endAt: s.endAt,
    status: "planned" as const,
    locked: s.locked,
    acceptedByUser: s.acceptedByUser,
    actualMinutes: null,
    outcomeCode: null,
    ...override(s),
  }));
}

const slot = (s: { id: string; startAt: string; endAt: string }) =>
  `${s.id}@${s.startAt}@${s.endAt}`;

function replan(overrides: Partial<PlanningInput>, existing: WorkSession[], id = "plan_v2") {
  return generatePlan(
    { ...seedPlanningInput(overrides), reflowMode: "minimal", existingSessions: existing },
    id,
  );
}

describe("scenario: skipping a block", () => {
  it("reflows only the skipped work and leaves the rest of the week untouched", () => {
    const base = generatePlan(seedPlanningInput(), "plan_base");
    const target =
      base.sessions.find((s) => s.workItemId === "wi_psych_reading_w2") ?? base.sessions[0]!;

    const existing = persist(base.sessions, (s) =>
      s.id === target.id
        ? { status: "skipped", outcomeCode: "did_not_start", locked: false, acceptedByUser: false }
        : {},
    );
    const after = replan({}, existing);

    // Every other block is exactly where it was.
    for (const s of base.sessions) {
      if (s.id === target.id) continue;
      expect(after.sessions.some((r) => slot(r) === slot(s))).toBe(true);
    }
    // The skipped block is not re-pinned to the slot that just failed.
    expect(after.sessions.some((r) => r.id === target.id)).toBe(false);
    // Its work is still owed, so it reflows: the reading gets time again somewhere new.
    const readingMinutes = after.sessions
      .filter((r) => r.workItemId === target.workItemId)
      .reduce((sum, r) => sum + r.minutes, 0);
    expect(readingMinutes).toBeGreaterThan(0);
  });
});

describe("scenario: move a block and pin it", () => {
  it("holds the pinned block at its new time and reflows whatever it lands on", () => {
    const base = generatePlan(seedPlanningInput(), "plan_base");
    // Two distinct blocks on distinct items; move the first onto the second's slot and lock it.
    const moved = base.sessions[0]!;
    const displaced = base.sessions.find(
      (s) => s.workItemId !== moved.workItemId && s.startAt !== moved.startAt,
    );
    expect(displaced).toBeDefined();

    const newStart = displaced!.startAt;
    const newEnd = new Date(Date.parse(newStart) + moved.minutes * 60_000).toISOString();

    const existing = persist(base.sessions, (s) =>
      s.id === moved.id
        ? { startAt: newStart, endAt: newEnd, locked: true, acceptedByUser: true }
        : {},
    );
    const after = replan({}, existing);

    // The pinned block is kept verbatim at the slot the student chose.
    const keptMoved = after.sessions.find((r) => r.id === moved.id);
    expect(keptMoved).toBeDefined();
    expect(keptMoved!.startAt).toBe(newStart);
    expect(keptMoved!.locked).toBe(true);

    // The block it was dropped on top of does not survive in that now-occupied slot.
    expect(after.sessions.some((r) => r.id === displaced!.id && r.startAt === displaced!.startAt)).toBe(
      false,
    );
  });
});

describe("scenario: a day passes untouched", () => {
  it("drops the past blocks, keeps the future week, and reflows the owed work forward", () => {
    const base = generatePlan(seedPlanningInput(), "plan_base");
    // Advance a day. Yesterday's blocks were never marked -- they are silent, still "planned".
    const tomorrow = "2026-09-08T08:00:00.000Z";
    const now = toEpochMinutes(tomorrow);

    const existing = persist(base.sessions); // all still "planned"
    const after = replan({ now: tomorrow }, existing);

    // Nothing is scheduled in the past, and no past block is carried forward as if it happened.
    for (const s of after.sessions) {
      expect(toEpochMinutes(s.startAt)).toBeGreaterThanOrEqual(now);
    }
    // Future blocks the student had are still where they were.
    const futureBase = base.sessions.filter((s) => toEpochMinutes(s.startAt) >= now);
    for (const s of futureBase) {
      expect(after.sessions.some((r) => slot(r) === slot(s))).toBe(true);
    }
    // Work that sat in a now-past block is not assumed done: the plan still holds time for it.
    const pastItems = new Set(
      base.sessions.filter((s) => toEpochMinutes(s.endAt) <= now).map((s) => s.workItemId),
    );
    const stillPlanned = after.sessions.some((r) => pastItems.has(r.workItemId));
    expect(pastItems.size === 0 || stillPlanned).toBe(true);
  });
});

describe("scenario: repeated replans are stable", () => {
  it("does not move or grow the plan when nothing has changed", () => {
    const base = generatePlan(seedPlanningInput(), "plan_base");
    let sessions = base.sessions;
    // Replan three times, feeding the plan back each time, as an idle student reopening the app.
    for (let i = 0; i < 3; i++) {
      const out = replan({}, persist(sessions), `plan_v${i}`);
      sessions = out.sessions;
    }
    // After three no-op replans the set of blocks is identical to the first plan -- no drift,
    // no creeping extra sessions on a paced project.
    expect(new Set(sessions.map(slot))).toEqual(new Set(base.sessions.map(slot)));
  });
});

describe("scenario: a deadline moves earlier", () => {
  it("drops a carried block that now falls after the due date", () => {
    const base = generatePlan(seedPlanningInput(), "plan_base");
    const target = base.sessions[base.sessions.length - 1]!; // a later block
    const seed = seedPlanningInput();

    // Pull the item's due date to before its scheduled block, the way an instructor moving an
    // exam up would.
    const newDue = new Date(Date.parse(target.startAt) - 24 * 60 * 60_000).toISOString();
    const workItems = seed.workItems.map((w) =>
      w.id === target.workItemId ? { ...w, dueAt: newDue } : w,
    );

    const after = generatePlan(
      {
        ...seed,
        workItems,
        reflowMode: "minimal",
        existingSessions: persist(base.sessions),
      },
      "plan_v2",
    );

    // The block that now ends after the (earlier) deadline is not kept where it was.
    expect(after.sessions.some((r) => slot(r) === slot(target))).toBe(false);
  });
});
