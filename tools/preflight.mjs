#!/usr/bin/env node
/**
 * Everything that has to be true before a live run, checked in one command.
 *
 * The point is *when* the failure is found. Every check here corresponds to something that
 * otherwise surfaces halfway through a real test, wearing a disguise: no `AUTH_SECRET` looks
 * like a broken sign-in button, an unmigrated database looks like a server crash, a port already
 * held by yesterday's `wrangler dev` looks like the app failing to start, and no OpenRouter key
 * looks like extraction hanging.
 *
 * Every line says what to do about it, because a check that only reports a state is a check that
 * sends someone back to the documentation.
 *
 *   node tools/preflight.mjs      (or: pnpm preflight)
 *
 * Exits non-zero if anything would stop a run. Warnings do not fail it.
 */
import { freePorts, SCHOOLQUEST_PORTS } from "./free-ports.mjs";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = join(ROOT, "apps", "api");

let failures = 0;
const pass = (m) => console.log(`  ✓  ${m}`);
const fail = (m, fix) => {
  failures += 1;
  console.log(`  ✗  ${m}\n     → ${fix}`);
};
const warn = (m, note) => console.log(`  !  ${m}\n     → ${note}`);


console.log("\nSchoolQuest preflight\n");

// --- Node. Workers' local runtime and several scripts here need 22.
const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) pass(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old`, "install Node 22 or newer from nodejs.org");

// --- Dependencies.
if (existsSync(join(ROOT, "node_modules", ".pnpm"))) pass("dependencies installed");
else fail("dependencies are not installed", "run: pnpm install");

// --- Secrets.
const devVars = join(API, ".dev.vars");
if (!existsSync(devVars)) {
  fail("apps/api/.dev.vars is missing", "run: pnpm setup");
} else {
  const text = readFileSync(devVars, "utf8");
  const secret = /^AUTH_SECRET=(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  if (secret.length >= 16) pass("AUTH_SECRET is set");
  else fail("AUTH_SECRET is missing or too short", "delete apps/api/.dev.vars and run: pnpm setup");

  const key = /^OPENROUTER_API_KEY=(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  /**
   * A placeholder has the right shape and buys nothing.
   *
   * `sk-or-mock` is what the offline test harness uses, and it passes any check that only looks
   * at the prefix — which is how a live test ends up producing invented data that looks real.
   */
  const placeholder = /mock|sample|example|xxx|your[-_]?key|changeme/i.test(key);
  if (placeholder) {
    fail(
      `OPENROUTER_API_KEY is a placeholder (${key}), not a real key`,
      "replace it with a key from openrouter.ai/keys, or delete the line and add yours in the app",
    );
  } else if (key.startsWith("sk-or-")) {
    pass("an OpenRouter key is configured for the whole install");
  } else if (key) {
    fail(`OPENROUTER_API_KEY does not look like an OpenRouter key (${key.slice(0, 10)}…)`, "OpenRouter keys start with sk-or-");
  } else {
    // Not a failure. Per-student keys are the intended arrangement, and the app says so on screen
    // rather than failing silently — but on a first run it is worth knowing which state you are in.
    warn(
      "no install-wide OpenRouter key",
      "fine — add your own in the app under Setup → AI and model before uploading a syllabus",
    );
  }

  if (/^RESEND_API_KEY=re_/m.test(text)) {
    warn(
      "a mail provider is configured",
      "sign-in links will be emailed. For a local test, comment RESEND_API_KEY out and the link " +
        "comes back on screen instead — no email needed",
    );
  } else {
    pass("no mail provider, so sign-in links appear on screen (right for a local run)");
  }

  if (/^OPENROUTER_BASE_URL=/m.test(text)) {
    fail(
      "OPENROUTER_BASE_URL is set, which points the app at a mock instead of the real model",
      "comment it out in apps/api/.dev.vars — it is only for the offline test harness",
    );
  } else pass("pointing at the real OpenRouter, not the test mock");
}

// --- Local database.
const d1 = join(API, ".wrangler", "state", "v3", "d1");
if (existsSync(d1)) pass("local database exists");
else fail("no local database yet", "run: pnpm setup");

/**
 * --- Ports. Reclaimed rather than reported.
 *
 * This used to fail with a netstat-and-taskkill recipe, one port at a time -- so a student who
 * closed the window with the X killed one process, ran again, hit the other port, killed that,
 * ran again. Three rounds of it were observed on a real machine. Handing that to someone who
 * finds multi-step processes costly, as the first thing the app does, is indefensible.
 *
 * Our own leftovers are stopped here. Anything else still fails, and says what has the port:
 * 5173 is a conventional dev port and another project's server has every right to it.
 */
for (const result of await freePorts(SCHOOLQUEST_PORTS)) {
  if (result.state === "free") pass(`port ${result.port} is free (${result.label})`);
  else if (result.state === "freed")
    pass(`port ${result.port} reclaimed from an earlier run (${result.label})`);
  else if (result.state === "blocked")
    fail(
      `port ${result.port} is in use by ${result.by}, so ${result.label} cannot start`,
      "close that program, then run this again",
    );
  else
    fail(
      `port ${result.port} would not free up, so ${result.label} cannot start`,
      "restarting the machine always clears it",
    );
}

console.log(
  failures === 0
    ? "\nReady. Run `pnpm dev`, open http://127.0.0.1:5173, and sign in with any email address.\n"
    : `\n${failures} thing${failures === 1 ? "" : "s"} to fix before running.\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
