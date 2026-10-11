import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USAGE_EVENTS } from "../packages/domain/src/usage.js";
// @ts-expect-error -- plain .mjs, no declarations
import { formatReport, parseArgs, readAllowlist, reportSql, windowStart } from "./usage-report.mjs";

describe("pnpm usage:report", () => {
  it("reads the same allowlist the app and the API use", () => {
    expect(readAllowlist()).toEqual([...USAGE_EVENTS]);
  });

  it("defaults to the local database and 30 days", () => {
    expect(parseArgs([])).toEqual({ remote: false, days: 30 });
    expect(parseArgs(["--remote", "--days", "7"])).toEqual({ remote: true, days: 7 });
    expect(parseArgs(["--days=90"])).toEqual({ remote: false, days: 90 });
    expect(() => parseArgs(["--days", "soon"])).toThrow();
    expect(() => parseArgs(["--remtoe"])).toThrow();
  });

  it("counts today as the last day of the window", () => {
    expect(windowStart(1, Date.parse("2026-10-11T12:00:00Z"))).toBe("2026-10-11");
    expect(windowStart(30, Date.parse("2026-10-11T12:00:00Z"))).toBe("2026-09-12");
  });

  it("builds SQL that survives cmd.exe quoting", () => {
    const sql = reportSql("2026-09-12");
    expect(sql).not.toMatch(/["%]/);
    expect(sql).toContain("COUNT(DISTINCT subject)");
    expect(sql).toContain("ORDER BY users DESC");
    expect(() => reportSql("2026-09-12'; DROP TABLE users")).toThrow();
  });

  it("prints used events in order, then every allowlisted event nobody used", () => {
    const text: string = formatReport({
      rows: [
        { event: "tab.week", users: 4, total: 40 },
        { event: "tab.radar", users: 2, total: 9 },
      ],
      allowlist: ["tab.radar", "tab.week", "tab.stats", "coach.send"],
      days: 30,
      since: "2026-09-12",
      remote: false,
      distinctUsers: 4,
    });
    const lines = text.split("\n");
    expect(lines.findIndex((l) => l.startsWith("tab.week"))).toBeLessThan(
      lines.findIndex((l) => l.startsWith("tab.radar")),
    );
    expect(text).toContain("Not used (2 of 4 allowlisted events):\n  tab.stats\n  coach.send");
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it("is ASCII, like the other scripts a console prints", () => {
    const source = readFileSync(new URL("./usage-report.mjs", import.meta.url), "utf8");
    expect(source).toMatch(/^[\t\n\r\x20-\x7e]*$/);
  });
});
