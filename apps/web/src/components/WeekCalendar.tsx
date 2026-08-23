import { useState } from "react";
import type { Course, ThemeName } from "@schoolquest/domain";
import { buildWeekCalendar, type CalendarSlot, type SlotKind } from "@schoolquest/planning-engine";
import { courseTincture } from "../lib/course-colour";
import type { PlanResponse } from "../lib/types";
import { CalendarLegend } from "./CalendarLegend";

/**
 * Where the hours actually go.
 *
 * The week map answers "what am I working on". This answers "where does my time go", and a
 * student who cannot answer the second cannot make a decision about the first. Time blindness
 * is a documented deficit of the people this is for; the fix is not a prettier agenda but
 * being able to see, without counting, that Tuesday holds ninety minutes and Sunday holds
 * seven hours.
 *
 * So every hour is drawn, not only the booked ones. Free time is a band in its own right
 * rather than the absence of one — a calendar showing only what the planner booked leaves
 * five-sixths of the week blank, and blank reads as available, which is exactly the
 * misreading that gets a student to agree to a shift they have no room for.
 *
 * Colour is never the only signal: every band carries its own word, and the legend states
 * the totals in figures.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Tall enough that a 30-minute block still has room for a word. */
const PIXELS_PER_MINUTE = 0.9;

/**
 * Band fills, per ground.
 *
 * Study blocks take the course's own tincture, so the calendar agrees with every other
 * screen about which colour means which course. Everything else is deliberately neutral:
 * the calendar's job is to show the *shape* of the week, and five commitment types in five
 * hues would compete with the one distinction that matters.
 */
/**
 * One colour per kind of hour, so the week reads as classes-versus-study-versus-the-rest at a
 * glance rather than as one grey field.
 *
 * The colours are self-contained bands -- a saturated ground with its own ink -- so the same
 * four work on the dark themes and the parchment one alike: the band supplies its own contrast,
 * independent of the page under it. Kept as CSS variables (`kindColors` in styles.css) so a
 * theme can retune them and the contrast checker can measure them. Free and off stay
 * uncoloured on purpose: empty time is not one of the four things being distinguished, and
 * washing it in a fifth hue would drown the distinction the colour is for.
 *
 * Colour is never the only signal here -- every band still carries its kind word and the plain
 * list underneath states the same facts -- so this reads for a colour-blind student too.
 */
function bandStyle(kind: SlotKind): { background: string; color: string; border: string } {
  switch (kind) {
    case "class":
      return { background: "var(--cal-class)", color: "var(--cal-class-ink)", border: "var(--cal-class-edge)" };
    case "commitment":
      return {
        background: "var(--cal-commitment)",
        color: "var(--cal-commitment-ink)",
        border: "var(--cal-commitment-edge)",
      };
    case "meal":
      return { background: "var(--cal-meal)", color: "var(--cal-meal-ink)", border: "var(--cal-meal-edge)" };
    case "study":
      return { background: "var(--cal-study)", color: "var(--cal-study-ink)", border: "var(--cal-study-edge)" };
    default:
      // Free and off: uncoloured, so the four kinds that matter stand out against them.
      return { background: "transparent", color: "var(--text-dim)", border: "transparent" };
  }
}

const KIND_WORD: Record<SlotKind, string> = {
  class: "Class",
  commitment: "Committed",
  meal: "Meal",
  study: "Study",
  free: "Free",
  off: "Off",
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function clockOf(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: m === 0 ? undefined : "2-digit",
    timeZone: "UTC",
  });
}

/** A study block the student has chosen to move, held while the slot picker is open. */
interface MovingBlock {
  sessionId: string;
  title: string;
  minutes: number;
  /** Current start, ISO UTC, to seed the picker. */
  startAt: string;
}

