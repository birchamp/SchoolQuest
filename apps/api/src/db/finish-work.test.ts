import { describe, expect, it } from "vitest";
import { shouldCompleteParent } from "./finish-work.js";

/**
 * The bug these guard, found in review of the delete route: the parent check excluded only
 * `completed` and `submitted`, so a *canceled* project counted as one that could still be
 * finished. Delete the last open stage of a project the student had put away and the app marked
 * the project completed -- silently reversing a decision they made on purpose, with no screen
 * that says why it came back.
 *
 * Deleting merely made it easy to hit. Handing in that same last stage did it too, through
 * `PATCH /work-items/:id`, so the fix belongs to the rule rather than to the route.
 */
describe("shouldCompleteParent", () => {
  const open = { status: "not_started" };

  it("completes an open project once its last live stage is finished", () => {
    expect(shouldCompleteParent(open, [{ status: "completed" }, { status: "submitted" }])).toBe(
      true,
    );
  });

  it("lets canceled and optional stages stand aside rather than block", () => {
    // "We are not doing the peer-review round" must not leave the paper unfinished forever.
    expect(
      shouldCompleteParent(open, [
        { status: "completed" },
        { status: "canceled" },
        { status: "optional" },
      ]),
    ).toBe(true);
  });

  it("leaves a project alone while any stage is still live", () => {
    expect(shouldCompleteParent(open, [{ status: "completed" }, { status: "in_progress" }])).toBe(
      false,
    );
  });

  it("does not bank credit for a project whose every stage was canceled", () => {
    // Abandoned, not completed.
    expect(shouldCompleteParent(open, [{ status: "canceled" }, { status: "canceled" }])).toBe(
      false,
    );
  });

  it("never revives a canceled project when its last open stage goes away", () => {
    // The review finding, exactly: canceled parent, one stage finished, the other deleted.
    expect(shouldCompleteParent({ status: "canceled" }, [{ status: "completed" }])).toBe(false);
  });

  it("leaves an optional project alone for the same reason", () => {
    expect(shouldCompleteParent({ status: "optional" }, [{ status: "completed" }])).toBe(false);
  });

  it("does not re-finish a project that is already done", () => {
    for (const status of ["completed", "submitted"]) {
      expect(shouldCompleteParent({ status }, [{ status: "completed" }])).toBe(false);
    }
  });

  it("has nothing to complete when a project has no stages left at all", () => {
    // Deleting every stage of a project: there is no evidence it was finished, only that it is
    // empty. `every` on an empty list is vacuously true, which is why this is checked.
    expect(shouldCompleteParent(open, [])).toBe(false);
  });
});
