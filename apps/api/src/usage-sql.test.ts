import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { UsageEvent } from "@schoolquest/domain";
import { upsertStatements } from "./usage.js";

// Vite 5 does not know `node:sqlite` is a builtin and tries to bundle it; Node's own loader does.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * The usage upsert run against real SQLite with every migration applied. The opt-out is checked
 * inside the write itself, so an account switched off between the route's read and the write
 * records nothing (found in review on #41); a fake database cannot say whether that SQL -- an
 * INSERT ... SELECT with a WHERE and an upsert -- actually behaves.
 */
function database() {
  const dir = join(import.meta.dirname, "..", "drizzle");
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    for (const statement of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  return db;
}

function user(db: DatabaseSyncType, id: string, shareUsage: boolean) {
  db.prepare(
    "INSERT INTO users (id, email, theme, share_usage, created_at) VALUES (?, ?, 'plain', ?, '2026-10-11T00:00:00Z')",
  ).run(id, `${id}@example.com`, shareUsage ? 1 : 0);
}

function write(db: DatabaseSyncType, userId: string, counts: [UsageEvent, number][]) {
  for (const s of upsertStatements("2026-10-11", "subject-" + userId, new Map(counts), userId)) {
    db.prepare(s.sql).run(...s.params);
  }
}

const rows = (db: DatabaseSyncType) =>
  db.prepare("SELECT event, subject, count FROM usage_daily ORDER BY event").all();

describe("usage upsert in SQLite", () => {
  it("records and then adds to the count for an account that shares usage", () => {
    const db = database();
    user(db, "u1", true);
    write(db, "u1", [["tab.week", 2]]);
    write(db, "u1", [["tab.week", 3], ["tab.stats", 1]]);
    expect(rows(db)).toEqual([
      { event: "tab.stats", subject: "subject-u1", count: 1 },
      { event: "tab.week", subject: "subject-u1", count: 5 },
    ]);
  });

  it("records nothing once the account has opted out, whatever was read before", () => {
    const db = database();
    user(db, "u2", false);
    write(db, "u2", [["tab.week", 2]]);
    expect(rows(db)).toEqual([]);
  });

  it("records nothing for an account that does not exist", () => {
    const db = database();
    write(db, "ghost", [["tab.week", 1]]);
    expect(rows(db)).toEqual([]);
  });
});
