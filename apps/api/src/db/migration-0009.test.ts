import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";

// Vite 5 does not know `node:sqlite` is a builtin and tries to bundle it; Node's own loader does.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};
type DatabaseSync = DatabaseSyncType;

/**
 * Migration 0009 renumbers duplicate plan versions before it makes (term, version) unique.
 *
 * `http.test.ts` applies every migration to an empty database, where there is nothing to
 * renumber, so it could not see the first version of this migration leave duplicates behind:
 * its ranking ran inside a correlated subquery, re-ranked after each row was updated, and two
 * duplicate pairs in one term came out as 1, 2, 3, 3, 5 -- and the unique index refused to build.
 * This applies the real files to SQLite with stored duplicates in between.
 */

const migrationsDir = join(import.meta.dirname, "..", "..", "drizzle");

function statementsOf(file: string): string[] {
  return readFileSync(join(migrationsDir, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

function apply(db: DatabaseSync, file: string) {
  for (const statement of statementsOf(file)) db.exec(statement);
}

/** Inserts a row, filling any other NOT NULL column without a default with a placeholder. */
function insert(db: DatabaseSync, table: string, values: Record<string, string | number>) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    notnull: number;
    dflt_value: unknown;
    type: string;
  }[];
  const row: Record<string, string | number> = {};
  for (const column of columns) {
    if (column.name in values) row[column.name] = values[column.name]!;
    else if (column.notnull && column.dflt_value === null) {
      row[column.name] = /int|real/i.test(column.type) ? 0 : "x";
    }
  }
  const names = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
  ).run(...names.map((n) => row[n]!));
}

describe("migration 0009", () => {
  it("renumbers every duplicate plan version so the unique index can be built", () => {
    const files = readdirSync(migrationsDir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort();
    const before = files.filter((f) => f < "0009");
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const file of before) apply(db, file);

    insert(db, "users", { id: "u1", email: "a@example.com" });
    insert(db, "terms", { id: "t1", user_id: "u1" });
    insert(db, "terms", { id: "t2", user_id: "u1" });
    // Two racing pairs in one term, inserted out of order, plus a term with none.
    const stored: [string, string, number, string][] = [
      ["x1", "t1", 1, "2026-09-01T00:00:00Z"],
      ["x2", "t1", 1, "2026-09-01T00:00:01Z"],
      ["x3", "t1", 2, "2026-09-02T00:00:00Z"],
      ["x4", "t1", 2, "2026-09-02T00:00:01Z"],
      ["x5", "t1", 3, "2026-09-03T00:00:00Z"],
      ["y1", "t2", 1, "2026-09-01T00:00:00Z"],
      ["y2", "t2", 4, "2026-09-02T00:00:00Z"],
    ];
    for (const [id, termId, versionNumber, createdAt] of stored) {
      insert(db, "plan_versions", {
        id,
        term_id: termId,
        version_number: versionNumber,
        created_at: createdAt,
      });
    }

    apply(
      db,
      files.find((f) => f.startsWith("0009"))!,
    );

    const rows = db
      .prepare("SELECT id, version_number AS n FROM plan_versions ORDER BY id")
      .all() as { id: string; n: number }[];
    expect(Object.fromEntries(rows.map((r) => [r.id, r.n]))).toEqual({
      x1: 1,
      x2: 2,
      x3: 3,
      x4: 4,
      x5: 5,
      // A term with no duplicates keeps its numbers, gaps included.
      y1: 1,
      y2: 4,
    });
  });
});
