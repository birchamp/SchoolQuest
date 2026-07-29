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

/**
 * Each picker card previews its own theme, so the choice is shown, not described:
 * Quest is parchment-and-ink, Mission is slate-and-steel, Plain stays the app's
 * neutral surface. Text (title + description) carries the meaning — the styling is
 * reinforcement, never the only signal.
 */
const THEME_PREVIEWS: Record<
  ThemeName,
  { card: React.CSSProperties; description: React.CSSProperties }
> = {
  quest: {
    card: {
      background: "#efe3c8",
      color: "#2a1f14",
      border: "1px solid #9b7c3c",
      // A double rule drawn just inside the edge — the frame of a manuscript page.
      outline: "3px double rgba(138, 111, 31, 0.65)",
      outlineOffset: "-6px",
      fontFamily: '"Iowan Old Style", Palatino, Georgia, serif',
    },
    description: { color: "#6b5636" },
  },
  mission: {
    card: {
      background: "#1a2027",
      color: "#c6d4e2",
      border: "1px solid #35506b",
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
    },
    description: { color: "#7d93a8" },
  },
  plain: {
    card: {
      background: "var(--surface)",
      color: "var(--text)",
      border: "1px solid var(--border)",
    },
    description: {},
  },
};

/* --- The campaign chart (quest only) ---------------------------------------
 *
 * QUEST-THEME-LEDGER's backlog asks for "campaign-map onboarding: courses as
 * regions revealed as they are added". Onboarding charters the campaign — it
 * collects the term and the study windows; courses are added afterwards in
 * Setup — so what belongs here is the *legend* of that map, not the map: a
 * chart panel whose entries ink themselves in as the student fills the form,
 * with the regions line left deliberately blank as the part still unexplored.
 *
 * A legend rather than a drawn coastline is a deliberate choice: a hand-drawn
 * map faked out of CSS boxes looks cheap at any size, while a legend is exactly
 * the kind of object a real campaign book prints — and it can carry live data.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-08-26" -> { day: "Aug 26", year: "2026" }; null while the field is empty. */
function readDate(iso: string): { day: string; year: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return { day: `${month} ${Number(m[3])}`, year: m[1]! };
}

/** The season line of the chart. Partial dates still say something true. */
function formatSeason(startDate: string, endDate: string): string | null {
  const from = readDate(startDate);
  const to = readDate(endDate);
  if (from && to) {
    return from.year === to.year
      ? `${from.day} – ${to.day}, ${to.year}`
      : `${from.day}, ${from.year} – ${to.day}, ${to.year}`;
  }
  if (from) return `Opens ${from.day}, ${from.year}`;
  if (to) return `Closes ${to.day}, ${to.year}`;
  return null;
}

/** "15:00" -> "3 pm" / "15:30" -> "3:30 pm", matching how the pickers read. */
function formatClock(value: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return value;
  const hour = Number(m[1]);
  const suffix = hour < 12 ? "am" : "pm";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return m[2] === "00" ? `${hour12} ${suffix}` : `${hour12}:${m[2]} ${suffix}`;
}

function formatDays(days: Set<number>): string | null {
  const ordered = [...days].sort((a, b) => a - b);
  if (ordered.length === 0) return null;
  if (ordered.length === 7) return "Every day";
  if (ordered.length === 5 && ordered.every((d) => d >= 1 && d <= 5)) return "Weekdays";
  if (ordered.length === 2 && days.has(0) && days.has(6)) return "Weekends";
  // Comma-joined rather than a typographic dot: this string is read aloud as-is,
  // and "Mon dot Wed" is not plain language.
  return ordered.map((d) => DAY_ABBR[d]).join(", ");
}

type ChartEntry = {
  /** Decorative map mark; always aria-hidden. */
  mark: string;
  /** Themed caption, decorative — the screen reader gets `srLabel` instead. */
  label: string;
  /** Plain-language name of the same thing, for assistive tech. */
  srLabel: string;
  /** Filled value, or null while that part of the chart is still blank. */
  value: string | null;
  /** What the blank says. Never a scolding — a blank is just unexplored. */
  pending: string;
};

