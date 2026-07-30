import { useState } from "react";
import { DEFAULT_MEAL_WINDOWS } from "@schoolquest/domain";
import { api } from "../lib/api";
import type { MealWindowView, Term } from "../lib/types";

/**
 * The hours the planner keeps clear for meals.
 *
 * The scheduler holds this time open whether or not the student ever entered a commitment
 * for it, which is the right default — a plan that books straight through every lunch is a
 * plan nobody can follow, and the student least able to notice that in advance is exactly
 * the student this product is for. But a default applied to someone's day without a way to
 * correct it stops being helpful the moment it is wrong, so this is where it is answerable.
 *
 * Three things can be said here, and they are the three things that are actually true of
 * students: I eat at a different hour, I need longer or less, and I do not stop for this one.
 * Removing every window turns the behaviour off completely.
 *
 * A real commitment always outranks all of this. If the student has written down "Lunch,
 * 12:00–12:45", the engine leaves their entry alone and reserves nothing — which is why this
 * card says so rather than letting a reader wonder which of the two is winning.
 */

/** "12:15" -> "12:15 PM", in the reader's own conventions. */
function clock(time: string): string {
  const [h, m] = time.split(":");
  return new Date(Date.UTC(2000, 0, 1, Number(h), Number(m))).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function MealWindows({ term, onChanged }: { term: Term; onChanged: () => void }) {
  const stored = term.planningPreferences?.mealWindows;
  const [windows, setWindows] = useState<MealWindowView[]>(stored ?? DEFAULT_MEAL_WINDOWS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(key: string, patch: Partial<MealWindowView>) {
    setSaved(false);
    setWindows((prev) => prev.map((w) => (w.key === key ? { ...w, ...patch } : w)));
  }

  async function save(next: MealWindowView[]) {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/terms/${term.id}`, { planningPreferences: { mealWindows: next } });
      setWindows(next);
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save. Try again?");
    } finally {
      setSaving(false);
    }
  }

  const dropped = DEFAULT_MEAL_WINDOWS.filter((d) => !windows.some((w) => w.key === d.key));

  return (
    <section className="card">
      <h2>Meals</h2>
      <p className="muted" style={{ margin: "0 0 0.75rem" }}>
        Study time is never booked over these hours. The planner moves a meal earlier or later
        on a day that is tight, and tells you when a day leaves no room for one at all. If you
        have already entered a meal as a commitment, that entry wins and nothing here applies
        to it.
      </p>

      {windows.length === 0 && (
        <p className="muted" style={{ margin: "0 0 0.75rem", fontStyle: "italic" }}>
          Nothing is being held. The planner will use every hour you are available.
        </p>
      )}

      {windows.map((window) => (
        <div
          key={window.key}
          style={{
            display: "flex",
            gap: "0.6rem",
            flexWrap: "wrap",
            alignItems: "flex-end",
            padding: "0.6rem 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ flex: "1 1 6rem", fontWeight: 600, alignSelf: "center" }}>
            {window.label}
          </span>
          <label style={{ display: "grid", gap: "0.2rem" }}>
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Usually at
            </span>
            <input
              type="time"
              value={window.anchor}
              onChange={(e) => update(window.key, { anchor: e.target.value })}
            />
          </label>
          <label style={{ display: "grid", gap: "0.2rem" }}>
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Minutes
            </span>
            <input
              type="number"
              min={5}
              max={180}
              step={5}
              style={{ width: "5.5rem" }}
              value={window.minutes}
              onChange={(e) =>
                update(window.key, { minutes: Math.max(5, Number(e.target.value) || 5) })
              }
            />
          </label>
          <button
            className="action"
            disabled={saving}
            onClick={() => void save(windows.filter((w) => w.key !== window.key))}
          >
            I don&apos;t stop for {window.label.toLowerCase()}
          </button>
        </div>
      ))}

      <p className="muted" style={{ margin: "0.6rem 0", fontSize: "0.82rem" }}>
        {windows.length > 0 && (
          <>
            On a day with class or a shift in the way, each one slides to the nearest free
            time inside its own window —{" "}
            {windows.map((w, i) => (
              <span key={w.key}>
                {i > 0 && (i === windows.length - 1 ? ", and " : ", ")}
                {w.label.toLowerCase()} between {clock(w.earliest)} and {clock(w.latest)}
              </span>
            ))}
            .
          </>
        )}
      </p>

      <div className="button-row">
        <button className="action primary" disabled={saving} onClick={() => void save(windows)}>
          {saving ? "Saving…" : "Save meal times"}
        </button>
        {dropped.length > 0 && (
          <button
            className="action"
            disabled={saving}
            onClick={() =>
              void save(
                [...windows, ...dropped].sort((a, b) => a.anchor.localeCompare(b.anchor)),
              )
            }
          >
            Put back {dropped.map((d) => d.label.toLowerCase()).join(", ")}
          </button>
        )}
      </div>

      {saved && !error && (
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Saved. Your week has been redrawn around them.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
