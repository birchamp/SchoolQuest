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
import { createConnection } from "node:net";
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
    if (!child.pid) continue;
    /**
     * Kill the whole tree, not the process we happen to hold.
     *
     * `pnpm --filter … dev` is a wrapper: the thing actually holding port 8787 is a `wrangler`
     * two levels below it. Signalling the wrapper ends the wrapper and orphans its children,
     * which was observed here — a run stopped an hour earlier still had vite bound to 5173, so
     * the next launch could not start and reported a port conflict that looked like a bug in the
     * app rather than a leftover from before.
     *
     * On Windows `taskkill /t` does this. On POSIX the equivalent is signalling the process
     * *group*, which is why each child is spawned detached: `spawn` with `detached` makes the
     * child a group leader, and a negative pid signals every member.
     */
    if (WINDOWS) {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone, or never became a group leader. Falling back to the direct signal is
        // still better than leaving it running.
        try { child.kill("SIGTERM"); } catch { /* nothing left to kill */ }
      }
    }
  }
  process.exitCode = code;
}

for (const task of TASKS) {
  const child = spawn("pnpm", task.args, {
    cwd: ROOT,
    shell: WINDOWS,
    stdio: ["ignore", "pipe", "pipe"],
    // Makes the child its own process-group leader on POSIX, which is what lets `stopAll` take
    // the whole tree down. Meaningless on Windows, where `taskkill /t` does the same job.
    detached: !WINDOWS,
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

const OPEN = process.argv.includes("--open");

console.log("\nSchoolQuest is starting.  API on http://127.0.0.1:8787,  app on http://127.0.0.1:5173");
console.log(
  OPEN
    ? "A browser will open once it is ready. Closing this window stops the app.\n"
    : "Open the second one in a browser. Ctrl-C stops both.\n",
);

/**
 * Wait for the app to answer, then open it — only when asked.
 *
 * Behind `--open` because a terminal launch should not seize a browser window, while the desktop
 * shortcut has no other way to get anyone to the app: a console full of build output is not an
 * answer to "I double-clicked the icon".
 *
 * Polls the port rather than sleeping a fixed amount. Vite is quick on a warm cache and slow on
 * a cold one, and a browser opened at a dead port shows a connection error that reads as the app
 * being broken.
 */
if (OPEN) {
  const url = "http://127.0.0.1:5173";
  const deadline = Date.now() + 90_000;
  const poll = () => {
    if (shuttingDown) return;
    const socket = createConnection({ port: 5173, host: "127.0.0.1" });
    socket.setTimeout(500);
    const retry = () => {
      socket.destroy();
      if (Date.now() < deadline) setTimeout(poll, 500);
      else console.log(`\nStill not up after 90s. Open ${url} yourself, and read the lines above.`);
    };
    socket.on("connect", () => {
      socket.destroy();
      const [cmd, args] = WINDOWS
        ? ["cmd", ["/c", "start", "", url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
      spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
      console.log(`\nOpened ${url}\n`);
    });
    socket.on("timeout", retry);
    socket.on("error", retry);
  };
  setTimeout(poll, 1500);
}
