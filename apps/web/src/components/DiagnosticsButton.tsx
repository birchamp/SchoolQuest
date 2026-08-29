import { useState } from "react";
import { copyDiagnostics, dumpDiagnostics } from "../lib/diagnostics";

/**
 * "Copy diagnostics" -- the log's way back to whoever can fix it.
 *
 * An install can point at any backend, self-hosted included, so the server-side log is on a
 * machine the person debugging cannot reach. This copies the last few hundred lines the app kept
 * in memory to the clipboard, for the student to paste into an email. When the clipboard is
 * unavailable (an insecure origin, a locked-down browser) it falls back to a selectable box so
 * the text is still gettable by hand.
 *
 * Nothing is uploaded. The bytes go only where the student pastes them.
 */
export function DiagnosticsButton({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [text, setText] = useState("");

  async function onCopy() {
    if (await copyDiagnostics()) {
      setState("copied");
      window.setTimeout(() => setState("idle"), 2500);
    } else {
      // Reveal the text so it can be selected and copied by hand.
      setText(dumpDiagnostics());
      setState("manual");
    }
  }

  return (
    <div>
      <button className="action" onClick={() => void onCopy()}>
        {state === "copied" ? "Copied to clipboard" : "Copy diagnostics"}
      </button>
      {!compact && (
        <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.85rem" }}>
          Copies a log of what the app recently did -- no assignment text, passwords, or personal
          data -- so you can paste it into an email if you are asked for it. Nothing is sent
          anywhere on its own.
        </p>
      )}
      {state === "manual" && (
        <div style={{ marginTop: "0.5rem" }}>
          <p className="muted" style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
            This browser would not let the app reach the clipboard. Select all the text below and
            copy it by hand.
          </p>
          <textarea
            readOnly
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: "100%",
              minHeight: "8rem",
              font: "0.8rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "0.5rem",
            }}
          />
        </div>
      )}
    </div>
  );
}
