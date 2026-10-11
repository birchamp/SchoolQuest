import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every time the app holds is UTC; only `lib/clock.ts` turns one into the student's local time
 * (issue #4, and the rule at the top of `packages/domain/src/time.ts`).
 *
 * Checked over the sources, because every one of these mistakes passes every other test: the
 * suite runs at UTC+0, where a UTC date is the student's date, a UTC hour is their hour, and
 * formatting in the browser's zone changes nothing. This codebase shipped each of them anyway --
 * a deadline a day out in Tokyo, an evening that ended at 7pm in Chicago, a weekday that turned
 * over at teatime -- and each was found by a reader, one copy at a time. So the screens are not
 * allowed to do it at all: they call `lib/clock.ts`.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  ...readdirSync(join(SRC, "components"))
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .filter((name) => !name.includes(".test."))
    .map((name) => join("components", name)),
  "App.tsx",
].map((path) => ({
  path,
  // Comments come out first: the explanations quote the very patterns they forbid.
  code: readFileSync(join(SRC, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"),
}));

/** Real elapsed time, never compared with a stored time: scroll retries and a React key. */
const ALLOWED_NOW = [/Date\.now\(\) \+ 2000/, /Date\.now\(\) < deadline/, /`new-\$\{bands\.length\}-\$\{Date\.now\(\)\}`/];

function offending(code: string, pattern: RegExp, allowed: RegExp[] = []): string[] {
  return code
    .split("\n")
    .filter((line) => pattern.test(line))
    .filter((line) => !allowed.some((a) => a.test(line)))
    .map((line) => line.trim());
}

describe("screens leave UTC only through lib/clock", () => {
  it("scans the screens at all", () => {
    // A guard that matches nothing passes forever. This is the canary for a moved folder.
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.some((s) => s.code.includes("formatTime("))).toBe(true);
  });

  for (const source of sources) {
    it(`${source.path} formats no time itself`, () => {
      expect(offending(source.code, /toLocale(Date|Time)String\(/)).toEqual([]);
    });

    it(`${source.path} picks no zone itself`, () => {
      // Handing the engine the student's zone is the one allowed form.
      expect(offending(source.code, /timeZone:/, [/timeZone: planTimeZone\(\)/])).toEqual([]);
    });

    it(`${source.path} reads no day or hour off a Date`, () => {
      expect(offending(source.code, /\.get(UTC)?(Hours|Minutes|Day|Date|Month|FullYear)\(\)/)).toEqual([]);
    });

    it(`${source.path} takes no day or clock off a stored time's characters`, () => {
      // `dueAt.slice(0, 10)` is the UTC date, which is the student's only at UTC+0.
      expect(offending(source.code, /At!?\)?\.slice\((0, 10|11, 16)\)/)).toEqual([]);
    });

    it(`${source.path} reads the clock only through appNow`, () => {
      expect(offending(source.code, /Date\.now\(\)|new Date\(\)/, ALLOWED_NOW)).toEqual([]);
    });
  }
});
