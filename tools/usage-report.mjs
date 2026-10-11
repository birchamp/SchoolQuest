#!/usr/bin/env node
/**
 * pnpm usage:report [--remote] [--days N]
 *
 * Reads the usage log (usage_daily, see apps/api/src/usage.ts) and prints, for each event, how
 * many distinct people used it and how many times in total over the last N days (default 30),
 * most-used first. Then lists every allowlisted event nobody used in that window.
 *
 * Local D1 by default; --remote reads the deployed database (needs `wrangler login`).
 *
 * ASCII only, like the Windows scripts: this prints to whatever console the owner has.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = join(ROOT, "apps", "api");
const DOMAIN_USAGE = join(ROOT, "packages", "domain", "src", "usage.ts");

/** --remote and --days N (or --days=N). Throws on anything else, so a typo is not ignored. */
export function parseArgs(argv) {
  const options = { remote: false, days: 30 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--remote") options.remote = true;
    else if (arg === "--local") options.remote = false;
    else if (arg === "--days" || arg.startsWith("--days=")) {
      const raw = arg === "--days" ? argv[++i] : arg.slice("--days=".length);
      const days = Number(raw);
      if (!Number.isInteger(days) || days < 1) throw new Error(`--days needs a whole number, got ${raw}`);
      options.days = days;
    } else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}. Use --remote and/or --days N.`);
  }
  return options;
}

/**
 * The allowlist, read from its one source rather than copied. The domain package is TypeScript
 * and this is plain Node, so the array literal is read as text; a test holds this to the real list.
 */
export function readAllowlist(source = readFileSync(DOMAIN_USAGE, "utf8")) {
  const start = source.indexOf("USAGE_EVENTS = [");
  const end = source.indexOf("] as const", start);
  if (start < 0 || end < 0) throw new Error("Could not find USAGE_EVENTS in packages/domain/src/usage.ts");
  return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The first UTC day in the window: today and the N-1 days before it. */
export function windowStart(days, now = Date.now()) {
  return new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** Kept free of double quotes and percent signs, so it survives cmd.exe quoting on Windows. */
export function reportSql(since) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`Bad date ${since}`);
  return (
    "SELECT event, COUNT(DISTINCT subject) AS users, SUM(count) AS total FROM usage_daily " +
    `WHERE day >= '${since}' GROUP BY event ORDER BY users DESC, total DESC, event`
  );
}

export function distinctSql(since) {
  return `SELECT COUNT(DISTINCT subject) AS users FROM usage_daily WHERE day >= '${since}'`;
}

function runQuery(sql, remote) {
  const args = ["exec", "wrangler", "d1", "execute", "schoolquest", remote ? "--remote" : "--local", "--json", "--command"];
  const windows = process.platform === "win32";
  // On Windows pnpm is pnpm.cmd, which Node only finds through a shell (see CLAUDE.md). A shell
  // joins arguments with spaces, so the SQL is quoted here; reportSql keeps it free of quotes.
  const output = execFileSync(windows ? "pnpm.cmd" : "pnpm", [...args, windows ? `"${sql}"` : sql], {
    cwd: API_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: windows,
  });
  // wrangler prints a JSON array of statement results; anything before it is banner text.
  const json = output.slice(output.indexOf("["));
  const parsed = JSON.parse(json);
  return parsed[0]?.results ?? [];
}

function pad(text, width, right = false) {
  const s = String(text);
  return right ? s.padStart(width) : s.padEnd(width);
}

/** The used events as an aligned table, then the unused ones. Pure, for the test. */
export function formatReport({ rows, allowlist, days, since, remote, distinctUsers }) {
  const lines = [];
  lines.push(`Usage over the last ${days} day(s), since ${since} UTC (${remote ? "remote" : "local"} database)`);
  lines.push(`Distinct people in the window: ${distinctUsers}`);
  lines.push("");
  const width = Math.max(5, ...allowlist.map((e) => e.length), ...rows.map((r) => String(r.event).length));
  lines.push(`${pad("event", width)}  ${pad("users", 6, true)}  ${pad("total", 8, true)}`);
  lines.push(`${"-".repeat(width)}  ${"-".repeat(6)}  ${"-".repeat(8)}`);
  for (const row of rows) {
    lines.push(`${pad(row.event, width)}  ${pad(row.users, 6, true)}  ${pad(row.total, 8, true)}`);
  }
  if (rows.length === 0) lines.push("(nothing recorded in this window)");
  const used = new Set(rows.map((r) => r.event));
  const unused = allowlist.filter((e) => !used.has(e));
  lines.push("");
  lines.push(`Not used (${unused.length} of ${allowlist.length} allowlisted events):`);
  for (const event of unused) lines.push(`  ${event}`);
  if (unused.length === 0) lines.push("  (every event was used at least once)");
  return lines.join("\n");
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const since = windowStart(options.days);
  try {
    const rows = runQuery(reportSql(since), options.remote);
    const [distinct] = runQuery(distinctSql(since), options.remote);
    console.log(
      formatReport({
        rows,
        allowlist: readAllowlist(),
        days: options.days,
        since,
        remote: options.remote,
        distinctUsers: distinct?.users ?? 0,
      }),
    );
  } catch (e) {
    const detail = String(e.stderr || e.stdout || e.message).trim().slice(-800);
    console.error(`Could not read the usage log.\n${detail}`);
    if (/no such table/i.test(detail)) {
      console.error("\nThe usage_daily table is missing: apply migration 0012 (pnpm db:migrate:local, or --remote).");
    }
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
