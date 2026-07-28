import { useState } from "react";
import { api } from "../lib/api";
import { DayPicker, TimeRange } from "./DayPicker";

/**
 * First-run setup: a term, then the study windows the planner may schedule into.
 *
 * Availability is not optional decoration — with no windows the capacity calculation
 * returns nothing and every plan comes back empty, which reads as "the app is broken".
 * So the flow refuses to finish without at least one window, and explains why.
 *
 * Deliberately two small steps rather than one long form. The audience for this product
 * finds long forms costly (docs/01-product-brief.md), and each step has one idea:
 * "when is the semester" then "when can you study".
 */
export function Onboarding({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const [step, setStep] = useState<"term" | "availability">("term");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: term
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [termId, setTermId] = useState<string | null>(null);

  // Step 2: availability. Weekday afternoons/evenings is a sane starting shape for a
  // student with morning classes; everything is editable, nothing is locked in.
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [startTime, setStartTime] = useState("15:00");
  const [endTime, setEndTime] = useState("21:00");

  async function createTerm(e: React.FormEvent) {
    e.preventDefault();
    if (endDate <= startDate) {
      setError("The term has to end after it starts.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { term } = await api.post<{ term: { id: string } }>("/api/terms", {
        name: name.trim(),
        startDate,
        endDate,
      });
      setTermId(term.id);
      setStep("availability");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the term.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAvailability(e: React.FormEvent) {
    e.preventDefault();
    if (days.size === 0) {
      setError("Pick at least one day — the planner can only schedule work inside these windows.");
      return;
    }
    if (endTime <= startTime) {
      setError("The window has to end after it starts.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/terms/${termId}/availability-rules`, {
        rules: [...days].sort().map((dayOfWeek) => ({
          dayOfWeek,
          startTime,
          endTime,
          energyLevel: "medium",
          location: "anywhere",
          hardness: "soft",
        })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your study windows.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: "100%",
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "0.6rem 0.8rem",
    font: "inherit",
    marginBottom: "0.75rem",
  } as const;

  if (step === "term") {
    return (
      <div className="centered" style={{ textAlign: "left", maxWidth: "440px" }}>
        <h1>Set up your semester</h1>
        <p className="muted">
          Start with the term itself. Courses and syllabi come right after.
        </p>

        <form onSubmit={createTerm}>
          <label className="muted" htmlFor="term-name" style={{ fontSize: "0.85rem" }}>
            Term name
          </label>
          <input
            id="term-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fall 2026"
            style={inputStyle}
          />

          <label className="muted" htmlFor="term-start" style={{ fontSize: "0.85rem" }}>
            First day of classes
          </label>
          <input
            id="term-start"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />

          <label className="muted" htmlFor="term-end" style={{ fontSize: "0.85rem" }}>
            Last day of instruction
          </label>
          <input
            id="term-end"
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
          <p className="muted" style={{ marginTop: "-0.4rem", fontSize: "0.82rem" }}>
            Finals week after this date is fine — the planner allows for it.
          </p>

          {error && <p className="error">{error}</p>}

          <div className="button-row">
            <button className="action primary" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Continue"}
            </button>
            <button className="action" type="button" onClick={onSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="centered" style={{ textAlign: "left", maxWidth: "440px" }}>
      <h1>When can you study?</h1>
      <p className="muted">
        The planner only places work inside these windows — this is what makes the plan
        realistic instead of aspirational. Rough is fine; you can refine it any time.
      </p>

      <form onSubmit={saveAvailability}>
        <DayPicker value={days} onChange={setDays} label="Days you can usually study" />
        <TimeRange
          start={startTime}
          end={endTime}
          onStart={setStartTime}
          onEnd={setEndTime}
          label="Between"
        />

        {error && <p className="error">{error}</p>}

        <button className="action primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Finish setup"}
        </button>
      </form>
    </div>
  );
}
