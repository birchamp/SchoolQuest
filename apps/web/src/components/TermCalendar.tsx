import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useBodyTheme } from "../lib/use-body-theme";

/**
 * The semester's calendar: breaks, holidays, finals.
 *
 * This card is first on the Setup screen, and the order is the point. A syllabus says "Problem
 * Set 6 due Week 14" and "a response is due each Tuesday in class" — both of those point at
 * dates the syllabus does not contain, and reading them without the term's real calendar is
 * how work lands on days the student is away. Measured before this existed: one problem set
 * due at the beginning of class on a Monday that turned out to be Labor Day, and sixteen
 * reading responses where the right answer was fifteen.
 *
 * ## Pasting rather than typing
 *
 * Everyone knows when Thanksgiving is. Nobody remembers that classes do not meet on the Monday
 * of Labour Day, that there are two days of fall break in October, or that the Tuesday after
 * Thanksgiving runs a Friday schedule — and those are exactly the days a plan gets quietly
 * wrong. Every school publishes this as a page of dated lines, so pasting it is thirty seconds
 * and typing fifteen dates from memory is both a chore and inaccurate.
 *
 * What comes back is shown in full, including what was **discarded**. An invented holiday
 * deletes a day the student really does have class, so the check that catches one is worth
 * showing off rather than hiding.
 *
 * ## Leaving it empty is allowed
 *
 * Nothing here is a gate. A term with no calendar plans exactly as it always did — less
 * certain, and the app says which dates are affected rather than pretending. The card says so
 * plainly, because a setup step that looks mandatory and is not is its own barrier.
 */

interface CalendarException {
  date: string;
  kind: "no_class" | "reading" | "finals";
  label: string | null;
  followsWeekday: number | null;
}

interface CalendarView {
  startDate: string;
  endDate: string;
  calendar: {
    exceptions: CalendarException[];
    breaksTakeWeekNumbers: boolean | null;
    source: "pasted_calendar" | "manual" | "unknown";
  };
  breaks: { name: string; startDate: string; endDate: string }[];
  finals: { start: string; end: string } | null;
  scheduleSwaps: { date: string; label: string | null; followsWeekday: number | null }[];
}

