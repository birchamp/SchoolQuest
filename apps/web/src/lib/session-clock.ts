/**
 * When a session was started, remembered on this device.
 *
 * "Start session" sets the block's status on the server and, until this existed, nothing else:
 * the screen after the click was identical to the screen before it, and the primary button on
 * Today looked dead. The status is the durable fact and the server holds it; what the server does
 * not hold is *when*, and that is what lets Stop record the minutes actually worked instead of
 * the minutes that were planned.
 *
 * Kept in localStorage rather than a new column on purpose: a started block seen from another
 * device still shows as in progress (that comes from the status), it just cannot say for how
 * long, and Stop then falls back to the planned length -- which is exactly what "Mark done" has
 * always recorded. No stored data changes shape for this.
 */
const PREFIX = "sq_session_started:";

function key(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

/** Records that a session was started now. Safe where storage is unavailable. */
export function noteSessionStarted(sessionId: string, now: Date = new Date()): void {
  try {
    localStorage.setItem(key(sessionId), now.toISOString());
  } catch {
    // Private mode or a full store: the status still changes server-side, only the clock is lost.
  }
}

/** Forgets a session's start, once its outcome has been recorded. */
export function clearSessionStarted(sessionId: string): void {
  try {
    localStorage.removeItem(key(sessionId));
  } catch {
    // Nothing to clear, or nowhere to clear it from.
  }
}

/**
 * Whole minutes since the session was started here, or null when this device never saw it start
 * (or the stored value is unreadable). Never negative: a clock that went backwards reads as zero.
 */
export function minutesSinceStarted(sessionId: string, now: Date = new Date()): number | null {
  return minutesBetween(readStarted(sessionId), now);
}

/** The pure part, so the arithmetic can be tested without a DOM. */
export function minutesBetween(startedAtIso: string | null, now: Date): number | null {
  if (startedAtIso === null) return null;
  const started = Date.parse(startedAtIso);
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.floor((now.getTime() - started) / 60_000));
}

function readStarted(sessionId: string): string | null {
  try {
    return localStorage.getItem(key(sessionId));
  } catch {
    return null;
  }
}
