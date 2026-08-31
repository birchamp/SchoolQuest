import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeDueAt, DEFAULT_DUE_TIME, dueDatePart, dueTimePart, formatDueDay } from "./due-time";

/**
 * The bug these guard: the due cell wrote `${date}T23:59:00.000Z` unconditionally, so no student
 * could say a quiz closes at 9am. The pairing that matters is split-then-compose -- the row reads
 * the two halves out of the stored instant, hands them to two inputs, and joins them back on
 * every save. If that round trip is not exact, editing the date silently moves the time, or
 * editing the time silently moves the date.
 */
describe("due time", () => {
  it("splits a stored instant into the halves the two inputs show", () => {
    expect(dueDatePart("2026-10-05T09:00:00.000Z")).toBe("2026-10-05");
    expect(dueTimePart("2026-10-05T09:00:00.000Z")).toBe("09:00");
  });

  it("round trips: splitting and rejoining changes nothing", () => {
    const stored = "2026-10-05T09:30:00.000Z";
    expect(composeDueAt(dueDatePart(stored), dueTimePart(stored))).toBe(stored);
  });

  it("keeps the day the characters say, not the reader's local day", () => {
    // Formatted through a Date in, say, UTC+9 this instant is the 6th. The row prints the 5th
    // everywhere else in the app, and the time box must agree with the date box beside it.
    expect(dueDatePart("2026-10-05T23:59:00.000Z")).toBe("2026-10-05");
  });

  it("reads an undated item as no date and the end-of-day default", () => {
    expect(dueDatePart(null)).toBe("");
    expect(dueTimePart(null)).toBe(DEFAULT_DUE_TIME);
  });

  it("falls back to end of day rather than showing a blank clock", () => {
    // Older rows, and anything a future writer stores as a bare date.
    expect(dueTimePart("2026-10-05")).toBe(DEFAULT_DUE_TIME);
    expect(dueTimePart("2026-10-05Tnonsense")).toBe(DEFAULT_DUE_TIME);
  });

  it("writes end of day when a date is given with no time", () => {
    expect(composeDueAt("2026-10-05", "")).toBe("2026-10-05T23:59:00.000Z");
  });

  it("clearing the date clears the deadline, whatever the clock says", () => {
    expect(composeDueAt("", "09:00")).toBeNull();
  });

  it("never accepts an impossible clock into the stored instant", () => {
    expect(composeDueAt("2026-10-05", "24:00")).toBe("2026-10-05T23:59:00.000Z");
    expect(composeDueAt("2026-10-05", "9:00")).toBe("2026-10-05T23:59:00.000Z");
  });

  /**
   * The bug these guard, found in review: `CoursesTable`, `LookaheadTable` and `TerrainMap`
   * rendered the instant through `new Date(...).toLocaleDateString()`, which resolves in the
   * browser's zone. While every deadline was 23:59Z that happened to print the right day for the
   * Americas; the moment a time could be set, 01:00 printed as the day before there -- against an
   * assignments table, formatting the same ten characters, that showed the day the student typed.
   */
  it("prints the day that was typed, whatever hour is stored in it", () => {
    // Both ends of the same calendar day have to format identically. Any formatter that resolves
    // in the reader's zone splits these two apart for someone.
    expect(formatDueDay("2026-10-05T01:00:00.000Z")).toBe(formatDueDay("2026-10-05T23:59:00.000Z"));
  });

  it("agrees with the date the editor puts in its own input", () => {
    const stored = "2026-10-05T01:00:00.000Z";
    expect(formatDueDay(stored, { year: "numeric", month: "2-digit", day: "2-digit" })).toContain(
      "05",
    );
    expect(dueDatePart(stored)).toBe("2026-10-05");
  });

  it("never lands on a neighbouring day for a reader far from UTC", () => {
    // Anchoring at noon leaves 12 hours of headroom either way, which covers every real zone.
    for (const hour of ["00:00", "12:00", "23:59"]) {
      expect(formatDueDay(`2026-10-05T${hour}:00.000Z`)).toBe(
        formatDueDay("2026-10-05T12:00:00.000Z"),
      );
    }
  });
});

/**
 * Every view that prints a deadline, checked at once.
 *
 * This bug has now been found twice by review in one change: first in `CoursesTable`,
 * `LookaheadTable` and `TerrainMap`, then again in `SessionBrief`, which the first sweep missed.
 * Each fix was one line and each time the next copy was still out there, because nothing but a
 * reader was looking. The pattern is quiet -- `new Date(dueAt).toLocaleDateString()` is what
 * anyone writes, and it prints the right day for most of the world most of the time.
 *
 * So the rule is checked over the sources rather than left to the next reviewer: a view may
 * format a deadline through `formatDueDay`, or by anchoring the stored day itself, and not by
 * handing the instant to the reader's locale. This is not covered any other way -- there are no
 * component tests, and reverting `SessionBrief` broke nothing.
 */
describe("no view prints a deadline in the reader's zone", () => {
  const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), "..", "components");
  const sources = readdirSync(COMPONENTS)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => ({ name, text: readFileSync(join(COMPONENTS, name), "utf8") }));

  it("finds the views that format due dates at all", () => {
    // A guard that matches nothing passes forever. This is the canary for a rename.
    expect(sources.filter((s) => /function formatDue\b/.test(s.text)).length).toBeGreaterThan(2);
  });

  for (const source of sources) {
    const formatters = source.text.match(/function formatDue\b[\s\S]*?\n}/g) ?? [];
    for (const [index, body] of formatters.entries()) {
      it(`${source.name} formatDue #${index + 1} uses the stored day`, () => {
        expect(body.includes("formatDueDay") || body.includes("slice(0, 10)")).toBe(true);
      });
    }
  }

  it("does not hand a due instant straight to toLocaleDateString", () => {
    // The inline case, which has no named formatter to inspect: `{new Date(row.due).toLocale...}`
    // in the lookahead and courses tables. Comments come out first -- `CampaignArc` quotes the
    // very pattern this forbids, in the paragraph explaining why it is forbidden.
    for (const source of sources) {
      const code = source.text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
      expect(code).not.toMatch(/new Date\((row\.)?due[A-Za-z]*\)\.toLocale/);
    }
  });
});
