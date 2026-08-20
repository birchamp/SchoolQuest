import { useState } from "react";
import { api } from "../lib/api";
import { DayPicker } from "./DayPicker";

/**
 * Enter or edit when a course meets, and save it.
 *
 * One widget, shared by every place that captures meeting times: the Setup screen's per-course
 * editor, the optional entry offered at syllabus upload, and the "when does this class meet?"
 * question in review. Sharing it is the point -- the days a class meets are the same fact
 * wherever they are typed, and they feed the same two things: the hour-by-hour week, and the
 * dating of work stated per class session ("a quiz every class").
 *
 * Saving is a whole-set replace against `PUT /courses/:id/meeting-patterns`, which is what that
 * endpoint does -- the rows shown are the rows the course will have.
 */

/** A stored meeting pattern, as the term snapshot returns it. */
export interface MeetingPatternInit {
  id?: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  location?: string | null;
}

interface Row {
  key: string;
  days: Set<number>;
  startTime: string;
  endTime: string;
  location: string;
}

const fieldStyle = {
  background: "var(--surface-2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "0.45rem 0.6rem",
  font: "inherit",
  fontSize: "0.9rem",
} as const;

function initialRows(patterns: readonly MeetingPatternInit[]): Row[] {
  if (patterns.length > 0) {
    return patterns.map((p, i) => ({
      key: `${p.id ?? i}`,
      days: new Set(p.daysOfWeek),
      startTime: p.startTime,
      endTime: p.endTime,
      location: p.location ?? "",
    }));
  }
  return [{ key: "new", days: new Set<number>([1, 3]), startTime: "09:00", endTime: "10:15", location: "" }];
}

export function MeetingTimesEntry({
  courseId,
  initial = [],
  onSaved,
  onCancel,
  onError,
  intro,
  saveLabel = "Save class times",
}: {
  courseId: string;
  initial?: readonly MeetingPatternInit[];
  /** Called after a successful save. */
  onSaved: () => void;
  /** Optional: shows a Cancel button when provided. */
  onCancel?: () => void;
  /** Optional: route errors to a parent banner. When absent, they show inline here. */
  onError?: (message: string | null) => void;
  /** Optional lead-in sentence above the rows. */
  intro?: string;
  saveLabel?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => initialRows(initial));
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  function report(message: string | null) {
    if (onError) onError(message);
    else setInlineError(message);
  }

  async function save(nextRows: Row[]) {
    const bad = nextRows.find((r) => r.endTime <= r.startTime || r.days.size === 0);
    if (bad) {
      report("Every class needs at least one day and an end after its start.");
      return;
    }
    setBusy(true);
    report(null);
    try {
      await api.put(`/api/courses/${courseId}/meeting-patterns`, {
        patterns: nextRows.map((r) => ({
          daysOfWeek: [...r.days].sort((a, b) => a - b),
          startTime: r.startTime,
          endTime: r.endTime,
          location: r.location.trim() || null,
        })),
      });
      onSaved();
    } catch (e) {
      report(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      {intro && (
        <p className="muted" style={{ margin: "0 0 0.5rem" }}>
          {intro}
        </p>
      )}
      {rows.map((row) => (
        <div key={row.key} style={{ marginBottom: "0.6rem" }}>
          <DayPicker value={row.days} onChange={(days) => patchRow(row.key, { days })} label="Days" />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                From
              </span>
              <input
                style={fieldStyle}
                type="time"
                value={row.startTime}
                onChange={(e) => patchRow(row.key, { startTime: e.target.value })}
              />
            </label>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Until
              </span>
              <input
                style={fieldStyle}
                type="time"
                value={row.endTime}
                onChange={(e) => patchRow(row.key, { endTime: e.target.value })}
              />
            </label>
            <label style={{ display: "grid", gap: "0.2rem", flex: "1 1 8rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Where (optional)
              </span>
              <input
                style={fieldStyle}
                value={row.location}
                placeholder="Science 210"
                onChange={(e) => patchRow(row.key, { location: e.target.value })}
              />
            </label>
            {rows.length > 1 && (
              <button
                className="action"
                disabled={busy}
                onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      {inlineError && <p className="error">{inlineError}</p>}
      <div className="button-row">
        <button className="action primary" disabled={busy} onClick={() => void save(rows)}>
          {busy ? "Saving…" : saveLabel}
        </button>
        <button
          className="action"
          disabled={busy}
          onClick={() =>
            setRows((rs) => [
              ...rs,
              {
                key: `new-${rs.length}`,
                days: new Set<number>([2]),
                startTime: "13:00",
                endTime: "14:15",
                location: "",
              },
            ])
          }
        >
          Another meeting
        </button>
        {onCancel && (
          <button className="action" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
        {initial.length > 0 && (
          <button className="action" disabled={busy} onClick={() => void save([])}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
