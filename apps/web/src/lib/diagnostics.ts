/**
 * Client-side diagnostics ring buffer.
 *
 * Why this exists at all: an install can be built against any backend, and self-hosted, so the
 * person who hits an error is a student, not the developer -- a server-side Worker log is on a
 * machine nobody debugging can reach. The log has to travel the other way. This keeps the last
 * few hundred console lines and API breadcrumbs in memory and hands them back as plain text the
 * student can copy and paste into an email.
 *
 * In memory only. Nothing is written to disk and nothing is ever sent anywhere on its own --
 * copying is an explicit action the student takes. Request and response *bodies* are never
 * recorded, only method, path and status, so a syllabus's page text and the session token stay
 * out of the log. Keep it that way: anything added here is something a student might paste into
 * an email to a stranger.
 */

/** How many lines to keep. The student was told "the last 500 lines", so hold exactly that many. */
const MAX_ENTRIES = 500;

/** One pathological argument (a whole stack, a serialized object) must not swallow the buffer. */
const MAX_LINE = 2000;

interface Entry {
  /** Epoch milliseconds. Rendered as an ISO timestamp on dump. */
  t: number;
  /** "log" | "info" | "warn" | "error" | "debug" | "api" -- the console level or a breadcrumb tag. */
  level: string;
  text: string;
}

const buffer: Entry[] = [];

function push(level: string, text: string): void {
  const clipped = text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)} ...[truncated]` : text;
  buffer.push({ t: Date.now(), level, text: clipped });
  // Ring: drop the oldest once over capacity. splice handles a burst that overshoots by more than one.
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

/** Best-effort rendering of one console argument to a string, stacks and all. */
function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) {
    return arg.stack ? `${arg.name}: ${arg.message}\n${arg.stack}` : `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    // Circular structures, BigInt, and the like. String() never throws for these.
    return String(arg);
  }
}

/**
 * Record an explicit breadcrumb. Used by the API client to note each request's method, path and
 * status -- never its body. `level` is a short tag ("api") so these stand out in the dump.
 */
export function recordDiagnostic(level: string, message: string): void {
  push(level, message);
}

let installed = false;

/**
 * Mirror console output into the buffer. Wraps log/info/warn/error/debug so anything the app
 * already logs is captured, then calls through to the original so devtools still shows it.
 * Idempotent: safe under React StrictMode's double-invoke and any duplicate import.
 */
export function installConsoleCapture(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;
  const levels = ["log", "info", "warn", "error", "debug"] as const;
  for (const level of levels) {
    const original = console[level]?.bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        push(level, args.map(stringifyArg).join(" "));
      } catch {
        // Logging must never throw; a bad arg is not worth crashing a render over.
      }
      original?.(...args);
    };
  }
}

/** Build and environment context, so a pasted log names which install produced it. */
function header(): string {
  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
  const apiBase = (import.meta.env["VITE_API_URL"] as string | undefined) || "(same origin)";
  const shell =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "desktop (Tauri)" : "browser";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  return [
    "SchoolQuest diagnostics",
    `Copied:  ${new Date().toISOString()}`,
    `Version: ${version}`,
    `Shell:   ${shell}`,
    `Server:  ${apiBase}`,
    `Browser: ${ua}`,
    `Lines:   ${buffer.length}${buffer.length === MAX_ENTRIES ? " (oldest dropped)" : ""}`,
  ].join("\n");
}

/** The whole buffer as text: a context header, then one timestamped line per entry, oldest first. */
export function dumpDiagnostics(): string {
  const lines = buffer.map(
    (e) => `${new Date(e.t).toISOString()} [${e.level}] ${e.text}`,
  );
  const body = lines.length > 0 ? lines.join("\n") : "(no activity recorded)";
  return `${header()}\n\n${body}\n`;
}

/**
 * Copy the diagnostics to the clipboard. Returns false when the clipboard is unavailable (an
 * insecure origin, a browser that withholds it, or a denied permission) so the caller can fall
 * back to showing selectable text.
 */
export async function copyDiagnostics(): Promise<boolean> {
  const text = dumpDiagnostics();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Test-only: empty the buffer so one test's entries do not leak into the next. */
export function __resetDiagnosticsForTest(): void {
  buffer.length = 0;
}
