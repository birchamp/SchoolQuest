import { describe, expect, it, vi } from "vitest";
import { selectByIdsInChunks } from "./repo.js";

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
