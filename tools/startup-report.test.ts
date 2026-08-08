import { describe, expect, it } from "vitest";

// @ts-expect-error - plain .mjs with JSDoc types, no declaration file
import { HEARTBEAT_SECONDS, SLOW_AFTER_SECONDS, startupReport } from "./startup-report.mjs";

type Report = { kind: "silent" | "heartbeat" | "slow"; lines: string[] };

function report(input: {
  waitedSeconds: number;
  waiting: string[];
  lastHeartbeatAt?: number;
  saidItWasSlow?: boolean;
}): Report {
  return startupReport({
    lastHeartbeatAt: 0,
    saidItWasSlow: false,
    ...input,
  }) as Report;
}

describe("startupReport", () => {
  it("says nothing once both halves are answering", () => {
    expect(report({ waitedSeconds: 999, waiting: [] })).toEqual({ kind: "silent", lines: [] });
  });

  it("says nothing in the first seconds, when a fast start needs no commentary", () => {
    expect(report({ waitedSeconds: 3, waiting: ["api"] }).kind).toBe("silent");
  });

  it("names the half that has not arrived, not just that something is missing", () => {
    // Which one it is changes what to check, so a generic "still starting" would be useless.
    const web = report({ waitedSeconds: HEARTBEAT_SECONDS, waiting: ["web"] });
    expect(web.lines.join(" ")).toContain("waiting on web");
    expect(web.lines.join(" ")).not.toContain("api");

    const both = report({ waitedSeconds: HEARTBEAT_SECONDS, waiting: ["api", "web"] });
    expect(both.lines.join(" ")).toContain("waiting on api and web");
  });

  it("beats every 15s so a slow start is distinguishable from a hung one", () => {
    expect(report({ waitedSeconds: 15, waiting: ["web"], lastHeartbeatAt: 0 }).kind).toBe(
      "heartbeat",
    );
    // Not again until the next interval: a line every 500ms would be its own kind of alarming.
    expect(report({ waitedSeconds: 20, waiting: ["web"], lastHeartbeatAt: 15 }).kind).toBe("silent");
    expect(report({ waitedSeconds: 30, waiting: ["web"], lastHeartbeatAt: 15 }).kind).toBe(
      "heartbeat",
    );
  });

  it("reassures rather than alarms before the slow threshold", () => {
    const lines = report({ waitedSeconds: 45, waiting: ["web"], lastHeartbeatAt: 30 }).lines.join(
      " ",
    );
    expect(lines).toContain("normal on a first run");
  });

  describe("after three minutes", () => {
    it("admits it is slow and says what is worth checking", () => {
      const slow = report({ waitedSeconds: SLOW_AFTER_SECONDS, waiting: ["web"] });
      expect(slow.kind).toBe("slow");

      const text = slow.lines.join(" ");
      expect(text).toContain("over 3 minutes");
      expect(text).toContain("Still waiting");
      // The three things actually worth doing, rather than a bare failure.
      expect(text).toContain("[web] lines above");
      expect(text).toContain("port");
      expect(text).toContain("http://127.0.0.1:5173");
    });

    it("keeps waiting instead of giving up", () => {
      // The regression this file exists for. An earlier version stopped polling at the deadline,
      // which abandoned opening the browser exactly when it was about to become possible -- the
      // servers were still running and still starting the whole time.
      const muchLater = report({
        waitedSeconds: SLOW_AFTER_SECONDS * 4,
        waiting: ["web"],
        lastHeartbeatAt: SLOW_AFTER_SECONDS * 4 - HEARTBEAT_SECONDS,
        saidItWasSlow: true,
      });
      expect(muchLater.kind).toBe("heartbeat");
      expect(muchLater.lines.join(" ")).toContain("waiting on web");
    });

    it("says it is slow once, not on every beat afterwards", () => {
      const again = report({
        waitedSeconds: SLOW_AFTER_SECONDS + 60,
        waiting: ["web"],
        lastHeartbeatAt: SLOW_AFTER_SECONDS + 45,
        saidItWasSlow: true,
      });
      expect(again.kind).toBe("heartbeat");
      expect(again.lines.join(" ")).not.toContain("over 3 minutes");
    });

    it("drops the it-is-normal reassurance once it is no longer true", () => {
      const after = report({
        waitedSeconds: SLOW_AFTER_SECONDS + 15,
        waiting: ["web"],
        lastHeartbeatAt: SLOW_AFTER_SECONDS,
        saidItWasSlow: true,
      });
      expect(after.lines.join(" ")).not.toContain("normal on a first run");
    });
  });
});
