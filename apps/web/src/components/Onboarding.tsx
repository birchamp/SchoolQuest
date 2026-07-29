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

/* --- Taming the native date/time controls (quest only) ----------------------
 *
 * The critic's headline defect: two `input[type=date]` and two `input[type=time]`
 * shipped their OS chrome straight through the parchment — the grey `mm/dd/yyyy`
 * placeholder, the black calendar/clock glyph, and worst of all a *system-blue*
 * highlight on the focused date segment, the single most saturated pixel on a
 * screen otherwise made of gold, oxblood and cream.
 *
 * Replacing them with hand-rolled comboboxes was rejected: a bespoke date control
 * loses segment-by-segment keyboard entry, `required` validation, the mobile
 * native picker and the locale-correct field order — a themed control that is
 * worse to use than the native one is not an improvement. So the native inputs
 * stay, and every styleable part of them is re-inked:
 *
 *   - `::-webkit-calendar-picker-indicator` is repainted with a data-URI SVG
 *     drawn in gold-dim ink, so the affordance stays a calendar / a clock but in
 *     the palette (4.6:1 against the cream field — a UI glyph needs 3:1).
 *   - the OS blue. `::-webkit-datetime-edit-<x>-field:focus` is not a selector
 *     Chromium will parse from an author sheet (measured: the rule never lands),
 *     and `::selection` does not reach the shadow text either. What does work is
 *     `input:focus::-webkit-datetime-edit-<x>-field { background-color: transparent }`:
 *     an author background beats the UA's `background-color: highlight`, so the
 *     blue chip disappears — while the UA's matching `color: highlighttext` is
 *     left *undeclared* and therefore survives, which is what still marks the
 *     segment you are editing. The whole value then sits on a leather ribbon
 *     (`:focus::-webkit-datetime-edit`) with the live segment reading bright and
 *     the rest in parchment. Nothing is lost: the segment cursor is still shown,
 *     it is simply shown in the palette. Measured on the ribbon: parchment 9.3:1,
 *     the live segment 13.6:1, the separators 5.7:1.
 *   - the resting `mm/dd/yyyy` is hidden and replaced by the chart's own voice
 *     ("Not yet marked"). It comes straight back the moment the field is focused,
 *     so nobody ever has to guess the entry format while typing.
 *   - `::selection` is themed to gold, which catches the term-name field too.
 *
 * None of that is expressible as an inline style attribute, and styles.css is not
 * this component's to edit, so the rules ride in a `<style>` element rendered by
 * the quest branch only — gated exactly like every other piece of quest chrome,
 * and scoped under `.sq-quest-onboarding` so it cannot leak into another screen.
 * Nothing here is loaded from the network: the two icons are data-URI SVG (CSP).
 */

const CAL_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'" +
  " fill='none' stroke='%238a6f1f' stroke-width='1.3'%3E%3Crect x='1.7' y='3.3' width='12.6'" +
  " height='11' rx='1'/%3E%3Cpath d='M1.7 6.7h12.6M5 1.7v3M11 1.7v3'/%3E%3Cpath" +
  " d='M8 8.7l1.5 1.7L8 12.1l-1.5-1.7z' fill='%238a6f1f' stroke='none'/%3E%3C/svg%3E\")";

const CLOCK_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'" +
  " fill='none' stroke='%238a6f1f' stroke-width='1.3'%3E%3Ccircle cx='8' cy='8' r='6.2'/%3E" +
  "%3Cpath d='M8 4.2V8l2.7 1.9' stroke-linecap='round'/%3E%3C/svg%3E\")";

