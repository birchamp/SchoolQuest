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
const URL = "http://127.0.0.1:5173";

/** Resolves true if something is listening, false otherwise. Never rejects. */
function isListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(500);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

function openBrowser(url) {
  const [cmd, args] = WINDOWS
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];

  const child = spawn(cmd, args, { stdio: "ignore", detached: true });

  /**
   * Failing to open a browser must not stop the app.
   *
   * `spawn` reports a missing binary as an `error` *event*, and an unhandled one is a thrown
   * exception that ends this process - which then takes both servers down on its way out. A
   * container with no `xdg-open` did exactly that here: two healthy servers killed by the
   * convenience that was meant to save a copy-paste.
   */
  child.on("error", () => {
    console.log(`Could not open a browser automatically. Open ${url} yourself.`);
  });
  child.unref();
}

if (OPEN) {
  /**
   * Both halves, not just the one being opened.
   *
   * Waiting only on 5173 opens a browser as soon as Vite is up, which on a cold start is well
   * before `wrangler` is — and the app then renders a network error on every screen. That is the
   * exact confusion this file exists to prevent, arrived at from the other direction.
   *
   * Three minutes, not ninety seconds. A first run on Windows downloads the `workerd` binary and
   * pre-bundles every dependency, and ninety seconds was observed timing out on a machine where
   * nothing was actually wrong. The cost of waiting too long is a slightly later browser; the
   * cost of giving up too early is someone concluding the app is broken.
   */
  const halves = [
    { name: "api", port: 8787 },
    { name: "web", port: 5173 },
  ];
  const deadline = Date.now() + 180_000;
  let announced = 0;

  const poll = async () => {
    if (shuttingDown) return;

    const states = await Promise.all(halves.map((half) => isListening(half.port)));
    const waitingFor = halves.filter((_, index) => !states[index]);

    if (waitingFor.length === 0) {
      openBrowser(URL);
      console.log(`\nOpened ${URL}\n`);
      return;
    }

    if (Date.now() >= deadline) {
      // Naming the half that never came up, because the fix differs: the api is usually a busy
      // 8787 or a migration that never ran, the web side is usually a busy 5173.
      const names = waitingFor.map((half) => `${half.name} (port ${half.port})`).join(" and ");
      console.log(`\nStill waiting on ${names} after 3 minutes.`);
      console.log(`Read the [api] and [web] lines above - they say why. Open ${URL} to try anyway.\n`);
      return;
    }

    // A silent console for three minutes is indistinguishable from a hang, and someone who
    // concludes it has hung presses Ctrl-C at the ninety-second mark of a two-minute install.
    const waited = Math.round((Date.now() - (deadline - 180_000)) / 1000);
    if (waited >= announced + 15) {
      announced = waited;
      const names = waitingFor.map((half) => half.name).join(" and ");
      console.log(`  still starting (${waited}s) - waiting on ${names}. This is normal on a first run.`);
    }

    setTimeout(poll, 500);
  };

  setTimeout(poll, 1500);
}
