import { describe, expect, it } from "vitest";
import { collectSubtreeIds, idBatches } from "./delete-work.js";
import { ID_IN_CLAUSE_CHUNK } from "./repo.js";

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

/**
 * The bug this guards, found in review: the delete ran in batches of 100 ids, and the dependency
 * statement bound each id twice -- once per `IN` clause -- so 200 bound parameters went at D1's
 * ceiling of about 100. A project of 51 stages was enough, and a course being reset needs only
 * fifty-odd assignments, which is an ordinary course.
 *
 * The failure is worse than a plain error. The statement is the third of four, so the grades and
 * blocks are already gone when it throws: the work item survives with its history stripped, a
 * state no screen can explain and nothing retries.
 */
describe("idBatches", () => {
  it("keeps every batch inside the per-clause parameter budget", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `wi_${i}`);

    const batches = idBatches(ids);

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(ID_IN_CLAUSE_CHUNK);
    }
  });

  it("uses the same budget the term read does, rather than its own number", () => {
    // The copy that drifted is how the ceiling was exceeded in the first place.
    expect(ID_IN_CLAUSE_CHUNK).toBeLessThan(100);
    expect(idBatches(Array.from({ length: 100 }, (_, i) => `wi_${i}`))[0]!.length).toBe(
      ID_IN_CLAUSE_CHUNK,
    );
  });

  it("covers every id exactly once, in order", () => {
    const ids = Array.from({ length: 205 }, (_, i) => `wi_${i}`);

    expect(idBatches(ids).flat()).toEqual(ids);
  });

  it("does no statement for an empty subtree", () => {
    expect(idBatches([])).toEqual([]);
  });
});