const QUEST_FIELD_CSS = `
.sq-quest-onboarding ::selection { background-color: #c9a227; color: #241a10; }

.sq-quest-onboarding input[type="date"],
.sq-quest-onboarding input[type="time"] {
  color-scheme: light;
  font-variant-numeric: tabular-nums;
}

.sq-quest-onboarding input[type="date"]::-webkit-calendar-picker-indicator,
.sq-quest-onboarding input[type="time"]::-webkit-calendar-picker-indicator {
  opacity: 1;
  cursor: pointer;
  width: 1rem;
  height: 1rem;
  padding: 0;
  margin: 0 0 0 0.4rem;
  border-radius: 3px;
  background-color: transparent;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}
.sq-quest-onboarding input[type="date"]::-webkit-calendar-picker-indicator {
  background-image: ${CAL_ICON};
}
.sq-quest-onboarding input[type="time"]::-webkit-calendar-picker-indicator {
  background-image: ${CLOCK_ICON};
}
.sq-quest-onboarding input[type="date"]::-webkit-calendar-picker-indicator:hover,
.sq-quest-onboarding input[type="time"]::-webkit-calendar-picker-indicator:hover {
  background-color: rgba(201, 162, 39, 0.22);
}

/* Resting: ink on cream, exactly like every other field on the card. The 0.2em
   inset is carried in both states so the value never shifts when the ribbon
   appears; the inputs give it back out of their own padding-left. */
.sq-quest-onboarding input[type="date"]::-webkit-datetime-edit,
.sq-quest-onboarding input[type="time"]::-webkit-datetime-edit {
  color: #2a1f14;
  padding: 0 0.2em;
  border-radius: 3px;
}
.sq-quest-onboarding input[type="date"]::-webkit-datetime-edit-text,
.sq-quest-onboarding input[type="time"]::-webkit-datetime-edit-text {
  color: #6b5636;
}

/* Editing: the value is laid on a strip of the same leather the buttons are cut
   from, so nothing on the screen is outside the palette. */
.sq-quest-onboarding input[type="date"]:focus::-webkit-datetime-edit,
.sq-quest-onboarding input[type="time"]:focus::-webkit-datetime-edit {
  background-color: #3a2b19;
  color: #e4d4b0;
}
.sq-quest-onboarding input[type="date"]:focus::-webkit-datetime-edit-text,
.sq-quest-onboarding input[type="time"]:focus::-webkit-datetime-edit-text {
  color: #c9a227;
}
/* Clears the UA's blue chip while leaving its text colour alone — that inherited
   highlighttext colour is what still marks the segment under the cursor. */
.sq-quest-onboarding input:focus::-webkit-datetime-edit-year-field,
.sq-quest-onboarding input:focus::-webkit-datetime-edit-month-field,
.sq-quest-onboarding input:focus::-webkit-datetime-edit-day-field,
.sq-quest-onboarding input:focus::-webkit-datetime-edit-hour-field,
.sq-quest-onboarding input:focus::-webkit-datetime-edit-minute-field,
.sq-quest-onboarding input:focus::-webkit-datetime-edit-ampm-field {
  background-color: transparent;
}

/* Resting state only: React drops the class the instant the field takes focus,
   so the real mm/dd/yyyy guides are always there while you are typing. */
.sq-quest-onboarding input.sq-q-blank::-webkit-datetime-edit,
.sq-quest-onboarding input.sq-q-blank::-webkit-datetime-edit-text,
.sq-quest-onboarding input.sq-q-blank::-webkit-datetime-edit-year-field,
.sq-quest-onboarding input.sq-q-blank::-webkit-datetime-edit-month-field,
.sq-quest-onboarding input.sq-q-blank::-webkit-datetime-edit-day-field {
  color: transparent;
}

/* Seven day chips, seven columns. They used to wrap 6+1 and orphan "Sat". */
.sq-quest-days fieldset .button-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.4rem;
}
@media (max-width: 34rem) {
  .sq-quest-days fieldset .button-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
`;

/** Quest-only stylesheet for the parts of a native control no inline style reaches. */
function QuestFieldStyles() {
  return <style>{QUEST_FIELD_CSS}</style>;
}

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
        // Stretches to the form's height instead of stopping 45px short of it —
        // the near-miss the critic read as sloppy. The footnote below is pinned
        // to the panel's foot so the extra height lands as margin, not as a gap.
        flex: "1 1 20rem",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
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

      <ul style={{ listStyle: "none", margin: "0 0 0.95rem", padding: 0 }}>
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
          // `auto` top margin pins the footnote to the foot of the panel when the
          // chart is stretched taller than its own contents.
          margin: "auto 0 0",
          paddingTop: "0.9rem",
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

