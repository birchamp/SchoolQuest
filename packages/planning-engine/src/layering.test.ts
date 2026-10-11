import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * The engine ships no test data. `@schoolquest/fixtures` is a devDependency, so production code
 * importing it would work in the workspace and break anywhere it is installed on its own.
 * Test helpers live under `testing/` and are reached by tests, never by the package root.
 */
describe("planning-engine layering", () => {
  const production = readdirSync(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("has production sources to check", () => {
    expect(production.length).toBeGreaterThan(10);
  });

  it("never imports the fixtures from production code", () => {
    const offenders = production.filter((f) =>
      readFileSync(join(SRC, f), "utf8").includes("@schoolquest/fixtures"),
    );
    expect(offenders).toEqual([]);
  });

  it("does not export the test helpers from the package root", () => {
    expect(readFileSync(join(SRC, "index.ts"), "utf8")).not.toMatch(/testing|seed-input/);
  });
});
