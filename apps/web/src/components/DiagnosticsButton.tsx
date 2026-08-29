import { useState } from "react";
import { copyDiagnostics, dumpDiagnostics } from "../lib/diagnostics";
import { supportMailto } from "../lib/support";

/**
 * Reporting a problem, and the log that goes with it.
 *
 * An install can point at any backend, self-hosted included, so the server-side log is on a machine
 * the person debugging cannot reach -- the log has to travel back with the student. "Report a
 * problem" opens their email prefilled to the support address AND copies the last few hundred lines
 * the app kept in memory, so they can paste it in. "Copy diagnostics" is the same log on its own,
 * for anyone who would rather paste it somewhere else. When the clipboard is unavailable (an
 * insecure origin, a locked-down browser) both fall back to a selectable box.
 *
 * Nothing is uploaded. The log goes only where the student pastes or emails it.
 */
export function DiagnosticsButton({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);

  /** Copy the log; on failure reveal it for manual selection. Returns nothing -- state carries it. */
  async function copyLog() {
    if (await copyDiagnostics()) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } else {
      setManual(dumpDiagnostics());
    }
  }

  return (
    <div>
      <div className="button-row">
        {/* A real anchor, so the mailto is handled by the OS mail client in both the browser and the
            desktop shell. The copy is kicked off in the same click gesture (required for clipboard
            permission) and does not block the navigation. */}
        <a className="action primary" href={supportMailto()} onClick={() => void copyLog()}>
          Report a problem
        </a>
        <button className="action" onClick={() => void copyLog()}>
          {copied ? "Copied to clipboard" : "Copy diagnostics"}
        </button>
      </div>
      {!compact && (
        <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.85rem" }}>
          <strong>Report a problem</strong> opens your email with a log attached for you to paste --
          no assignment text, passwords, or personal data, just what the app recently did. Nothing is
          sent until you send the email.
        </p>
      )}
      {manual !== null && (
        <div style={{ marginTop: "0.5rem" }}>
          <p className="muted" style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
            This browser would not let the app reach the clipboard. Select all the text below, copy
            it, and paste it into your email.
          </p>
          <textarea
            readOnly
            value={manual}
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