/**
 * Form on the left, chart on the right; wraps to one column on narrow screens.
 * `stretch` rather than `flex-start`: the two panels are meant to read as facing
 * pages, and facing pages share a bottom edge.
 */
const splitLayout: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "1.35rem",
  alignItems: "stretch",
};

/** The form column. Wide enough that seven day chips sit on one line. */
const formColumn: React.CSSProperties = {
  flex: "1 1 30rem",
  minWidth: 0,
  display: "flex",
};

/**
 * The parchment panel and its form fill the column, so whichever of the two
 * panels is shorter grows to meet the other's bottom edge, and the buttons ride
 * at the foot of the page rather than floating in the middle of it.
 */
const cardPanel: React.CSSProperties = {
  marginBottom: 0,
  flex: 1,
  width: "100%",
  display: "flex",
  flexDirection: "column",
};

const panelForm: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
};

const panelFoot: React.CSSProperties = { marginTop: "auto", paddingTop: "0.6rem" };

/**
 * Vertically centres the step in the viewport instead of pinning it to the top —
 * the steps used to sit in the top-left corner of a 1280×1008 canvas with 40% of
 * it left as bare leather below. `safe center` so a short window falls back to
 * top-aligned rather than pushing the heading off the top edge.
 */
const questPage: React.CSSProperties = {
  margin: "0 auto",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  justifyContent: "safe center",
  paddingTop: "2.5rem",
  paddingBottom: "2.5rem",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  background: "var(--surface)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "0.6rem 0.8rem",
  font: "inherit",
  marginBottom: "0.75rem",
};

/**
 * A native `input[type=date]` with its label. Under quest the resting placeholder
 * is the chart's own phrase rather than the OS `mm/dd/yyyy`; the real segmented
 * field returns on focus, so typing, tabbing between segments, arrow-key
 * stepping, `required` validation and the value the form posts are all untouched.
 * Under mission/plain the control is exactly the browser default, as before.
 */
