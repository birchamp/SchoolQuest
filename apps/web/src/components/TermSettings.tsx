import { useState } from "react";
import { api } from "../lib/api";
import { useBodyTheme } from "../lib/use-body-theme";
import type { Term } from "../lib/types";

/**
 * The term's own settings: its name and its first and last day.
 *
 * Onboarding sets these once and, until now, nothing let a student change them -- a term whose
 * dates were entered wrong, or a name with a typo, was fixed only by starting over. The API always
 * allowed the edit; this is the screen for it. Changing the dates re-plans the weeks around them,
 * so it saves through the same path the calendar does.
 */
const fieldStyle = {
  background: "var(--surface-2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "0.5rem 0.7rem",
  font: "inherit",
} as const;

export function TermSettings({
  term,
  onChanged,
}: {
  term: Term;
  onChanged: () => void | Promise<void>;
}) {
  const quest = useBodyTheme() === "quest";
  const [name, setName] = useState(term.name);
  const [start, setStart] = useState(term.startDate.slice(0, 10));
  const [end, setEnd] = useState(term.endDate.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== term.name ||
    start !== term.startDate.slice(0, 10) ||
    end !== term.endDate.slice(0, 10);

  async function save() {
    if (name.trim().length === 0) {
      setError("The term needs a name.");
      return;
    }
    if (end <= start) {
      setError("The term has to end after it starts.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`/api/terms/${term.id}`, { name: name.trim(), startDate: start, endDate: end });
      setSaved(true);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="term-settings-heading">
      <h2 id="term-settings-heading">{quest ? "The campaign" : "Term"}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Its name, and the first and last day of instruction. Changing the dates re-plans the weeks
        around them.
      </p>
      {error && <p className="error">{error}</p>}
      {saved && <p className="notice">Saved.</p>}
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: "0.2rem", flex: "2 1 12rem" }}>
          <span className="muted" style={{ fontSize: "0.8rem" }}>Name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            placeholder="Fall 2026"
            style={fieldStyle}
          />
        </label>
        <label style={{ display: "grid", gap: "0.2rem" }}>
          <span className="muted" style={{ fontSize: "0.8rem" }}>First day</span>
          <input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setSaved(false);
            }}
            style={fieldStyle}
          />
        </label>
        <label style={{ display: "grid", gap: "0.2rem" }}>
          <span className="muted" style={{ fontSize: "0.8rem" }}>Last day</span>
          <input
            type="date"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setSaved(false);
            }}
            style={fieldStyle}
          />
        </label>
        <button className="action primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
