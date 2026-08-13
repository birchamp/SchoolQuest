import { useCallback, useMemo, useRef, useState } from "react";
import type { Course, ThemeName } from "@schoolquest/domain";
import {
  summarizeRadar,
  worstEncounter,
  type RadarEncounter,
  type RadarHealth,
} from "@schoolquest/planning-engine";
import { explainRadarAdvice, label, plainLabel } from "@schoolquest/theme-language";

import {
  RADAR_CENTER,
  RADAR_VIEWBOX,
  dayLabelGeometry,
  isDistant,
  overdueBandGeometry,
  projectEncounter,
  ringGeometry,
  spokeGeometry,
  tooltipPosition,
  weekdayName,
  type Projection,
} from "../lib/radar-geometry";
import type { CampaignRadarView } from "../lib/types";

/**
 * The surface the term is planned from.
 *
 * Every other view here answers a question about a list: what is next, what is this week,
 * how is each class doing. None of them answers the question a student actually opens the
 * app with — *what is coming at me, and am I ready for it* — because a list can only be read
 * one line at a time, and reading lists one line at a time is the specific thing this app's
 * reader cannot reliably do.
 *
 * So the four weeks ahead are drawn as a sweep the eye reads at once:
 *
 *   - **Distance from the centre is time.** Work drifts toward you every day whether or not
 *     you touch it. Something on the outer ring is a month out; something near the mark is
 *     tomorrow.
 *   - **Bearing is the day.** Column 0 is today, and the columns repeat weekly — so reading
 *     one column outward is every Thursday of the month at once, and two things due the same
 *     day visibly pile up instead of sitting forty lines apart.
 *   - **Size is the share of the course grade**, normalized within its own course so a
 *     200-point final and a 20%-weighted final are drawn the same size.
 *   - **Colour is whether enough time is booked, and nothing else.** Course identity,
 *     completion and a sweep line were all considered and left out. The moment colour means
 *     two things it means neither.
 *
 * ## What this does not do
 *
 * It does not schedule. The hour-by-hour decisions live on Today and the week calendar, and
 * this board's job is to tell you which of them is wrong. The one action it offers is the one
 * it can honestly make good on: put an encounter at the front of the queue and replan.
 *
 * ## House rules it keeps
 *
 * Colour is never the only signal — every marker carries a ring shape for its state, every
 * state ships its word in the accessible name and in the dossier, the forecast underneath
 * states the same facts in text, and nothing moves under `prefers-reduced-motion`.
 */

interface Props {
  radar: CampaignRadarView;
  courses: Course[];
  theme: ThemeName;
  termName: string;
  /** Jump to this work item in the assignments table. */
  onOpenWork: (workItemId: string) => void;
  /** Put these items at the front of the queue and replan. */
  onPrioritize: (workItemIds: string[]) => Promise<void>;
}

const HORIZONS = [1, 2, 3, 4] as const;

/** Colour never carries a verdict alone; each state has a ring shape and a word too. */
const HEALTH_CLASS: Record<RadarHealth, string> = {
  ok: "is-ok",
  warn: "is-warn",
  crit: "is-crit",
};

const TIER_WORD = ["", "Trivial", "Minor", "Standard", "Elite", "Boss-class"] as const;

function healthWord(health: RadarHealth, theme: ThemeName): string {
  if (health === "ok") return label("preparedFull", theme);
  if (health === "warn") return label("preparedPartial", theme);
  return label("preparedShort", theme);
}

function plainHealthWord(health: RadarHealth): string {
  if (health === "ok") return plainLabel("preparedFull");
  if (health === "warn") return plainLabel("preparedPartial");
  return plainLabel("preparedShort");
}

/** "3.5h", or "30m" when hours would round to something that reads as nothing. */
function hours(value: number): string {
  if (value <= 0) return "0h";
  if (value < 1) return `${Math.round(value * 60)}m`;
  return `${Number(value.toFixed(1))}h`;
}

function dueWord(encounter: RadarEncounter): string {
  const { daysAway } = encounter;
  if (daysAway < 0) return `${Math.abs(daysAway)} day${daysAway === -1 ? "" : "s"} overdue`;
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `${weekdayName(encounter.dayOfWeek)} · ${daysAway} days`;
}

