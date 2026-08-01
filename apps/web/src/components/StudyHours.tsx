import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { DayPicker } from "./DayPicker";

/**
 * The hours the student is actually free to study, editable after setup.
 *
 * These are the single most load-bearing input in the app — every block the scheduler places
 * goes inside one of them — and until now they could only be set during onboarding, in one
 * pass, before the student had lived a single week of the term. A schedule changes: a shift
 * moves, a class is added, a housemate starts working nights. Left uneditable, the plan goes
 * on booking hours that stopped existing weeks ago and the student has no way to say so.
 *
 * Deliberately a small number of broad windows rather than a fine grid. The question is "when
 * are you generally around", not "account for your week in fifteen-minute cells" — and the
 * second question is one nobody answers twice.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Rule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  energyLevel: "low" | "medium" | "high";
  location: "anywhere" | "desk" | "library" | "lab" | "campus" | "quiet";
}

/** A row in the editor: one time window applied to any number of days. */
interface Band {
  key: string;
  days: Set<number>;
  startTime: string;
  endTime: string;
  energyLevel: Rule["energyLevel"];
  location: Rule["location"];
}

/**
 * Rules come back one per day; the editor works in bands so "weekdays 3–9" is one row rather
 * than five. Grouping on the shape of the window is what makes the round trip lossless.
 */
function toBands(rules: Rule[]): Band[] {
  const byShape = new Map<string, Band>();
  for (const rule of rules) {
    const key = `${rule.startTime}-${rule.endTime}-${rule.energyLevel}-${rule.location}`;
    const existing = byShape.get(key);
    if (existing) existing.days.add(rule.dayOfWeek);
    else
      byShape.set(key, {
        key,
        days: new Set([rule.dayOfWeek]),
        startTime: rule.startTime,
        endTime: rule.endTime,
        energyLevel: rule.energyLevel,
        location: rule.location,
      });
  }
  return [...byShape.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function toRules(bands: Band[]): Rule[] {
  return bands.flatMap((band) =>
    [...band.days].sort().map((dayOfWeek) => ({
      dayOfWeek,
      startTime: band.startTime,
      endTime: band.endTime,
      energyLevel: band.energyLevel,
      location: band.location,
    })),
  );
}

function hoursOf(bands: Band[]): number {
  return bands.reduce((sum, band) => {
    const minutes =
      Number(band.endTime.slice(0, 2)) * 60 +
      Number(band.endTime.slice(3, 5)) -
      Number(band.startTime.slice(0, 2)) * 60 -
      Number(band.startTime.slice(3, 5));
    return sum + Math.max(0, minutes) * band.days.size;
  }, 0) / 60;
}

export function StudyHours({ termId, onChanged }: { termId: string; onChanged: () => void }) {
  const [bands, setBands] = useState<Band[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ availabilityRules: Rule[] }>(`/api/terms/${termId}/snapshot`)
      .then((snapshot) => {
        if (live) setBands(toBands(snapshot.availabilityRules));
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Could not load your hours."),
      );
    return () => {
      live = false;
    };
  }, [termId]);

  function update(key: string, patch: Partial<Band>) {
    setSaved(false);
    setBands((prev) => prev?.map((b) => (b.key === key ? { ...b, ...patch } : b)) ?? prev);
  }

  async function save(next: Band[]) {
    const invalid = next.find((b) => b.endTime <= b.startTime || b.days.size === 0);
    if (invalid) {
      setError("Every window needs at least one day and an end after its start.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.put(`/api/terms/${termId}/availability-rules`, { rules: toRules(next) });
      setBands(next);
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setSaving(false);
    }
  }

  if (!bands) {
    return (
      <section className="card">
        <h2>Study hours</h2>
        <p className="muted">{error ?? "Loading your hours…"}</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Study hours</h2>
      <p className="muted" style={{ margin: "0 0 0.75rem" }}>
        The only hours anything is ever scheduled in. Rough is fine — classes, shifts and
        meals are taken out of these automatically, so this is "when am I generally around",
        not a timetable.
      </p>

      {bands.length === 0 && (
        <p className="muted" style={{ fontStyle: "italic", margin: "0 0 0.75rem" }}>
          No hours set, so nothing can be scheduled. Add a window below.
        </p>
      )}

      {bands.map((band) => (
        <div
          key={band.key}
          style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)" }}
        >
          <DayPicker
            value={band.days}
            onChange={(days) => update(band.key, { days })}
            label="Days"
          />
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                From
              </span>
              <input
                type="time"
                value={band.startTime}
                onChange={(e) => update(band.key, { startTime: e.target.value })}
              />
            </label>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Until
              </span>
              <input
                type="time"
                value={band.endTime}
                onChange={(e) => update(band.key, { endTime: e.target.value })}
              />
            </label>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Focus
              </span>
              <select
                value={band.energyLevel}
                onChange={(e) =>
                  update(band.key, { energyLevel: e.target.value as Rule["energyLevel"] })
                }
              >
                <option value="high">Sharpest</option>
                <option value="medium">Ordinary</option>
                <option value="low">Tired</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Where
              </span>
              <select
                value={band.location}
                onChange={(e) =>
                  update(band.key, { location: e.target.value as Rule["location"] })
                }
              >
                <option value="anywhere">Anywhere</option>
                <option value="desk">At a desk</option>
                <option value="library">Library</option>
                <option value="lab">Lab</option>
                <option value="campus">On campus</option>
                <option value="quiet">Somewhere quiet</option>
              </select>
            </label>
            <button
              className="action"
              disabled={saving}
              onClick={() => void save(bands.filter((b) => b.key !== band.key))}
            >
              Remove
            </button>
          </div>
          {/* A window with a location is a promise about where the student will be, and the
              scheduler treats it as scarce on purpose — so it says so rather than leaving the
              student to discover it. */}
          {band.location !== "anywhere" && (
            <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.8rem" }}>
              Only work that needs this place is put here, and meals are never taken out of it.
            </p>
          )}
        </div>
      ))}

      <p className="muted" style={{ margin: "0.7rem 0", fontSize: "0.85rem" }}>
        {hoursOf(bands).toFixed(1)} hours a week before classes, shifts and meals come out of
        them.
      </p>

      <div className="button-row">
        <button className="action primary" disabled={saving} onClick={() => void save(bands)}>
          {saving ? "Saving…" : "Save study hours"}
        </button>
        <button
          className="action"
          disabled={saving}
          onClick={() =>
            setBands([
              ...bands,
              {
                key: `new-${bands.length}-${Date.now()}`,
                days: new Set([1, 2, 3, 4, 5]),
                startTime: "18:00",
                endTime: "21:00",
                energyLevel: "medium",
                location: "anywhere",
              },
            ])
          }
        >
          Add a window
        </button>
      </div>

      {saved && !error && (
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Saved. Your week has been replanned inside these hours.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <p className="sr-only">
        Current windows:{" "}
        {bands
          .map(
            (b) =>
              `${[...b.days].sort().map((d) => DAY_NAMES[d]).join(", ")} ${b.startTime} to ${b.endTime}`,
          )
          .join("; ")}
      </p>
    </section>
  );
}
