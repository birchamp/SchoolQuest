import { useState } from "react";
import type { ThemeName } from "@schoolquest/domain";
import { api } from "../lib/api";
import { DayPicker, TimeRange } from "./DayPicker";

/**
 * First-run setup: pick a voice for the app, then a term, then the study windows the
 * planner may schedule into.
 *
 * Availability is not optional decoration — with no windows the capacity calculation
 * returns nothing and every plan comes back empty, which reads as "the app is broken".
 * So the flow refuses to finish without at least one window, and explains why.
 *
 * Deliberately small steps rather than one long form. The audience for this product
 * finds long forms costly (docs/01-product-brief.md), and each step has one idea:
 * "how should the app talk", "when is the semester", then "when can you study".
 *
 * The theme choice is first so the rest of onboarding can speak in the chosen voice —
 * quest players get campaign copy immediately; mission/plain copy is untouched.
 */

const THEME_CHOICES: { id: ThemeName; title: string; description: string }[] = [
  { id: "quest", title: "Quest", description: "A campaign journal: quests, XP, the fog of future" },
  { id: "mission", title: "Mission", description: "Clean ops-room language" },
  { id: "plain", title: "Plain", description: "Just a calm planner" },
];

export function Onboarding({
  onDone,
  onSignOut,
  theme,
  onThemeChange,
}: {
  onDone: () => void;
  onSignOut: () => void;
  theme?: ThemeName;
  onThemeChange?: (t: ThemeName) => void;
}) {
  const [step, setStep] = useState<"theme" | "term" | "availability">("theme");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The picker highlights nothing until the student actually chooses — the theme prop
  // may carry a server-side default that was never an intentional choice.
  const [chosenTheme, setChosenTheme] = useState<ThemeName | undefined>(undefined);
  const quest = theme === "quest";

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

  async function chooseTheme(t: ThemeName) {
    setBusy(true);
    setError(null);
    try {
      await api.patch("/api/me", { theme: t });
      setChosenTheme(t);
      onThemeChange?.(t);
      setStep("term");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your theme.");
    } finally {
      setBusy(false);
    }
  }

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

  if (step === "theme") {
    return (
      <div className="centered" style={{ textAlign: "left", maxWidth: "440px" }}>
        <h1>Choose your adventure</h1>
        <p className="muted">
          How should SchoolQuest talk to you? Wording only — your courses, assignments,
          and plan are the same underneath, and you can change this any time.
        </p>

        <div role="group" aria-label="Choose a theme">
          {THEME_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              disabled={busy}
              aria-pressed={chosenTheme === choice.id}
              onClick={() => void chooseTheme(choice.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "var(--surface)",
                color: "var(--text)",
                border:
                  chosenTheme === choice.id
                    ? "2px solid var(--accent, currentColor)"
                    : "1px solid var(--border)",
                borderRadius: "10px",
                padding: "0.8rem 1rem",
                marginBottom: "0.75rem",
                font: "inherit",
                cursor: busy ? "default" : "pointer",
              }}
            >
              <span style={{ display: "block", fontWeight: 700, marginBottom: "0.2rem" }}>
                {choice.title}
              </span>
              <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                {choice.description}
              </span>
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="button-row">
          <button className="action" type="button" onClick={onSignOut} disabled={busy}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (step === "term") {
    return (
      <div className="centered" style={{ textAlign: "left", maxWidth: "440px" }}>
        <h1>{quest ? "Found your campaign" : "Set up your semester"}</h1>
        <p className="muted">
          {quest
            ? "Every campaign needs a map. Name the season and mark its borders."
            : "Start with the term itself. Courses and syllabi come right after."}
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
      <h1>{quest ? "When does your party adventure?" : "When can you study?"}</h1>
      <p className="muted">
        {quest
          ? "The planner only schedules quests inside these windows — that is what keeps the campaign honest."
          : "The planner only places work inside these windows — this is what makes the plan realistic instead of aspirational. Rough is fine; you can refine it any time."}
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