interface PasteResult {
  breaks: { name: string; startDate: string; endDate: string }[];
  finals: { start: string; end: string } | null;
  rejected: { entry: { label: string; startDate: string }; reason: string }[];
  unreadableLines: string[];
  warnings: string[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "12 October" / "12–13 October" / "25 November – 2 December". */
function span(startDate: string, endDate: string): string {
  const a = new Date(`${startDate}T00:00:00Z`);
  const b = new Date(`${endDate}T00:00:00Z`);
  const day = (d: Date) => d.getUTCDate();
  const month = (d: Date) =>
    d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  if (startDate === endDate) return `${day(a)} ${month(a)}`;
  if (month(a) === month(b)) return `${day(a)}–${day(b)} ${month(a)}`;
  return `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}

function Themed({ visible, plain }: { visible: string; plain: string }) {
  if (visible === plain) return <>{visible}</>;
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{plain}</span>
    </>
  );
}

export function TermCalendar({ termId, onChanged }: { termId: string; onChanged: () => void }) {
  const quest = useBodyTheme() === "quest";

  const [view, setView] = useState<CalendarView | null>(null);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PasteResult | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const load = useCallback(async () => {
    try {
      setView(await api.get<CalendarView>(`/api/terms/${termId}/calendar`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your calendar.");
    }
  }, [termId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function read() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<PasteResult>(`/api/terms/${termId}/calendar/paste`, { text }));
      setPasting(false);
      setText("");
      await load();
      // Every date in the plan is read against this, so the rest of the app is now stale.
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function saveExceptions(exceptions: CalendarException[]) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/terms/${termId}`, { calendar: { exceptions, source: "manual" } });
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function addDayOff() {
    if (!newDate) return;
    const existing = view?.calendar.exceptions ?? [];
    await saveExceptions([
      ...existing.filter((e) => e.date !== newDate),
      { date: newDate, kind: "no_class", label: newLabel.trim() || "Day off", followsWeekday: null },
    ]);
    setNewDate("");
    setNewLabel("");
  }

  async function removeRun(startDate: string, endDate: string) {
    const existing = view?.calendar.exceptions ?? [];
    await saveExceptions(existing.filter((e) => e.date < startDate || e.date > endDate));
  }

  if (!view) {
    return (
      <section className="card">
        <h2>Semester calendar</h2>
        <p className="muted">{error ?? "Loading…"}</p>
      </section>
    );
  }

  const empty = view.calendar.exceptions.length === 0;

  return (
    <section className="card" aria-labelledby="term-calendar-heading">
      <h2 id="term-calendar-heading">
        <Themed
          visible={quest ? "The turning of the term" : "Semester calendar"}
          plain="Semester calendar"
        />
      </h2>

      <p className="muted" style={{ margin: "0 0 0.75rem" }}>
        Do this before uploading syllabuses. A syllabus says &ldquo;Week 14&rdquo; and
        &ldquo;each Tuesday in class&rdquo; without ever saying when the breaks are, so without
        this a deadline can land on a day you have no class — and nothing would look wrong.
      </p>

      {empty && !pasting && (
        <>
          <div className="risk" data-level="watch" style={{ marginBottom: "0.7rem" }}>
            <span className="level">check</span>
            <span>
              No calendar yet. Your plan still works — dates that depend on a break are flagged
              instead of guessed.
            </span>
          </div>
          <div className="button-row">
            <button className="action primary" onClick={() => setPasting(true)}>
              Paste my school&apos;s calendar
            </button>
          </div>
        </>
      )}

      {pasting && (
        <div style={{ margin: "0 0 0.75rem" }}>
          <label htmlFor="calendar-paste" className="muted" style={{ fontSize: "0.85rem" }}>
            Copy your school&apos;s academic calendar page and paste the whole thing. Extra lines
            about tuition and registration are ignored.
          </label>
          <textarea
            id="calendar-paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"August 24, 2026     First day of classes\nSeptember 7, 2026   Labor Day — no classes\n…"}
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
            <button className="action primary" disabled={busy || text.trim().length < 20} onClick={() => void read()}>
              {busy ? "Reading…" : "Read it"}
            </button>
            <button className="action" disabled={busy} onClick={() => { setPasting(false); setText(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!empty && (
        <>
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.4rem" }}>Days with no class</h3>
          {view.breaks.length === 0 && (
            <p className="muted" style={{ margin: "0 0 0.6rem", fontStyle: "italic" }}>
              None recorded.
            </p>
          )}
          {view.breaks.map((b) => (
            <div
              key={`${b.name}-${b.startDate}`}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.6rem",
                padding: "0.35rem 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <strong style={{ minWidth: "10rem" }}>{b.name}</strong>
              <span className="muted">{span(b.startDate, b.endDate)}</span>
              <button
                className="action"
                disabled={busy}
                style={{ marginLeft: "auto", fontSize: "0.8rem" }}
                onClick={() => void removeRun(b.startDate, b.endDate)}
              >
                Remove
                <span className="sr-only"> {b.name}</span>
              </button>
            </div>
          ))}

          {view.finals && (
            <p style={{ margin: "0.7rem 0 0" }}>
              <strong>Exams</strong>{" "}
              <span className="muted">{span(view.finals.start, view.finals.end)}</span>
            </p>
          )}

          {/*
            A day running another weekday's schedule is the easiest thing on a calendar to miss
            and one of the most consequential: a Friday class really does meet that Tuesday.
          */}
          {view.scheduleSwaps.map((s) => (
            <p key={s.date} className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
              {span(s.date, s.date)} runs a{" "}
              {s.followsWeekday === null ? "different" : DAY_NAMES[s.followsWeekday]} schedule.
            </p>
          ))}

          <p className="muted" style={{ margin: "0.7rem 0 0", fontSize: "0.8rem" }}>
            Instruction runs {span(view.startDate, view.startDate)} to{" "}
            {span(view.endDate, view.endDate)}
            {view.calendar.source === "pasted_calendar" ? ", read from the calendar you pasted" : ""}.
          </p>
        </>
      )}

      {result && (
        <div style={{ marginTop: "0.8rem" }}>
          {result.warnings.map((w, i) => (
            <div className="risk" data-level="watch" key={i}>
              <span className="level">check</span>
              <span>{w}</span>
            </div>
          ))}
          {/*
            Shown, not hidden. A discarded line is the student's cue to add it by hand, and a
            silent drop reads as a clean result.
          */}
          {result.rejected.length > 0 && (
            <>
              <h3 style={{ fontSize: "0.9rem", margin: "0.6rem 0 0.3rem" }}>Not used</h3>
              {result.rejected.map((r, i) => (
                <div className="risk" data-level="at_risk" key={i}>
                  <span className="level">dropped</span>
                  <span>
                    <strong>{r.entry.label}</strong> — {r.reason}
                  </span>
                </div>
              ))}
            </>
          )}
          {result.unreadableLines.length > 0 && (
            <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.82rem" }}>
              {result.unreadableLines.length} line
              {result.unreadableLines.length === 1 ? "" : "s"} could not be dated. Add anything
              that matters below.
            </p>
          )}
        </div>
      )}

      {!empty && !pasting && (
        <div className="button-row" style={{ marginTop: "0.8rem", flexWrap: "wrap" }}>
          <button className="action" onClick={() => setPasting(true)}>
            Paste a calendar again
          </button>
        </div>
      )}

      <div style={{ marginTop: "0.8rem", borderTop: "1px solid var(--border)", paddingTop: "0.7rem" }}>
        <p className="muted" style={{ margin: "0 0 0.4rem", fontSize: "0.85rem" }}>
          Add a day off by hand — a single holiday counts as much as a whole week.
        </p>
        <div className="button-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: "0.2rem" }}>
            <span className="muted" style={{ fontSize: "0.78rem" }}>Date</span>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: "0.2rem", flex: 1, minWidth: "10rem" }}>
            <span className="muted" style={{ fontSize: "0.78rem" }}>What is it</span>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Reading day, campus holiday…"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--text)",
                font: "inherit",
                fontSize: "0.9rem",
                padding: "0.45rem 0.7rem",
              }}
            />
          </label>
          <button className="action" disabled={busy || !newDate} onClick={() => void addDayOff()}>
            Add
          </button>
        </div>
      </div>

      {error && (
        <div className="risk" data-level="at_risk" style={{ marginTop: "0.6rem" }}>
          <span className="level">problem</span>
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