function DateField({
  id,
  label,
  value,
  onChange,
  quest,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  quest: boolean;
  hint: string;
}) {
  const [focused, setFocused] = useState(false);

  const labelNode = (
    <label className="muted" htmlFor={id} style={{ fontSize: "0.85rem" }}>
      {label}
    </label>
  );

  if (!quest) {
    return (
      <>
        {labelNode}
        <input
          id={id}
          type="date"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={INPUT_STYLE}
        />
      </>
    );
  }

  const blank = value === "" && !focused;
  return (
    <>
      {labelNode}
      <div style={{ position: "relative", margin: "0.75rem 0" }}>
        <input
          id={id}
          type="date"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={blank ? "sq-q-blank" : undefined}
          style={{
            ...INPUT_STYLE,
            display: "block",
            margin: 0,
            // Gives back the 0.2em the leather ribbon takes, so the date starts on
            // the same vertical as the term name above it.
            paddingLeft: "calc(0.8rem - 0.2em)",
          }}
        />
        {blank && (
          // Decorative stand-in only — the field keeps its own <label>, so this is
          // never part of the accessible name.
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              paddingLeft: "calc(0.8rem + 1px)",
              paddingRight: "2.4rem",
              pointerEvents: "none",
              // #6b5636 on the card's #fffaee field: 6.7:1.
              color: "#6b5636",
              fontStyle: "italic",
            }}
          >
            {hint}
          </span>
        )}
      </div>
    </>
  );
}

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

  const inputStyle = INPUT_STYLE;

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
      <div
        className="card"
        style={quest ? cardPanel : undefined}
      >
        <form onSubmit={createTerm} style={quest ? panelForm : undefined}>
          <div>
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

            <DateField
              id="term-start"
              label="First day of classes"
              value={startDate}
              onChange={setStartDate}
              quest={quest}
              hint="Not yet marked"
            />
            <DateField
              id="term-end"
              label="Last day of instruction"
              value={endDate}
              onChange={setEndDate}
              quest={quest}
              hint="Not yet marked"
            />
            <p className="muted" style={{ marginTop: "-0.4rem", fontSize: "0.82rem" }}>
              Finals week after this date is fine — the planner allows for it.
            </p>

            {error && <p className="error">{error}</p>}
          </div>

          <div className="button-row" style={quest ? panelFoot : undefined}>
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
        className={quest ? "centered sq-quest-onboarding" : "centered"}
        style={{
          textAlign: "left",
          maxWidth: quest ? "980px" : "440px",
          ...(quest ? questPage : null),
        }}
      >
        {quest && <QuestFieldStyles />}
        <div>
          {quest && <StepMark step={1} />}
          <h1>{quest ? "Charter your campaign" : "Set up your semester"}</h1>
          <p className="muted">
            {quest
              ? "Name the campaign and mark the season it runs. Its regions — your courses — are charted after setup."
              : "Start with the term itself. Courses and syllabi come right after."}
          </p>
        </div>

        {/* The form panel is a .card so quest onboarding writes on parchment, not a
            bare form on leather; in mission/plain the card is just a subtle surface.
            Under quest it is paired with the chart, which fills in as it is filled. */}
        {quest ? (
          <div style={splitLayout}>
            <div style={formColumn}>{termForm}</div>
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
                  // Not ⚑: that one resolves to a colour-emoji flag in this font
                  // stack and lands as the only saturated orange on the screen.
                  mark: "◈",
                  label: "Marching hours",
                  srLabel: "Study windows",
                  value: null,
                  pending: "Set in the next step",
                },
                {
                  // ◆ is ◇ inked in — the hollow pending mark filled solid.
                  mark: "◆",
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
    <div className="card" style={quest ? cardPanel : undefined}>
      <form onSubmit={saveAvailability} style={quest ? panelForm : undefined}>
        <div>
          <DayPicker value={days} onChange={setDays} label="Days you can usually study" />
          <TimeRange
            start={startTime}
            end={endTime}
            onStart={setStartTime}
            onEnd={setEndTime}
            label="Between"
          />

          {/* Plain and mission carry this reassurance in the paragraph above the
              card; the quest copy had dropped it, which left the last step of the
              flow reading as a commitment rather than a first draft. */}
          {quest && (
            <p
              className="muted"
              style={{
                margin: "0.9rem 0 0",
                paddingTop: "0.75rem",
                borderTop: "1px dashed rgba(138, 111, 31, 0.45)",
                fontSize: "0.84rem",
                fontStyle: "italic",
              }}
            >
              <span aria-hidden="true" style={{ marginRight: "0.4rem", color: "#8a6f1f" }}>
                ✧
              </span>
              Rough is fine. These hours can be redrawn from Setup whenever the campaign
              changes — the planner simply re-lays the quests inside whatever windows it
              is given.
            </p>
          )}

          {error && <p className="error">{error}</p>}
        </div>

        {/* The last button of the flow used to say "Finish setup" in a screen whose
            other buttons say "Charter it" — admin language at the one moment the
            campaign actually begins. Plain and mission keep the plain wording. */}
        <div style={quest ? panelFoot : undefined}>
          <button className="action primary" type="submit" disabled={busy}>
            {busy
              ? quest
                ? "Sealing…"
                : "Saving…"
              : quest
                ? "Begin the campaign"
                : "Finish setup"}
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <div
      className={quest ? "centered sq-quest-onboarding sq-quest-days" : "centered"}
      style={{
        textAlign: "left",
        maxWidth: quest ? "980px" : "440px",
        ...(quest ? questPage : null),
      }}
    >
      {quest && <QuestFieldStyles />}
      <div>
        {quest && <StepMark step={2} />}
        <h1>{quest ? "When does your party march?" : "When can you study?"}</h1>
        <p className="muted">
          {quest
            ? "The planner only schedules quests inside these windows — that is what keeps the campaign honest."
            : "The planner only places work inside these windows — this is what makes the plan realistic instead of aspirational. Rough is fine; you can refine it any time."}
        </p>
      </div>

      {/* Same .card panel as the term step: parchment under quest, quiet surface
          under mission/plain. The chart now carries the term the student just
          chartered, so the last step is visibly the last blank being inked in. */}
      {quest ? (
        <div style={splitLayout}>
          <div style={formColumn}>{availabilityForm}</div>
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
                mark: "◈",
                label: "Marching hours",
                srLabel: "Study windows",
                value: hoursLine,
                pending: "No days marked yet",
              },
              {
                mark: "◆",
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