export function CampaignRadar({
  radar,
  courses,
  theme,
  termName,
  onOpenWork,
  onPrioritize,
}: Props) {
  const [weeks, setWeeks] = useState(4);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());

  const courseName = useCallback(
    (id: string) => {
      const course = courses.find((c) => c.id === id);
      return course ? (course.code ?? course.name) : "Unknown class";
    },
    [courses],
  );

  /**
   * Everything inside the current horizon, nearest first.
   *
   * Sorted by time rather than by size because this is also the order the keyboard walks
   * them in, and "next" has to mean the next thing to happen or the arrow keys are a shuffle.
   */
  const inRange = useMemo(
    () =>
      radar.encounters
        .filter((e) => e.daysAway <= weeks * 7)
        .sort((a, b) => a.daysAway - b.daysAway || a.id.localeCompare(b.id)),
    [radar.encounters, weeks],
  );

  const summary = useMemo(
    () => summarizeRadar(radar.encounters, weeks * 7),
    [radar.encounters, weeks],
  );

  const placed = useMemo(
    () =>
      inRange
        .map((encounter) => ({ encounter, at: projectEncounter(encounter, weeks) }))
        .filter((p): p is { encounter: RadarEncounter; at: Projection } => p.at !== null)
        // Painted back to front, so a near marker is never hidden behind a far one.
        .sort((a, b) => a.at.y - b.at.y),
    [inRange, weeks],
  );

  // With nothing hovered or focused the dossier shows the worst thing on the board, so the
  // panel is never empty and never neutral.
  const selected =
    (activeId ? inRange.find((e) => e.id === activeId) : undefined) ?? worstEncounter(inRange);

  const todayDayOfWeek = useMemo(() => new Date().getUTCDay(), []);
  const rings = useMemo(
    () => ringGeometry(weeks, radar.currentTermWeek),
    [weeks, radar.currentTermWeek],
  );
  const spokes = useMemo(() => spokeGeometry(), []);
  const dayLabels = useMemo(() => dayLabelGeometry(todayDayOfWeek), [todayDayOfWeek]);
  const overdue = useMemo(() => inRange.filter((e) => e.overdue), [inRange]);
  const band = useMemo(() => overdueBandGeometry(), []);
  const upcoming = useMemo(
    () => radar.encounters.filter((e) => e.daysAway >= 0 && e.daysAway <= 7),
    [radar.encounters],
  );

  /**
   * Arrow keys walk the markers in time order.
   *
   * Tab alone would work, but a board of thirty markers is thirty tab stops between the
   * radar and the panel beside it. Arrows move within the board; Tab leaves it.
   */
  const walk = (from: string, step: number) => {
    const index = placed.findIndex((p) => p.encounter.id === from);
    if (index < 0) return;
    const next = placed[(index + step + placed.length) % placed.length];
    if (!next) return;
    setActiveId(next.encounter.id);
    markerRefs.current.get(next.encounter.id)?.focus();
  };

  const onMarkerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      walk(id, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      walk(id, -1);
    }
  };

  const prioritize = async (encounter: RadarEncounter) => {
    setBusy(true);
    try {
      await onPrioritize(encounter.memberIds);
    } finally {
      setBusy(false);
    }
  };

  const tip = selected && activeId ? placed.find((p) => p.encounter.id === activeId) : undefined;

  return (
    <section className="radar" aria-label={plainLabel("radar")}>
      <header className="radar-head">
        <div>
          <p className="radar-kicker">
            {termName}
            {radar.currentTermWeek !== null && ` · week ${radar.currentTermWeek}`}
          </p>
          <h2>{label("radar", theme)}</h2>
        </div>
        <dl className="radar-stats">
          <div>
            <dt>In range</dt>
            <dd>{summary.inRange}</dd>
          </div>
          <div>
            <dt>On pace</dt>
            <dd className={HEALTH_CLASS[paceHealth(summary.partyPercent)]}>
              {summary.partyPercent}%
            </dd>
          </div>
          <div>
            <dt>Unbooked hours</dt>
            <dd>{hours(summary.deficitHours)}</dd>
          </div>
        </dl>
      </header>

      <div className="radar-toolbar">
        <div className="radar-horizon" role="group" aria-label="How far ahead to look">
          <span className="radar-toolbar-label">Horizon</span>
          {HORIZONS.map((n) => (
            <button key={n} type="button" aria-pressed={weeks === n} onClick={() => setWeeks(n)}>
              {n}W
            </button>
          ))}
        </div>
        <ul className="radar-legend">
          {(["ok", "warn", "crit"] as const).map((h) => (
            <li key={h}>
              <span className={`radar-swatch ${HEALTH_CLASS[h]}`} aria-hidden="true" />
              {healthWord(h, theme)}
            </li>
          ))}
          <li>
            <span className="radar-swatch is-boss" aria-hidden="true" />
            {label("bossEncounter", theme)}
          </li>
        </ul>
      </div>

      <div className="radar-body">
        <div className="radar-board">
          <div className="radar-scope">
            <svg
              viewBox={`0 0 ${RADAR_VIEWBOX.width} ${RADAR_VIEWBOX.height}`}
              className="radar-grid"
              aria-hidden="true"
            >
              {spokes.map((s, i) => (
                <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="radar-spoke" />
              ))}
              {rings.map((r) => (
                <path key={r.label} d={r.d} className="radar-ring" />
              ))}
              {/* The past, and only when there is one. An empty band with its own furniture
                reads as a region of the board the student has failed to fill. */}
              {overdue.length > 0 && (
                <g className="radar-behind">
                  {band.spokes.map((s, i) => (
                    <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="radar-spoke" />
                  ))}
                  <path d={band.arc} className="radar-ring" />
                </g>
              )}
              <line
                x1={RADAR_CENTER.x - 400}
                y1={RADAR_CENTER.y}
                x2={RADAR_CENTER.x + 400}
                y2={RADAR_CENTER.y}
                className="radar-baseline"
              />
            </svg>

            {rings.map((r) => (
              <span
                key={r.label}
                className="radar-ring-label"
                style={{
                  left: `${(r.labelX / RADAR_VIEWBOX.width) * 100}%`,
                  top: `${(r.labelY / RADAR_VIEWBOX.height) * 100}%`,
                }}
                aria-hidden="true"
              >
                {r.label}
              </span>
            ))}
            {dayLabels.map((d) => (
              <span
                key={d.index}
                className="radar-day-label"
                style={{
                  left: `${(d.x / RADAR_VIEWBOX.width) * 100}%`,
                  top: `${(d.y / RADAR_VIEWBOX.height) * 100}%`,
                }}
                aria-hidden="true"
              >
                {d.index === 0 ? "Today" : d.label}
              </span>
            ))}

            <span
              className="radar-you"
              style={{
                left: `${(RADAR_CENTER.x / RADAR_VIEWBOX.width) * 100}%`,
                top: `${(RADAR_CENTER.y / RADAR_VIEWBOX.height) * 100}%`,
              }}
              aria-hidden="true"
            />
            <span
              className="radar-you-label"
              style={{
                left: `${(RADAR_CENTER.x / RADAR_VIEWBOX.width) * 100}%`,
                top: `${((RADAR_CENTER.y + 14) / RADAR_VIEWBOX.height) * 100}%`,
              }}
              aria-hidden="true"
            >
              You · {weekdayName(todayDayOfWeek)}
            </span>
            {overdue.length > 0 && (
              <span
                className="radar-behind-label"
                style={{
                  left: "2%",
                  top: `${((RADAR_CENTER.y + 30) / RADAR_VIEWBOX.height) * 100}%`,
                }}
                aria-hidden="true"
              >
                Behind you · {overdue.length} past due
              </span>
            )}

            {placed.map(({ encounter, at }) => {
              const dim = isDistant(encounter);
              return (
                <button
                  key={encounter.id}
                  type="button"
                  ref={(el) => {
                    if (el) markerRefs.current.set(encounter.id, el);
                    else markerRefs.current.delete(encounter.id);
                  }}
                  className={[
                    "radar-marker",
                    HEALTH_CLASS[encounter.health],
                    encounter.boss ? "is-boss" : "",
                    dim ? "is-distant" : "",
                    activeId === encounter.id ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    left: `${(at.x / RADAR_VIEWBOX.width) * 100}%`,
                    top: `${(at.y / RADAR_VIEWBOX.height) * 100}%`,
                    width: `${at.size}px`,
                    height: `${at.size}px`,
                  }}
                  onMouseEnter={() => setActiveId(encounter.id)}
                  onFocus={() => setActiveId(encounter.id)}
                  onKeyDown={(e) => onMarkerKeyDown(e, encounter.id)}
                  onClick={() => setActiveId(encounter.id)}
                >
                  <span className="sr-only">
                    {encounter.title}. {courseLine(encounter, courseName)}. {dueWord(encounter)}.{" "}
                    {plainHealthWord(encounter.health)}, {hours(encounter.hoursBanked)} of{" "}
                    {hours(encounter.hoursNeeded)} booked.
                  </span>
                </button>
              );
            })}

            {tip && (
              <div
                className="radar-tip"
                style={{
                  left: `${(tooltipPosition(tip.at).x / RADAR_VIEWBOX.width) * 100}%`,
                  top: `${(tooltipPosition(tip.at).y / RADAR_VIEWBOX.height) * 100}%`,
                }}
                aria-hidden="true"
              >
                <p className={`radar-tip-kicker ${HEALTH_CLASS[tip.encounter.health]}`}>
                  {tip.encounter.boss
                    ? label("bossEncounter", theme)
                    : `${courseLine(tip.encounter, courseName)} · ${TIER_WORD[tip.encounter.tier]}`}
                </p>
                <p className="radar-tip-title">{tip.encounter.title}</p>
                <p className="radar-tip-meta">
                  {dueWord(tip.encounter)} · {hours(tip.encounter.hoursBanked)} of{" "}
                  {hours(tip.encounter.hoursNeeded)} booked
                </p>
                <Bar coverage={tip.encounter.coverage} health={tip.encounter.health} />
              </div>
            )}

            {placed.length === 0 && (
              <p className="radar-empty">
                {radar.encounters.length === 0
                  ? "Nothing is on the board. Add a syllabus in Setup and the term will fill in."
                  : `Nothing due in the next ${weeks * 7} days. Widen the horizon to see further out.`}
              </p>
            )}
          </div>
          {radar.termWeeks.length > 0 && (
            <div className="radar-term-map">
              <div className="radar-term-head">
                <h4>{label("termMap", theme)}</h4>
                <p className="muted">Bar height is work due that week. A flag marks a pile-up.</p>
              </div>
              <ol className="radar-term-bars">
                {radar.termWeeks.map((week) => (
                  <li
                    key={week.weekNumber}
                    className={week.isCurrent ? "is-current" : week.isPast ? "is-past" : ""}
                  >
                    <span className="radar-term-flag" aria-hidden="true">
                      {week.hasBoss ? "◆" : ""}
                    </span>
                    <span
                      className="radar-term-bar"
                      style={{ height: `${Math.max(2, Math.round(week.intensity * 72))}px` }}
                    >
                      <span className="sr-only">
                        Week {week.weekNumber}: {hours(week.hours)} of work due
                        {week.hasBoss ? ", including a pile-up" : ""}
                      </span>
                    </span>
                    <span className="radar-term-week" aria-hidden="true">
                      {week.weekNumber}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <aside className="radar-dossier" aria-label={plainLabel("dossier")}>
          <p className="radar-kicker">{label("dossier", theme)}</p>
          {!selected ? (
            <p className="muted">Nothing in range needs a decision.</p>
          ) : (
            <>
              <h3>{selected.title}</h3>
              <p className="muted">
                {courseLine(selected, courseName)}
                {selected.boss && ` · ${selected.memberIds.length} together on one day`}
              </p>

              <dl className="radar-facts">
                <div>
                  <dt>Due</dt>
                  <dd>{dueWord(selected)}</dd>
                </div>
                <div>
                  <dt>{label("threatTier", theme)}</dt>
                  <dd>
                    {selected.gradeShare === null
                      ? `${TIER_WORD[selected.tier]} (from type)`
                      : `${Math.round(selected.gradeShare * 100)}% of grade`}
                  </dd>
                </div>
                <div>
                  <dt>Hours booked</dt>
                  <dd>
                    {hours(selected.hoursBanked)} / {hours(selected.hoursNeeded)}
                  </dd>
                </div>
                <div>
                  <dt>Owed by now</dt>
                  <dd>{hours(selected.hoursExpected)}</dd>
                </div>
              </dl>

              <div className="radar-prep">
                <div className="radar-prep-head">
                  <span>Preparation</span>
                  <strong className={HEALTH_CLASS[selected.health]}>
                    {healthWord(selected.health, theme)}
                  </strong>
                </div>
                <Bar coverage={selected.coverage} health={selected.health} />
              </div>

              <p className={`radar-advice ${HEALTH_CLASS[selected.health]}`}>
                {explainRadarAdvice(selected.advice, theme, {
                  shortfallHours: hours(selected.shortfallHours),
                  daysAway: selected.daysAway,
                })}
              </p>

              <div className="radar-actions">
                <button
                  type="button"
                  className="action primary"
                  disabled={busy || selected.health === "ok"}
                  onClick={() => void prioritize(selected)}
                >
                  {busy ? "Replanning…" : "Give this the next hours"}
                </button>
                <button
                  type="button"
                  className="action"
                  onClick={() => onOpenWork(selected.memberIds[0]!)}
                >
                  Open {label("assignment", theme).toLowerCase()}
                </button>
              </div>

              {selected.boss && (
                <ul className="radar-members">
                  {selected.memberIds.map((id, i) => (
                    <li key={id}>
                      <button type="button" onClick={() => onOpenWork(id)}>
                        {courseName(selected.courseIds[i] ?? "")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Overdue work is its own list, not the top of the forecast.
              Folded in, nineteen late items pushed the whole of the coming week off the
              panel and the seven-day forecast showed nothing from the next seven days. */}
          {overdue.length > 0 && (
            <>
              <h4 className="radar-forecast-head">Past due · {overdue.length}</h4>
              <ul className="radar-forecast is-scroll">
                {overdue.map((encounter) => (
                  <ForecastRow
                    key={encounter.id}
                    encounter={encounter}
                    day={`${Math.abs(encounter.daysAway)}d`}
                    courseName={courseName}
                    onPick={setActiveId}
                  />
                ))}
              </ul>
            </>
          )}

          <h4 className="radar-forecast-head">{label("futureWork", theme)} · 7 days</h4>
          <ul className="radar-forecast is-scroll">
            {upcoming.map((encounter) => (
              <ForecastRow
                key={encounter.id}
                encounter={encounter}
                day={encounter.daysAway === 0 ? "Today" : weekdayName(encounter.dayOfWeek)}
                courseName={courseName}
                onPick={setActiveId}
              />
            ))}
            {upcoming.length === 0 && (
              <li className="muted">Nothing is due in the next seven days.</li>
            )}
          </ul>

          {(radar.undatedCount > 0 || radar.beyondCount > 0) && (
            <p className="muted radar-offboard">
              {radar.undatedCount > 0 &&
                `${radar.undatedCount} with no date yet — they cannot be placed in time. `}
              {radar.beyondCount > 0 && `${radar.beyondCount} further out than the radar reaches.`}
            </p>
          )}
        </aside>
      </div>

      <details className="radar-key">
        <summary>What the marks mean</summary>
        <ul>
          <li>
            <strong>Distance</strong> is time. The centre mark is you, today. The arcs are week
            boundaries, labelled with how many weeks out they are and which week of the term they
            land in.
          </li>
          <li>
            <strong>Direction</strong> is the day. The leftmost column is today, and the columns
            repeat every week — so one column read outward is the same weekday every week.
          </li>
          <li>
            <strong>Size</strong> is how much of the course grade the work carries. A homework check
            is a speck; a unit exam is a boulder.
          </li>
          <li>
            <strong>Colour</strong> is whether enough time is booked for it <em>by now</em>,
            measured against how long work that size needs. Big work far out is calm on purpose:
            nothing is owed on it yet.
          </li>
          <li>
            <strong>A diamond</strong> is two or more heavy things landing on one day, merged. The
            day is what is oversubscribed, and it usually has to be solved a week earlier than
            either piece suggests alone.
          </li>
          <li>
            <strong>Dimmed</strong> means more than ten days out and on pace. Present, but not
            asking for you.
          </li>
        </ul>
      </details>
    </section>
  );
}

function ForecastRow({
  encounter,
  day,
  courseName,
  onPick,
}: {
  encounter: RadarEncounter;
  day: string;
  courseName: (id: string) => string;
  onPick: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseEnter={() => onPick(encounter.id)}
        onFocus={() => onPick(encounter.id)}
        onClick={() => onPick(encounter.id)}
      >
        <span className="radar-forecast-day">{day}</span>
        <span className="radar-forecast-title">
          {courseLine(encounter, courseName)} — {encounter.title}
        </span>
        <span className={`radar-swatch ${HEALTH_CLASS[encounter.health]}`}>
          <span className="sr-only">{plainHealthWord(encounter.health)}</span>
        </span>
      </button>
    </li>
  );
}

function courseLine(encounter: RadarEncounter, courseName: (id: string) => string): string {
  return [...new Set(encounter.courseIds.map(courseName))].join(" + ");
}

function paceHealth(percent: number): RadarHealth {
  if (percent >= 70) return "ok";
  if (percent >= 45) return "warn";
  return "crit";
}

function Bar({ coverage, health }: { coverage: number; health: RadarHealth }) {
  return (
    <div className="radar-bar" aria-hidden="true">
      <span
        className={HEALTH_CLASS[health]}
        style={{ width: `${Math.round(Math.min(1, coverage) * 100)}%` }}
      />
    </div>
  );
}
