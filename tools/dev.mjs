#!/usr/bin/env node
/**
 * The Worker and the web app together, from one command, on any platform.
 *
 * They have always had to run side by side — Vite proxies `/api` to `wrangler dev` on 8787 — and
 * "open two terminals" is a genuine failure mode rather than a nuisance: the app boots, the API
 * is not there, and every screen shows a network error that looks like a bug in the app.
 *
 * A tiny spawn wrapper rather than `concurrently`, because a dependency added for one command is
 * a dependency to install, audit and keep current, and Node has had everything needed since v16.
 *
 * Output is prefixed per process so it is obvious which one is complaining, and either exiting
 * takes the other down — a half-running pair is the state that produces the confusing error.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

const TASKS = [
  { name: "api", args: ["--filter", "@schoolquest/api", "dev"] },
  { name: "web", args: ["--filter", "@schoolquest/web", "dev"] },
];

const children = [];
let shuttingDown = false;

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    // SIGTERM is not a thing on Windows; taskkill is what actually ends a process tree there,
    // and a stray wrangler holding port 8787 is exactly what makes the next `pnpm dev` fail.
    if (WINDOWS) spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exitCode = code;
}

for (const task of TASKS) {
  const child = spawn("pnpm", task.args, {
    cwd: ROOT,
    shell: WINDOWS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);

  const prefix = (stream) => (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim()) stream.write(`[${task.name}] ${line}\n`);
    }
  };
  child.stdout.on("data", prefix(process.stdout));
  child.stderr.on("data", prefix(process.stderr));

  child.on("exit", (code) => {
    if (!shuttingDown) console.log(`\n[${task.name}] stopped (${code}) — shutting the other down too.\n`);
    stopAll(code ?? 1);
  });
  child.on("error", (err) => {
    console.error(`[${task.name}] could not start: ${err.message}`);
    stopAll(1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stopAll(0));

console.log("\nSchoolQuest is starting.  API on http://127.0.0.1:8787,  app on http://127.0.0.1:5173");
console.log("Open the second one in a browser. Ctrl-C stops both.\n");
