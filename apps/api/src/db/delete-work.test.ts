import { describe, expect, it } from "vitest";
import { collectSubtreeIds } from "./delete-work.js";

/**
 * The bug this guards: deleting a project that had been broken into stages would leave the stages
 * behind, since `parent_work_item_id` carries no foreign key and nothing cascades from it. The
 * orphans keep their due dates and their remaining minutes, so the scheduler goes on booking
 * hours for the halves of a paper the student just said was never assigned.
 */
describe("collectSubtreeIds", () => {
  const items = [
    { id: "paper", parentWorkItemId: null },
    { id: "outline", parentWorkItemId: "paper" },
    { id: "draft", parentWorkItemId: "paper" },
    { id: "draft-sources", parentWorkItemId: "draft" },
    { id: "quiz", parentWorkItemId: null },
  ];

  it("takes the stages of a project with it, to any depth", () => {
    expect(collectSubtreeIds("paper", items).sort()).toEqual(
      ["draft", "draft-sources", "outline", "paper"].sort(),
    );
  });

  it("leaves everything else in the course alone", () => {
    expect(collectSubtreeIds("quiz", items)).toEqual(["quiz"]);
  });

  it("deletes one stage without touching its siblings or its parent", () => {
    expect(collectSubtreeIds("outline", items)).toEqual(["outline"]);
  });

  it("puts the item asked for first, so the caller can report what it removed", () => {
    expect(collectSubtreeIds("paper", items)[0]).toBe("paper");
  });

  it("terminates on a parent chain that points at itself", () => {
    // A hand-edited row or a bad import: a recursive walk would never return, and the request
    // would hang rather than fail.
    const cyclic = [
      { id: "a", parentWorkItemId: "b" },
      { id: "b", parentWorkItemId: "a" },
    ];
    expect(collectSubtreeIds("a", cyclic).sort()).toEqual(["a", "b"]);
  });
});
