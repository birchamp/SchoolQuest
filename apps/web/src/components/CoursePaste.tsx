import { useState } from "react";
import { label } from "@schoolquest/theme-language";

import { api } from "../lib/api";
import { useBodyTheme } from "../lib/use-body-theme";

/**
 * Adding classes by pasting the list, instead of typing each one in.
 *
 * The form underneath asks for a name, a code, an instructor and then a separate meeting-time
 * row per class. That is the most tedious screen in the app, and every field of it is already
 * on a page the student has open in another tab -- their portal prints the whole term as a
 * table. Worse, it is a gate: a syllabus has nowhere to attach until a course exists, so the
 * tedium sits between a new user and the first thing the app does for them.
 *
 * The calendar already works this way, so this is the pattern rather than a new idea. The same
 * discipline holds behind it: a class whose row is not in the pasted text is discarded, and a
 * meeting time that does not parse is dropped while the class is kept.
 */

interface PasteResult {
  created: { id: string; name: string; code: string | null }[];
  skipped: { name: string; code: string | null; reason: string }[];
  rejected: { name: string; code: string | null; reason: string }[];
  unreadableLines: string[];
  warnings: string[];
  withoutMeetings: string[];
}

const PLACEHOLDER = [
  "BIB199C  Introduction to Biblical Studies  Dr. Reyes    MWF 9:00-9:50am   Hale 204",
  "CCO202   Christian Theology I              Dr. Okafor   TR 2:00-3:15pm    Hale 110",
  "SCI106   Physical Science                  Dr. Nakamura  T 6:00-8:45pm    Lab 3",
].join("\n");

export function CoursePaste({
  termId,
  onChanged,
  /** Rendered as the opening move rather than an alternative, when there are no courses yet. */
  primary = false,
}: {
  termId: string;
  onChanged: () => void;
  primary?: boolean;
}) {
  const theme = useBodyTheme();
  const courseNoun = label("course", theme).toLowerCase();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PasteResult | null>(null);

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.post<PasteResult>(`/api/terms/${termId}/courses/paste`, { text });
      setResult(outcome);
      setText("");
      setOpen(false);
      // Only when something landed: refreshing a plan that did not change churns the screen
      // for no reason, and the report below is the thing worth reading.
      if (outcome.created.length > 0) onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: "0 0 0.9rem" }}>
      {!open && (
        <div className="button-row">
          <button className={`action${primary ? " primary" : ""}`} onClick={() => setOpen(true)}>
            Paste my class list
          </button>
        </div>
      )}

      {open && (
        <div>
          <label htmlFor="course-paste" className="muted" style={{ fontSize: "0.85rem" }}>
            Copy your {courseNoun} list from your school&apos;s portal and paste the whole thing --
            codes, titles, times, rooms. Lines about credits and registration are ignored.
          </label>
          <textarea
            id="course-paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            placeholder={PLACEHOLDER}
            style={{
              width: "100%",
              marginTop: "0.4rem",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--text)",
              font: "inherit",
              fontSize: "0.88rem",
              padding: "0.6rem",
              resize: "vertical",
            }}
          />
          <div className="button-row" style={{ marginTop: "0.5rem" }}>
            <button
              className="action primary"
              disabled={busy || text.trim().length < 10}
              onClick={() => void read()}
            >
              {busy ? "Reading…" : "Read it"}
            </button>
            <button
              className="action"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setText("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="risk" data-level="at_risk" style={{ marginTop: "0.6rem" }}>
          <span className="level">problem</span>
          <span>{error}</span>
        </p>
      )}

      {result && <PasteReport result={result} onDismiss={() => setResult(null)} />}
    </div>
  );
}

/**
 * What happened, including what did not.
 *
 * A silent drop reads as a clean run, and the student has no way to notice the class that never
 * arrived until a plan is missing a quarter of their work.
 */
function PasteReport({ result, onDismiss }: { result: PasteResult; onDismiss: () => void }) {
  const nothing =
    result.created.length === 0 && result.skipped.length === 0 && result.rejected.length === 0;

  return (
    <div style={{ marginTop: "0.7rem" }}>
      {result.created.length > 0 && (
        <div className="risk" data-level="safe">
          <span className="level">added</span>
          <span>
            {result.created.length === 1
              ? "1 class added"
              : `${result.created.length} classes added`}
            : {result.created.map((c) => c.code ?? c.name).join(", ")}.
          </span>
        </div>
      )}

      {nothing && (
        <div className="risk" data-level="watch">
          <span className="level">check</span>
          <span>Nothing in that looked like a class list. Add one by hand below instead.</span>
        </div>
      )}

      {result.withoutMeetings.length > 0 && (
        <div className="risk" data-level="watch" style={{ marginTop: "0.4rem" }}>
          <span className="level">check</span>
          <span>
            No meeting times were printed for {result.withoutMeetings.join(", ")}. Add them below
            so study time is not planned during class.
          </span>
        </div>
      )}

      {result.skipped.length > 0 && (
        <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
          Already here, so left alone: {result.skipped.map((c) => c.code ?? c.name).join(", ")}.
        </p>
      )}

      {result.rejected.length > 0 && (
        <div className="risk" data-level="watch" style={{ marginTop: "0.4rem" }}>
          <span className="level">dropped</span>
          <span>
            {result.rejected.map((c) => `${c.code ?? c.name} (${c.reason})`).join("; ")}
          </span>
        </div>
      )}

      {result.warnings.map((warning) => (
        <p key={warning} className="muted" style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
          {warning}
        </p>
      ))}

      {result.unreadableLines.length > 0 && (
        <details style={{ marginTop: "0.4rem" }}>
          <summary className="muted" style={{ fontSize: "0.85rem", cursor: "pointer" }}>
            {result.unreadableLines.length} line
            {result.unreadableLines.length === 1 ? "" : "s"} could not be read
          </summary>
          <ul className="muted" style={{ fontSize: "0.82rem", margin: "0.3rem 0 0" }}>
            {result.unreadableLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="button-row" style={{ marginTop: "0.5rem" }}>
        <button className="action" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}