const GOLD = "var(--q-gold, #c9a227)";
const GOLD_BRIGHT = "var(--q-gold-bright, #e8c95a)";
/** Ink colours picked against the panel's #2b2013 → #16100b ground (> 4.5:1). */
const CHART_PARCHMENT = "#f1e6ca";
const CHART_FADED = "#a8946b";
const CHART_CAPTION = "#c0ad83";

function CampaignChart({ entries }: { entries: ChartEntry[] }) {
  return (
    <aside
      aria-label="Campaign summary"
      style={{
        flex: "1 1 15rem",
        minWidth: 0,
        alignSelf: "flex-start",
        position: "relative",
        borderRadius: "6px",
        border: "1px solid rgba(201, 162, 39, 0.42)",
        outline: "1px solid rgba(201, 162, 39, 0.16)",
        outlineOffset: "-6px",
        padding: "1.05rem 1.1rem 0.95rem",
        background:
          "radial-gradient(ellipse at 72% -10%, rgba(201, 162, 39, 0.12), transparent 62%)," +
          "repeating-linear-gradient(115deg, rgba(0, 0, 0, 0.16) 0 2px, transparent 2px 6px)," +
          "linear-gradient(165deg, #2b2013, #16100b 72%)",
        boxShadow: "inset 0 0 34px rgba(0, 0, 0, 0.55), 0 3px 14px rgba(0, 0, 0, 0.45)",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: GOLD,
        }}
      >
        <span aria-hidden="true" style={{ marginRight: "0.45rem" }}>
          ❖
        </span>
        Campaign chart
      </p>
      <div
        aria-hidden="true"
        style={{
          height: "1px",
          margin: "0.6rem 0 0.95rem",
          background: "linear-gradient(90deg, rgba(201, 162, 39, 0.65), rgba(201, 162, 39, 0.04))",
        }}
      />

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {entries.map((entry, index) => {
          const filled = entry.value !== null;
          const last = index === entries.length - 1;
          return (
            <li
              key={entry.srLabel}
              style={{
                display: "flex",
                gap: "0.65rem",
                alignItems: "baseline",
                paddingBottom: last ? 0 : "0.7rem",
                marginBottom: last ? 0 : "0.7rem",
                borderBottom: last ? undefined : "1px dashed rgba(201, 162, 39, 0.2)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 1rem",
                  textAlign: "center",
                  fontSize: "0.8rem",
                  lineHeight: 1.4,
                  color: filled ? GOLD_BRIGHT : "rgba(201, 162, 39, 0.45)",
                  textShadow: filled ? "0 0 10px rgba(201, 162, 39, 0.5)" : undefined,
                }}
              >
                {filled ? entry.mark : "◇"}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="sr-only">{entry.srLabel}: </span>
                <span
                  aria-hidden="true"
                  style={{
                    display: "block",
                    fontSize: "0.62rem",
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: CHART_CAPTION,
                    marginBottom: "0.15rem",
                  }}
                >
                  {entry.label}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: filled ? "0.95rem" : "0.84rem",
                    lineHeight: 1.35,
                    color: filled ? CHART_PARCHMENT : CHART_FADED,
                    fontStyle: filled ? undefined : "italic",
                    overflowWrap: "anywhere",
                  }}
                >
                  {filled ? entry.value : entry.pending}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p
        style={{
          margin: "0.95rem 0 0",
          paddingTop: "0.7rem",
          borderTop: "1px dashed rgba(201, 162, 39, 0.22)",
          fontSize: "0.72rem",
          lineHeight: 1.45,
          color: CHART_FADED,
        }}
      >
        <span aria-hidden="true" style={{ marginRight: "0.4rem", color: GOLD }}>
          ✧
        </span>
        Each course you add later takes its place here as a region.
      </p>
    </aside>
  );
}

/** Form on the left, chart on the right; wraps to one column on narrow screens. */
const splitLayout: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "1.35rem",
  alignItems: "flex-start",
};

/**
 * Quest-only step marker. The diamonds are decoration; the words stay plain, so
 * "Step 1 of 2" is what assistive tech announces.
 */
function StepMark({ step }: { step: 1 | 2 }) {
  return (
    <p
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.55rem",
        margin: "0 0 0.4rem",
        fontSize: "0.68rem",
        fontWeight: 700,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: CHART_CAPTION,
      }}
    >
      <span aria-hidden="true" style={{ color: GOLD_BRIGHT, letterSpacing: "0.3em" }}>
        {step === 1 ? "◆◇" : "◇◆"}
      </span>
      <span>
        <span aria-hidden="true">Charter · </span>Step {step} of 2
      </span>
    </p>
  );
}

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

  // Hover/focus tracking so the gold selection ring can be drawn with inline styles
  // (no stylesheet edits available to this component).
  const [hoveredTheme, setHoveredTheme] = useState<ThemeName | null>(null);
  const [focusedTheme, setFocusedTheme] = useState<ThemeName | null>(null);
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
      <div className="centered book-cover" style={{ textAlign: "left", maxWidth: "460px" }}>
        <p className="book-cover-kicker" aria-hidden="true">
          ⚜
        </p>
        <h1 className="book-cover-title">Choose your adventure</h1>
        <p className="book-cover-sub">
          This only changes how SchoolQuest speaks and looks. Your real courses, dates,
          and grades stay exactly what they are.
        </p>

        {/* A caption over the set: three cards under one heading read as one
            choice, which is half of what keeps the sign-out below from looking
            like a fourth option. */}
        <p
          aria-hidden="true"
          style={{
            margin: "0 0 0.6rem",
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#b9a67f",
          }}
        >
          Three voices
        </p>

        <div role="group" aria-label="Choose a theme">
          {THEME_CHOICES.map((choice) => {
            const preview = THEME_PREVIEWS[choice.id];
            const focused = focusedTheme === choice.id;
            const ringed =
              focused || hoveredTheme === choice.id || chosenTheme === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                disabled={busy}
                aria-pressed={chosenTheme === choice.id}
                onClick={() => void chooseTheme(choice.id)}
                onMouseEnter={() => setHoveredTheme(choice.id)}
                onMouseLeave={() =>
                  setHoveredTheme((h) => (h === choice.id ? null : h))
                }
                onFocus={() => setFocusedTheme(choice.id)}
                onBlur={() => setFocusedTheme((f) => (f === choice.id ? null : f))}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  borderRadius: "10px",
                  padding: "0.8rem 1rem",
                  marginBottom: "0.75rem",
                  font: "inherit",
                  cursor: busy ? "default" : "pointer",
                  boxShadow: ringed ? "0 0 0 2px #c9a227" : undefined,
                  ...preview.card,
                  // While focused, yield the outline back to the global
                  // :focus-visible ring — the quest card's decorative double
                  // outline must never mask keyboard focus.
                  ...(focused ? { outline: undefined, outlineOffset: undefined } : null),
                }}
              >
                <span style={{ display: "block", fontWeight: 700, marginBottom: "0.2rem" }}>
                  {choice.id === "quest" && (
                    <span aria-hidden="true" style={{ color: "#c9a227", marginRight: "0.35rem" }}>
                      ⚜
                    </span>
                  )}
                  {choice.title}
                </span>
                <span
                  className={choice.id === "plain" ? "muted" : undefined}
                  style={{ display: "block", fontSize: "0.85rem", ...preview.description }}
                >
                  {choice.description}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="error">{error}</p>}

        {/* Ledger nit: "Sign out" sat close enough to the three cards to read as
            a fourth option. It is now below an ornamental rule, in a smaller
            account-level row, right-aligned away from the full-width cards —
            same control, same accessible name, unmistakably not a theme. */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.7rem",
            margin: "2rem 0 1rem",
          }}
        >
          <span
            style={{
              flex: 1,
              height: "1px",
              background: "linear-gradient(90deg, transparent, rgba(201, 162, 39, 0.5))",
            }}
          />
          <span style={{ color: "rgba(201, 162, 39, 0.75)", fontSize: "0.7rem", lineHeight: 1 }}>
            ◆
          </span>
          <span
            style={{
              flex: 1,
              height: "1px",
              background: "linear-gradient(90deg, rgba(201, 162, 39, 0.5), transparent)",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#9c8a63" }}>
            Signed in on this device.
          </p>
          <button
            className="action"
            type="button"
            onClick={onSignOut}
            disabled={busy}
            style={{ fontSize: "0.85rem", padding: "0.4rem 0.85rem" }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (step === "term") {
    const termForm = (
      <div className="card" style={quest ? { marginBottom: 0 } : undefined}>
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
              {busy ? "Creating…" : quest ? "Charter it" : "Continue"}
            </button>
            <button className="action" type="button" onClick={onSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
        </form>
      </div>
    );

    return (
      <div
        className="centered"
        style={{ textAlign: "left", maxWidth: quest ? "820px" : "440px" }}
      >
        {quest && <StepMark step={1} />}
        <h1>{quest ? "Charter your campaign" : "Set up your semester"}</h1>
        <p className="muted">
          {quest
            ? "Name the campaign and mark the season it runs. Its regions — your courses — are charted after setup."
            : "Start with the term itself. Courses and syllabi come right after."}
        </p>

        {/* The form panel is a .card so quest onboarding writes on parchment, not a
            bare form on leather; in mission/plain the card is just a subtle surface.
            Under quest it is paired with the chart, which fills in as it is filled. */}
        {quest ? (
          <div style={splitLayout}>
            <div style={{ flex: "1 1 21rem", minWidth: 0 }}>{termForm}</div>
            <CampaignChart
              entries={[
                {
                  mark: "⚜",
                  label: "Campaign",
                  srLabel: "Term name",
                  value: name.trim() || null,
                  pending: "Unnamed",
                },
                {
                  mark: "✦",
                  label: "Season",
                  srLabel: "Term dates",
                  value: formatSeason(startDate, endDate),
                  pending: "Borders unmarked",
                },
                {
                  mark: "⚑",
                  label: "Marching hours",
                  srLabel: "Study windows",
                  value: null,
                  pending: "Set in the next step",
                },
                {
                  mark: "◈",
                  label: "Regions",
                  srLabel: "Courses",
                  value: null,
                  pending: "Unexplored — added after setup",
                },
              ]}
            />
          </div>
        ) : (
          termForm
        )}
      </div>
    );
  }

  const dayLine = formatDays(days);
  const hoursLine =
    dayLine && endTime > startTime
      ? `${dayLine}, ${formatClock(startTime)} – ${formatClock(endTime)}`
      : null;

  const availabilityForm = (
    <div className="card" style={quest ? { marginBottom: 0 } : undefined}>
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

  return (
    <div
      className="centered"
      style={{ textAlign: "left", maxWidth: quest ? "820px" : "440px" }}
    >
      {quest && <StepMark step={2} />}
      <h1>{quest ? "When does your party march?" : "When can you study?"}</h1>
      <p className="muted">
        {quest
          ? "The planner only schedules quests inside these windows — that is what keeps the campaign honest."
          : "The planner only places work inside these windows — this is what makes the plan realistic instead of aspirational. Rough is fine; you can refine it any time."}
      </p>

      {/* Same .card panel as the term step: parchment under quest, quiet surface
          under mission/plain. The chart now carries the term the student just
          chartered, so the last step is visibly the last blank being inked in. */}
      {quest ? (
        <div style={splitLayout}>
          <div style={{ flex: "1 1 21rem", minWidth: 0 }}>{availabilityForm}</div>
          <CampaignChart
            entries={[
              {
                mark: "⚜",
                label: "Campaign",
                srLabel: "Term name",
                value: name.trim() || null,
                pending: "Unnamed",
              },
              {
                mark: "✦",
                label: "Season",
                srLabel: "Term dates",
                value: formatSeason(startDate, endDate),
                pending: "Borders unmarked",
              },
              {
                mark: "⚑",
                label: "Marching hours",
                srLabel: "Study windows",
                value: hoursLine,
                pending: "No days marked yet",
              },
              {
                mark: "◈",
                label: "Regions",
                srLabel: "Courses",
                value: null,
                pending: "Unexplored — added after setup",
              },
            ]}
          />
        </div>
      ) : (
        availabilityForm
      )}
    </div>
  );
}
