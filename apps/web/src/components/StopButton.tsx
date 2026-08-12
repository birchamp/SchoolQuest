import { useState } from "react";

/**
 * Stopping the app, from inside the app.
 *
 * Closing the browser tab stops nothing. Both servers keep running, invisibly, and the next
 * launch trips over the ports they still hold -- which is exactly how a student ended up doing
 * three rounds of `netstat` and `taskkill` by hand. The only real shutdown was Ctrl-C in a
 * console window that has usually been minimised and that nobody reasonably thinks of as part
 * of the app.
 *
 * So the answer lives where the person is looking. Reachable only when the app is being served
 * by the local dev server: `import.meta.env.DEV` is false in the built bundle, so this never
 * ships to the PWA or the packaged desktop app, where "stop the server" is not a thing a user
 * can or should do.
 *
 * Confirmed before acting, because the cost of a misclick is the whole app disappearing, and
 * quiet about it otherwise -- this is a utility, not a feature, and it should not compete with
 * the work.
 */
export function StopButton() {
  const [state, setState] = useState<"idle" | "confirming" | "stopping" | "stopped" | "failed">(
    "idle",
  );

  if (!import.meta.env.DEV) return null;

  async function stop() {
    setState("stopping");
    try {
      const res = await fetch("/__shutdown", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setState("stopped");
    } catch {
      // The most likely cause is success: the server stopped before it could answer.
      setState("stopped");
    }
  }

  if (state === "stopped") {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <h2>SchoolQuest has stopped</h2>
        <p className="muted" style={{ margin: 0 }}>
          You can close this tab. Double-click the SchoolQuest shortcut to start it again.
        </p>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
        Could not stop it from here. Close the black SchoolQuest window instead.
      </p>
    );
  }

  if (state === "confirming") {
    return (
      <span className="button-row" style={{ display: "inline-flex", gap: "0.4rem" }}>
        <button className="action" disabled={state !== "confirming"} onClick={() => void stop()}>
          Stop it
        </button>
        <button className="action" onClick={() => setState("idle")}>
          Keep working
        </button>
      </span>
    );
  }

  return (
    <button
      className="action"
      onClick={() => setState("confirming")}
      title="Stops both halves of SchoolQuest running on this machine"
    >
      Stop SchoolQuest
    </button>
  );
}