export function WeekCalendar({
  plan,
  theme,
  hiddenCourseIds,
  onMoveBlock,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  /**
   * Move a study block to a slot the student picks, and pin it there. The handler moves and locks
   * the block, then does a minimal replan so the rest of the week reflows around it. Absent on
   * read-only renders.
   */
  onMoveBlock?: (sessionId: string, startAt: string, endAt: string) => Promise<void>;
  /**
   * Classes switched off at the tab level.
   *
   * They **recede here and are never removed**, and this is the card where that matters most.
   * This grid is a picture of time already committed; dropping a class from it would invent free
   * time that does not exist, and a reader with time blindness would look at Wednesday, see a
   * gap, and plan into an hour that is already taken. Switching a class off is allowed to make
   * the week quieter. It is not allowed to make it look emptier than it is.
   */
  hiddenCourseIds?: ReadonlySet<string>;
}) {
  const quest = theme === "quest";
  const [moving, setMoving] = useState<MovingBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
  const today = new Date().toISOString().slice(0, 10);
  const horizonStart = plan.horizonStart ?? plan.planVersion?.horizonStart ?? today;

  const calendar = buildWeekCalendar({
    horizonStart,
    horizonDays: 7,
    meetingPatterns: plan.meetingPatterns ?? [],
    commitments: plan.commitments ?? [],
    availability: plan.availabilityRules ?? [],
    sessions: plan.sessions.map((s) => ({
      workItemId: s.workItemId,
      courseId: s.courseId,
      startAt: s.startAt,
      endAt: s.endAt,
      title: itemsById.get(s.workItemId)?.title ?? "Study",
      sessionId: s.id,
      locked: s.locked,
    })),
    meals: plan.meals ?? [],
  });

  const windowMinutes = calendar.windowEndMinute - calendar.windowStartMinute;
  const height = windowMinutes * PIXELS_PER_MINUTE;
  const hourMarks: number[] = [];
  for (let m = calendar.windowStartMinute; m <= calendar.windowEndMinute; m += 60) hourMarks.push(m);

  const dayBase = (date: string) => Date.parse(`${date}T00:00:00Z`) / 60_000;

  return (
    <section className="card" aria-labelledby="calendar-heading">
      <h2 id="calendar-heading">
        <span aria-hidden="true">{quest ? "The hours" : "Your week, hour by hour"}</span>
        <span className="sr-only">Your week, hour by hour</span>
      </h2>

      <p className="muted" style={{ margin: "0 0 0.5rem" }}>
        Every hour you said you are around, and what it is for. Time with nothing on it is
        shown as free because it is — that is the room you actually have.
      </p>

      {/* Totals first: the answer to "how much time do I even have" should not require
          reading the grid. */}
      <p className="muted" style={{ margin: "0 0 0.8rem", fontSize: "0.85rem" }}>
        {(["study", "class", "commitment", "meal", "free"] as SlotKind[])
          .filter((kind) => calendar.totals[kind] > 0)
          .map((kind) => `${KIND_WORD[kind].toLowerCase()} ${formatMinutes(calendar.totals[kind])}`)
          .join(" · ")}
      </p>

      {/* The key for the four band colours. The grid paints all four kinds, so it names all
          four -- classes, study, meals and other commitments -- and the free/off time it
          leaves uncoloured is not one of them. */}
      <CalendarLegend kinds={["class", "study", "meal", "commitment"]} />

      {onMoveBlock && !moving && (
        <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.8rem" }}>
          Choose a study block to move it to a time that suits you. It gets pinned there, and the
          rest of your week reflows around it.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {moving && onMoveBlock && (
        <MovePanel
          moving={moving}
          days={calendar.days.map((d) => ({ date: d.date, dayOfWeek: d.dayOfWeek }))}
          busy={busy}
          onCancel={() => {
            setMoving(null);
            setError(null);
          }}
          onConfirm={async (startAt, endAt) => {
            setBusy(true);
            setError(null);
            try {
              await onMoveBlock(moving.sessionId, startAt, endAt);
              setMoving(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "That did not move.");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `3.2rem repeat(${calendar.days.length}, minmax(6.5rem, 1fr))`,
            gap: "0.25rem",
            minWidth: "44rem",
          }}
        >
          <div />
          {calendar.days.map((day) => (
            <h3
              key={`h-${day.date}`}
              style={{
                margin: 0,
                fontSize: "0.72rem",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                textAlign: "center",
                fontWeight: day.date === today ? 800 : 600,
              }}
            >
              {DAY_NAMES[day.dayOfWeek]} {Number(day.date.slice(8, 10))}
              {day.date === today && <span className="sr-only"> (today)</span>}
            </h3>
          ))}

          {/* The hour rail. */}
          <div style={{ position: "relative", height }}>
            {hourMarks.map((m) => (
              <span
                key={m}
                className="muted"
                style={{
                  position: "absolute",
                  top: (m - calendar.windowStartMinute) * PIXELS_PER_MINUTE - 6,
                  right: "0.3rem",
                  fontSize: "0.66rem",
                }}
              >
                {clockOf(m)}
              </span>
            ))}
          </div>

          {calendar.days.map((day) => {
            const base = dayBase(day.date);
            return (
              <div
                key={day.date}
                style={{
                  position: "relative",
                  height,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                {/* Hour gridlines, so a band's height is readable as a duration. */}
                {hourMarks.map((m) => (
                  <span
                    key={m}
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: (m - calendar.windowStartMinute) * PIXELS_PER_MINUTE,
                      borderTop: "1px solid var(--border)",
                      opacity: 0.5,
                    }}
                  />
                ))}

                {day.slots.map((slot) => {
                  const movable =
                    slot.kind === "study" && !!onMoveBlock && !!slot.sessionId;
                  return (
                    <Band
                      key={`${slot.kind}-${slot.start}`}
                      slot={slot}
                      base={base}
                      windowStart={calendar.windowStartMinute}
                      quest={quest}
                      course={slot.courseId ? coursesById.get(slot.courseId) : undefined}
                      receded={slot.courseId !== null && (hiddenCourseIds?.has(slot.courseId) ?? false)}
                      onSelect={
                        movable
                          ? () =>
                              setMoving({
                                sessionId: slot.sessionId!,
                                title: slot.title ?? "Study",
                                minutes: slot.minutes,
                                startAt: new Date(slot.start * 60_000).toISOString(),
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Band({
  slot,
  base,
  windowStart,
  quest,
  course,
  receded,
  onSelect,
}: {
  slot: CalendarSlot;
  base: number;
  windowStart: number;
  quest: boolean;
  course: Course | undefined;
  receded: boolean;
  /** When set, the band is a button that opens the move picker for this study block. */
  onSelect?: () => void;
}) {
  const top = (slot.start - base - windowStart) * PIXELS_PER_MINUTE;
  const height = slot.minutes * PIXELS_PER_MINUTE;
  const own = bandStyle(slot.kind);
  /**
   * A switched-off class recedes to the neutral "off" look — a muted surface with dim ink —
   * rather than borrowing another kind's colour, which would make it read as a commitment now
   * that each kind has its own hue. It keeps its size and position: this grid is a picture of
   * time already spoken for, and a band that shrank or vanished would hand back an hour the
   * student does not have.
   */
  const style = receded
    ? { background: "var(--surface-2)", color: "var(--text-dim)", border: "var(--border)" }
    : own;

  // Study blocks carry the course's colour as an edge rather than a fill, so the text on
  // them keeps the card's measured ink instead of needing a per-course contrast check.
  const edge =
    slot.kind === "study" && course
      ? courseTincture(course.id, course.colorToken, quest)
      : style.border;

  const label = slot.title ?? KIND_WORD[slot.kind];
  /**
   * A gap too short to study in is not worth naming.
   *
   * The scheduler leaves ten minutes between blocks on purpose, so an afternoon of study
   * produced a labelled "Free" sliver between every pair of them — half a dozen words saying
   * nothing, competing with the blocks that mattered. Below a usable stretch the band still
   * exists, and still occupies its minutes, but says nothing.
   */
  const worthNaming = slot.kind !== "free" || slot.minutes >= 25;

  const boxStyle = {
    position: "absolute" as const,
    left: 2,
    right: 2,
    top,
    height: Math.max(height - 1, 8),
    background: style.background,
    color: style.color,
    borderLeft: `3px solid ${receded ? "var(--border)" : edge}`,
    border: slot.kind === "free" ? "none" : undefined,
    // A pinned study block wears a full ring so it reads as fixed, not just coloured.
    boxShadow: slot.locked ? `inset 0 0 0 1px ${edge}` : undefined,
    borderRadius: 4,
    padding: height > 26 ? "0.15rem 0.3rem" : "0 0.3rem",
    fontSize: "0.68rem",
    lineHeight: 1.2,
    overflow: "hidden",
    borderTop: slot.kind === "meal" ? `1px dashed ${style.border}` : undefined,
    borderBottom: slot.kind === "meal" ? `1px dashed ${style.border}` : undefined,
    fontStyle: slot.kind === "meal" || slot.kind === "free" ? "italic" : undefined,
  };

  const inner = (
    <>
      {/* Duration is in the accessible name rather than on screen: at this size the figure
          competes with the label, and the band's height already carries it visually. */}
      {!onSelect && (
        <span className="sr-only">
          {KIND_WORD[slot.kind]}: {label}, {formatMinutes(slot.minutes)} from{" "}
          {clockOf(slot.start - base)}
          {slot.locked ? ", pinned" : ""}
        </span>
      )}
      {worthNaming && (
        <span aria-hidden="true">
          {/* No opacity anywhere in here. Dimming the time prefix with `opacity: 0.85`
              put it at 4.27:1 — the third time this codebase has shipped transparency as
              de-emphasis and measured below the floor for it. The band's own colour is
              already the quiet one; the prefix simply shares it. */}
          {slot.kind !== "free" && <span>{clockOf(slot.start - base)} </span>}
          {label}
          {course && height > 40 && (
            <span style={{ display: "block" }}>{course.code ?? course.name}</span>
          )}
        </span>
      )}
    </>
  );

  // A movable study block is a real button, so it works by keyboard and touch alike -- the
  // accessible name says what activating it does. Everything else stays a plain band.
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Move ${label}, ${formatMinutes(slot.minutes)} from ${clockOf(
          slot.start - base,
        )}${slot.locked ? ", pinned" : ""}`}
        style={{
          ...boxStyle,
          textAlign: "left",
          font: "inherit",
          fontSize: "0.68rem",
          cursor: "pointer",
          appearance: "none",
        }}
      >
        {inner}
      </button>
    );
  }

  return <div style={boxStyle}>{inner}</div>;
}

/**
 * Pick a new day and time for a study block, then pin it there.
 *
 * A deliberate two-field choice rather than a drag: it works by keyboard and on a phone, and it
 * says plainly what will happen -- the block moves, is pinned, and the week reflows around it.
 */
function MovePanel({
  moving,
  days,
  busy,
  onConfirm,
  onCancel,
}: {
  moving: MovingBlock;
  days: { date: string; dayOfWeek: number }[];
  busy: boolean;
  onConfirm: (startAt: string, endAt: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(moving.startAt.slice(0, 10));
  const [time, setTime] = useState(moving.startAt.slice(11, 16));

  const fieldStyle = {
    background: "var(--surface-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "0.45rem 0.6rem",
    font: "inherit",
    fontSize: "0.9rem",
  } as const;

  function confirm() {
    const startAt = `${date}T${time}:00.000Z`;
    const endAt = new Date(Date.parse(startAt) + moving.minutes * 60_000).toISOString();
    onConfirm(startAt, endAt);
  }

  const duration =
    moving.minutes < 60
      ? `${moving.minutes}m`
      : `${Math.floor(moving.minutes / 60)}h${moving.minutes % 60 ? ` ${moving.minutes % 60}m` : ""}`;

  return (
    <div
      role="group"
      aria-label={`Move ${moving.title}`}
      style={{
        margin: "0.6rem 0 0.2rem",
        padding: "0.7rem 0.8rem",
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--surface)",
      }}
    >
      <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>
        Move <strong>{moving.title}</strong>{" "}
        <span className="muted">({duration})</span>
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: "0.2rem" }}>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            Day
          </span>
          <select style={fieldStyle} value={date} onChange={(e) => setDate(e.target.value)}>
            {days.map((d) => (
              <option key={d.date} value={d.date}>
                {DAY_NAMES[d.dayOfWeek]} {Number(d.date.slice(8, 10))}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: "0.2rem" }}>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            Start
          </span>
          <input style={fieldStyle} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <p className="muted" style={{ margin: "0.5rem 0 0.6rem", fontSize: "0.82rem" }}>
        It will be pinned to that time, and the rest of your week reflows around it. Skip it later
        to unpin it.
      </p>
      <div className="button-row">
        <button className="action primary" disabled={busy} onClick={confirm}>
          {busy ? "Moving…" : "Move and pin"}
        </button>
        <button className="action" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
