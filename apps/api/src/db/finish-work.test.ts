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

/**
 * The second half of a review finding, and the reason the parent lookup is scoped to the child's
 * course.
 *
 * `POST /work-items` took `parentWorkItemId` as a plain string and wrote it through unchecked, so
 * it could name any row in the database. Handing in such a child called this helper, which looked
 * the parent up by id alone and then wrote to it -- status completed, blocks released. Pointing a
 * throwaway assignment at a stranger's midterm was enough to finish their work and give away the
 * time held for it.
 *
 * Creation now refuses a parent outside the course, and the lookup is scoped as a second lock.
 * These cases pin the decision itself, which is what the two locks protect: nothing about a
 * sibling set may talk this into completing a parent that should be left alone.
 */
describe("shouldCompleteParent cannot tell a foreign child from a real stage", () => {
  it("needs the parent's own status to permit it, not just the siblings", () => {
    // Both locks are about *reaching* the wrong parent. If one were ever bypassed, the decision
    // still has to hold on its own terms.
    const finishedSiblings = [{ status: "completed" }, { status: "submitted" }];

    expect(shouldCompleteParent({ status: "canceled" }, finishedSiblings)).toBe(false);
    expect(shouldCompleteParent({ status: "optional" }, finishedSiblings)).toBe(false);
    expect(shouldCompleteParent({ status: "completed" }, finishedSiblings)).toBe(false);
    expect(shouldCompleteParent({ status: "not_started" }, finishedSiblings)).toBe(true);
  });

  it("says yes to a lone handed-in child, which is exactly why the locks are elsewhere", () => {
    // The shape of the attack: one item, submitted, claiming to be the only stage of a project it
    // has nothing to do with. From statuses alone that is indistinguishable from a real one-stage
    // project being finished -- and it should be, since a real one must still complete. So this
    // is documentation of where the protection is *not*: it is in the scoped lookup above and in
    // the check at creation, never here.
    expect(shouldCompleteParent({ status: "not_started" }, [{ status: "submitted" }])).toBe(true);
  });
});
