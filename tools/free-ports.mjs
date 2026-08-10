/**
 * Reclaims the two ports SchoolQuest runs on, when it is safe to do so.
 *
 * ## Why this exists
 *
 * Closing the console window with the X rather than Ctrl-C leaves `wrangler` and `vite` running.
 * Nothing on screen says so, and the next launch fails preflight on a busy port. Worse, it fails
 * on *one* port: kill that, run again, fail on the other, kill that, run again -- observed three
 * rounds deep on a real machine, with the student doing `netstat` and `taskkill` by hand between
 * each. For an app whose entire premise is removing multi-step processes from people who find
 * them costly, that is close to the worst possible first minute.
 *
 * ## Why it is safe to kill
 *
 * Only processes that are recognisably ours. 5173 and 8787 are conventional dev ports, so
 * another project's Vite could genuinely be sitting there, and killing a stranger's server
 * because it picked the same number would be indefensible. So the owning process is identified
 * first, and anything not in `OURS` is reported and left alone -- the student is told what has
 * the port and can decide.
 *
 * Kills are TERM first, KILL only if it is still holding on. A `wrangler` given a chance to
 * shut down releases its D1 file cleanly; one shot in the head does not.
 */

import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";

const WINDOWS = process.platform === "win32";

/**
 * Process names this is willing to stop.
 *
 * `workerd` is the Workers runtime wrangler spawns, and it is usually the one actually holding
 * 8787 -- killing only the wrangler wrapper leaves the port held by an orphan, which is exactly
 * the "I killed it and it is still there" case.
 */
const OURS = ["node", "node.exe", "workerd", "workerd.exe", "esbuild", "esbuild.exe"];

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // A non-zero exit here means "nothing matched", which is the common case, not a fault.
    return "";
  }
}

/** PIDs listening on a port. Empty when the port is free. */
export function listenersOn(port) {
  if (WINDOWS) {
    const out = run("netstat", ["-ano", "-p", "tcp"]);
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      // The local address column, so a connection *to* this port from elsewhere is not counted.
      const columns = line.trim().split(/\s+/);
      const local = columns[1] ?? "";
      if (!local.endsWith(`:${port}`)) continue;
      const pid = Number(columns[columns.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }

  const out = run("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
  return out
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** The executable name for a pid, lowercased, or null if it has already gone. */
export function processName(pid) {
  if (WINDOWS) {
    const out = run("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"]);
    const match = out.match(/^"([^"]+)"/);
    return match ? match[1].toLowerCase() : null;
  }
  const out = run("ps", ["-p", String(pid), "-o", "comm="]).trim();
  return out ? out.split("/").pop().toLowerCase() : null;
}

export function isOurs(name) {
  return name !== null && OURS.includes(name);
}

/** True once nothing is listening. Polls, because a port is released a moment after the exit. */
async function waitUntilFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const free = await new Promise((resolve) => {
      const socket = createConnection({ port, host: "127.0.0.1" });
      const done = (answer) => {
        socket.destroy();
        resolve(answer);
      };
      socket.setTimeout(300);
      socket.on("connect", () => done(false));
      socket.on("timeout", () => done(true));
      socket.on("error", () => done(true));
    });
    if (free) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function stop(pid, force) {
  if (WINDOWS) {
    // /T so the whole tree goes: wrangler spawns workerd, and killing only the parent leaves
    // the child holding the port, which is the "I killed it and it is still there" case.
    run("taskkill", force ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/T"]);
    return;
  }
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // Already gone between listing and killing, which is a success.
  }
}

/**
 * Frees the given ports.
 *
 * Returns what happened per port so the caller can decide whether to continue: `freed` when it
 * was ours and is now gone, `free` when nothing held it, and `blocked` -- with the process name
 * -- when something we do not recognise has it.
 */
export async function freePorts(ports, log = () => {}) {
  const results = [];

  for (const { port, label } of ports) {
    const pids = listenersOn(port);
    if (pids.length === 0) {
      results.push({ port, label, state: "free" });
      continue;
    }

    const strangers = pids
      .map((pid) => ({ pid, name: processName(pid) }))
      .filter((p) => p.name !== null && !isOurs(p.name));

    if (strangers.length > 0) {
      results.push({
        port,
        label,
        state: "blocked",
        by: [...new Set(strangers.map((p) => p.name))].join(", "),
      });
      continue;
    }

    log(`  port ${port} (${label}) is held by an earlier run -- stopping it`);
    for (const pid of pids) stop(pid, false);
    if (!(await waitUntilFree(port, 4000))) {
      for (const pid of pids) stop(pid, true);
      await waitUntilFree(port, 3000);
    }

    results.push({
      port,
      label,
      state: listenersOn(port).length === 0 ? "freed" : "stuck",
    });
  }

  return results;
}

export const SCHOOLQUEST_PORTS = [
  { port: 8787, label: "the API" },
  { port: 5173, label: "the app" },
];

// Runnable on its own: `node tools/free-ports.mjs`, for when someone wants to do it by hand.
if (process.argv[1] && process.argv[1].endsWith("free-ports.mjs")) {
  const results = await freePorts(SCHOOLQUEST_PORTS, (line) => console.log(line));
  for (const r of results) {
    if (r.state === "free") console.log(`  port ${r.port} (${r.label}) was already free`);
    else if (r.state === "freed") console.log(`  port ${r.port} (${r.label}) is free now`);
    else if (r.state === "blocked")
      console.log(`  port ${r.port} (${r.label}) is held by ${r.by}, which is not SchoolQuest`);
    else console.log(`  port ${r.port} (${r.label}) would not let go`);
  }
}
