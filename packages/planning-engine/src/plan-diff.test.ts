import { describe, expect, it } from "vitest";
import { diffPlans } from "./plan-diff.js";

const s = (id: string, workItemId: string, start: string, minutes = 60) => ({
  id,
  workItemId,
  startAt: `2026-09-${start}:00Z`,
  endAt: `2026-09-${start.slice(0, 3)}${String(Number(start.slice(3, 5)) + minutes / 60).padStart(2, "0")}:${start.slice(6)}:00Z`,
});

describe("diffPlans", () => {
  it("reports an untouched plan as unchanged, whether ids were carried or reissued", () => {
    const old = [s("a", "w1", "07T09:00"), s("b", "w2", "08T09:00")];
    expect(diffPlans(old, old).unchanged).toBe(true);
    const reissued = [s("x", "w1", "07T09:00"), s("y", "w2", "08T09:00")];
    const diff = diffPlans(old, reissued);
    expect(diff.unchanged).toBe(true);
    expect(diff.kept).toHaveLength(2);
  });

  it("calls a block for the same work at a different time a move, from and to", () => {
    const diff = diffPlans([s("a", "w1", "07T09:00")], [s("x", "w1", "09T14:00")]);
    expect(diff.moved).toEqual([
      expect.objectContaining({
        workItemId: "w1",
        from: expect.objectContaining({ startAt: "2026-09-07T09:00:00Z" }),
        to: expect.objectContaining({ startAt: "2026-09-09T14:00:00Z" }),
      }),
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.dropped).toEqual([]);
  });

  it("names what the new plan no longer holds, and what it newly holds", () => {
    const diff = diffPlans(
      [s("a", "w1", "07T09:00"), s("b", "w2", "08T09:00")],
      [s("a", "w1", "07T09:00"), s("c", "w3", "10T09:00")],
    );
    expect(diff.kept.map((k) => k.workItemId)).toEqual(["w1"]);
    expect(diff.dropped.map((d) => d.workItemId)).toEqual(["w2"]);
    expect(diff.added.map((a) => a.workItemId)).toEqual(["w3"]);
    expect(diff.unchanged).toBe(false);
  });

  it("pairs several blocks of one item in start order, so a split item is not all 'moved'", () => {
    const old = [s("a", "w1", "07T09:00"), s("b", "w1", "08T09:00")];
    const next = [s("x", "w1", "07T09:00"), s("y", "w1", "08T09:00"), s("z", "w1", "09T09:00")];
    const diff = diffPlans(old, next);
    expect(diff.kept).toHaveLength(2);
    expect(diff.moved).toHaveLength(0);
    expect(diff.added.map((a) => a.sessionId)).toEqual(["z"]);
  });

  it("treats a block kept by id but at new minutes as moved, not kept", () => {
    const diff = diffPlans([s("a", "w1", "07T09:00")], [s("a", "w1", "07T10:00")]);
    expect(diff.kept).toHaveLength(0);
    expect(diff.moved).toHaveLength(1);
  });

  it("is order-independent in its input and stable in its output", () => {
    const old = [s("b", "w2", "08T09:00"), s("a", "w1", "07T09:00")];
    const next = [s("y", "w1", "09T09:00"), s("x", "w2", "08T09:00")];
    expect(diffPlans(old, next)).toEqual(diffPlans([...old].reverse(), [...next].reverse()));
    expect(diffPlans(old, next).moved[0]?.workItemId).toBe("w1");
  });
});
