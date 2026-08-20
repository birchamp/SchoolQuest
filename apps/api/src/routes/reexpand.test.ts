import { describe, expect, it } from "vitest";
import type { TermWindow } from "@schoolquest/ai";
import {
  reexpandRecurrenceClaims,
  type ClaimAssignmentPayload,
  type ReexpandClaim,
} from "./extraction.js";

/**
 * Deterministic re-expansion of a per-class rule once the meeting days are known.
 *
 * This is the pure core of `POST /extraction/reexpand-recurrence`: no database, no model, so the
 * behaviour that matters -- answers cascade into the assignment list without a second AI call --
 * is checked directly here.
 */

const TERM: TermWindow = { termStartDate: "2026-09-01", termEndDate: "2026-09-28" };

function ruleClaim(over: Partial<ClaimAssignmentPayload> = {}, claim: Partial<ReexpandClaim> = {}): ReexpandClaim {
  return {
    id: "claim-rule",
    page: 1,
    excerpt: "A short quiz at the start of every class",
    confidence: 0.9,
    reviewStatus: "pending",
    payload: {
      title: "Class quiz",
      type: "quiz",
      dueDate: { iso: null, raw: "every class", time: null, ambiguity: "missing" },
      pointsPossible: null,
      category: "Quizzes",
      isMajorProject: false,
      recurrence: {
        frequency: "weekly",
        dayOfWeek: null,
        everyClassMeeting: true,
        count: null,
        dropLowest: null,
      },
      ...over,
    },
    ...claim,
  };
}

describe("reexpandRecurrenceClaims", () => {
  it("places a per-class rule on every meeting day once the days are known", () => {
    // Mon/Wed across four weeks of September is eight class meetings.
    const result = reexpandRecurrenceClaims([ruleClaim()], TERM, [1, 3]);
    expect(result.deleteIds).toEqual(["claim-rule"]);
    expect(result.insertPayloads).toHaveLength(8);
    expect(result.insertPayloads.every((r) => (r.payload["dueDate"] as { iso: string }).iso !== null)).toBe(true);
    // Derived, not read -- carries the same standing a resolved "Week 3" gets.
    expect(result.insertPayloads[0]!.payload["issues"]).toEqual(["DATE_DERIVED_FROM_RULE"]);
    expect(result.insertPayloads[0]!.payload["recurrence"]).toBeNull();
  });

  it("does nothing when no meeting days are known yet", () => {
    const result = reexpandRecurrenceClaims([ruleClaim()], TERM, []);
    expect(result.deleteIds).toEqual([]);
    expect(result.insertPayloads).toEqual([]);
  });

  it("leaves an already-dated or ruleless claim untouched", () => {
    const dated = ruleClaim({ dueDate: { iso: "2026-09-02", raw: "Sept 2", time: null, ambiguity: "none" } });
    const noRule = ruleClaim({ recurrence: null }, { id: "claim-plain" });
    const result = reexpandRecurrenceClaims([dated, noRule], TERM, [1, 3]);
    expect(result.deleteIds).toEqual([]);
    expect(result.insertPayloads).toEqual([]);
  });

  it("does not rewrite a claim the student has already accepted", () => {
    const accepted = ruleClaim({}, { reviewStatus: "accepted" });
    const result = reexpandRecurrenceClaims([accepted], TERM, [1, 3]);
    expect(result.deleteIds).toEqual([]);
  });

  it("is idempotent: the expanded instances carry no rule, so a second pass is a no-op", () => {
    const first = reexpandRecurrenceClaims([ruleClaim()], TERM, [1, 3]);
    // Feed the freshly-created instances back in as claims.
    const instances: ReexpandClaim[] = first.insertPayloads.map((r, i) => ({
      id: `inst-${i}`,
      page: r.page,
      excerpt: r.excerpt,
      confidence: r.confidence,
      reviewStatus: "pending",
      payload: r.payload as unknown as ClaimAssignmentPayload,
    }));
    const second = reexpandRecurrenceClaims(instances, TERM, [1, 3]);
    expect(second.deleteIds).toEqual([]);
    expect(second.insertPayloads).toEqual([]);
  });
});
