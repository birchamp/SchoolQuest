/**
 * What to say while waiting for the servers, and when to say it.
 *
 * Its own module, and pure, because this is the code that decides whether someone concludes the
 * app is broken -- and it has now been wrong twice. First it opened a browser as soon as Vite
 * answered, well before the Worker, so every screen showed a network error. Then it gave up
 * waiting at a fixed deadline and stopped polling, abandoning the one job it had left at the
 * moment it was about to become possible.
 *
 * Both were untestable while the decision lived inside an async polling loop: reproducing them
 * meant a cold cache and a three-minute wait. As a function of elapsed seconds it is neither.
 */

export const SLOW_AFTER_SECONDS = 180;
export const HEARTBEAT_SECONDS = 15;

/**
 * @param {object} input
 * @param {number} input.waitedSeconds     how long since the servers were started
 * @param {string[]} input.waiting         names of the halves not yet answering, e.g. ["web"]
 * @param {number} input.lastHeartbeatAt   waitedSeconds at the previous heartbeat, or 0
 * @param {boolean} input.saidItWasSlow    whether the "over 3 minutes" notice has been given
 * @returns {{ kind: "silent" | "heartbeat" | "slow", lines: string[] }}
 */
export function startupReport({ waitedSeconds, waiting, lastHeartbeatAt, saidItWasSlow }) {
  if (waiting.length === 0) return { kind: "silent", lines: [] };

  const names = waiting.join(" and ");

  // Said once, on crossing the line, and never again -- after which the heartbeat continues and
  // so does the polling. "Slow" is a thing to mention, not a reason to stop.
  if (waitedSeconds >= SLOW_AFTER_SECONDS && !saidItWasSlow) {
    return {
      kind: "slow",
      lines: [
        "",
        `  ${names} has taken over 3 minutes. Still waiting - this may still be fine.`,
        "  A first run pre-bundles every dependency, which is slow on Windows when an antivirus",
        `  scans each file as it is written. Worth checking: the [${waiting[0]}] lines above for a`,
        "  real error, and whether something else is already using the port.",
        "  http://127.0.0.1:5173 is worth trying in a browser regardless.",
        "",
      ],
    };
  }

  // A silent console is indistinguishable from a hung one, and someone who decides it has hung
  // presses Ctrl-C at the ninety-second mark of a two-minute start. Which is what happened.
  if (waitedSeconds >= lastHeartbeatAt + HEARTBEAT_SECONDS) {
    const note = saidItWasSlow ? "" : " This is normal on a first run.";
    return {
      kind: "heartbeat",
      lines: [`  still starting (${waitedSeconds}s) - waiting on ${names}.${note}`],
    };
  }

  return { kind: "silent", lines: [] };
}
