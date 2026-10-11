/**
 * Starting and stopping the two dev servers for a journey, shared so that every journey waits,
 * fails fast and cleans up the same way.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WINDOWS = process.platform === "win32";
export const ATTACH = process.argv.includes("--attach");

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

let dev = null;
let devExited = null;

export async function waitForServers(timeoutMs = 240_000) {
  const started = Date.now();
  for (;;) {
    const [api, web] = await Promise.all([isListening(8787), isListening(5173)]);
    if (api && web) return;
    if (devExited !== null) throw new Error(`the dev runner exited with code ${devExited} before both servers were up`);
    if (Date.now() - started > timeoutMs) {
      throw new Error(`servers did not come up within ${timeoutMs / 1000}s (api: ${api}, web: ${web})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Starts `tools/dev.mjs` and returns the tail of its output, kept for the failure report.
 * `workerVars` ({ NAME: value }) reach the Worker as `wrangler dev --var`, via SQ_WORKER_VARS.
 */
export function startServers({ workerVars = {} } = {}) {
  const vars = Object.entries(workerVars).map(([name, value]) => `${name}=${value}`).join(" ");
  dev = spawn("node", ["tools/dev.mjs"], {
    cwd: ROOT,
    env: vars ? { ...process.env, SQ_WORKER_VARS: vars } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: WINDOWS,
    detached: !WINDOWS,
  });
  const log = [];
  // A runner that dies (a port held by something else, say) must fail the journey now, not
  // after four minutes of waiting for ports that will never answer.
  dev.on("exit", (code) => {
    devExited = code ?? 1;
  });
  for (const stream of [dev.stdout, dev.stderr]) {
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) if (line.trim()) log.push(line);
      if (log.length > 400) log.splice(0, log.length - 400);
    });
  }
  return log;
}

export function stopServers() {
  if (!dev?.pid) return;
  if (WINDOWS) spawn("taskkill", ["/pid", String(dev.pid), "/f", "/t"], { stdio: "ignore" });
  else {
    try {
      process.kill(-dev.pid, "SIGTERM");
    } catch {
      try { dev.kill("SIGTERM"); } catch { /* already gone */ }
    }
  }
}
