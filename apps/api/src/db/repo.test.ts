import { describe, expect, it, vi } from "vitest";
import { chunk, isUniqueViolation, selectByIdsInChunks } from "./repo.js";

/**
 * The bug this guards: a single `inArray(col, ids)` binds one parameter per id, so a term with
 * enough work items trips D1's ~100 bound-parameter ceiling and every plan load 500s. The helper
 * must split the read into batches that stay under that ceiling, cover every id once, and preserve
 * order. If a future edit passed the whole id set through in one call, the batch-size assertion
 * here fails.
 */
describe("selectByIdsInChunks", () => {
  it("keeps every batch under D1's bound-parameter ceiling", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id_${i}`);
    const batches: string[][] = [];

    await selectByIdsInChunks(ids, async (batch) => {
      batches.push(batch);
      return [];
    });

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      // 90-id chunks + room for a stray extra bound value must stay clear of 100.
      expect(batch.length).toBeLessThanOrEqual(90);
    }
  });

  it("covers every id exactly once, in order", async () => {
    const ids = Array.from({ length: 205 }, (_, i) => `id_${i}`);

    const seen = await selectByIdsInChunks(ids, async (batch) => batch);

    expect(seen).toEqual(ids);
  });

  it("concatenates the rows each batch returns, in batch order", async () => {
    const ids = ["a", "b", "c"];

    const rows = await selectByIdsInChunks(ids, async (batch) =>
      batch.map((id) => ({ id, upper: id.toUpperCase() })),
    );

    expect(rows).toEqual([
      { id: "a", upper: "A" },
      { id: "b", upper: "B" },
      { id: "c", upper: "C" },
    ]);
  });

  it("does no query for an empty id set", async () => {
    const run = vi.fn(async () => []);

    const rows = await selectByIdsInChunks([], run);

    expect(run).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});

/**
 * The plan write goes into one `db.batch`, so its statements are chunked up front rather than
 * awaited one by one. A chunk that dropped or repeated a row would lose a block or fail the whole
 * plan on a duplicate id.
 */
describe("chunk", () => {
  it("splits into runs of the given size, every row once and in order", () => {
    const rows = Array.from({ length: 21 }, (_, i) => i);

    const chunks = chunk(rows, 8);

    expect(chunks.map((c) => c.length)).toEqual([8, 8, 5]);
    expect(chunks.flat()).toEqual(rows);
  });

  it("returns no chunks for no rows, so the batch gets no empty statement", () => {
    expect(chunk([], 8)).toEqual([]);
  });
});

/**
 * How the generate route tells a lost race (retry) from any other failure (rethrow). The message
 * is the one a local D1 gives for a duplicate plan version number.
 */
describe("isUniqueViolation", () => {
  const columns = ["plan_versions.term_id", "plan_versions.version_number"];
  const d1Message =
    "D1_ERROR: UNIQUE constraint failed: plan_versions.term_id, plan_versions.version_number: SQLITE_CONSTRAINT";

  it("recognises D1's duplicate-key error for those columns", () => {
    expect(isUniqueViolation(new Error(d1Message), columns)).toBe(true);
  });

  it("finds it under a wrapping error's cause", () => {
    expect(isUniqueViolation(new Error("Failed query", { cause: new Error(d1Message) }), columns)).toBe(true);
  });

  it("does not mistake another constraint or another failure for it", () => {
    const otherIndex = "UNIQUE constraint failed: work_sessions.id: SQLITE_CONSTRAINT";
    expect(isUniqueViolation(new Error(otherIndex), columns)).toBe(false);
    expect(isUniqueViolation(new Error("FOREIGN KEY constraint failed"), columns)).toBe(false);
    expect(isUniqueViolation("UNIQUE constraint failed", columns)).toBe(false);
    expect(isUniqueViolation(undefined, columns)).toBe(false);
  });
});
