import type { Course, ThemeName } from "@schoolquest/domain";
import { buildWeekCalendar, type CalendarSlot, type SlotKind } from "@schoolquest/planning-engine";
import { courseTincture } from "../lib/course-colour";
import type { PlanResponse } from "../lib/types";

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
function bandStyle(kind: SlotKind, quest: boolean): { background: string; color: string; border: string } {
  if (quest) {
    switch (kind) {
      case "class":
        return { background: "#d9c69c", color: "#2a1f14", border: "#a8895a" };
      case "commitment":
        return { background: "#c9b48a", color: "#2a1f14", border: "#a8895a" };
      case "meal":
        return { background: "transparent", color: "#5b4930", border: "#a8895a" };
      case "free":
        return { background: "transparent", color: "#5b4930", border: "transparent" };
      default:
        return { background: "#efe3c8", color: "#2a1f14", border: "#8a6f1f" };
    }
  }
  switch (kind) {
    case "class":
      return { background: "var(--surface-2)", color: "var(--text)", border: "var(--border)" };
    case "commitment":
      return { background: "var(--surface-2)", color: "var(--text)", border: "var(--border)" };
    case "meal":
      return { background: "transparent", color: "var(--text-dim)", border: "var(--border)" };
    case "free":
      return { background: "transparent", color: "var(--text-dim)", border: "transparent" };
    default:
      return { background: "var(--surface)", color: "var(--text)", border: "var(--accent-dim)" };
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

export function WeekCalendar({
  plan,
  theme,
  selectedCourseId,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  selectedCourseId?: string | null;
}) {
  const quest = theme === "quest";
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

                {day.slots.map((slot) => (
                  <Band
                    key={`${slot.kind}-${slot.start}`}
                    slot={slot}
                    base={base}
                    windowStart={calendar.windowStartMinute}
                    quest={quest}
                    course={slot.courseId ? coursesById.get(slot.courseId) : undefined}
                    receded={
                      Boolean(selectedCourseId) &&
                      slot.courseId !== null &&
                      slot.courseId !== selectedCourseId
                    }
                  />
                ))}
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
}: {
  slot: CalendarSlot;
  base: number;
  windowStart: number;
  quest: boolean;
  course: Course | undefined;
  receded: boolean;
}) {
  const top = (slot.start - base - windowStart) * PIXELS_PER_MINUTE;
  const height = slot.minutes * PIXELS_PER_MINUTE;
  const style = bandStyle(slot.kind, quest);

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

  return (
    <div
      style={{
        position: "absolute",
        left: 2,
        right: 2,
        top,
        height: Math.max(height - 1, 8),
        background: style.background,
        color: style.color,
        borderLeft: `3px solid ${receded ? "var(--border)" : edge}`,
        border: slot.kind === "free" ? "none" : undefined,
        borderRadius: 4,
        padding: height > 26 ? "0.15rem 0.3rem" : "0 0.3rem",
        fontSize: "0.68rem",
        lineHeight: 1.2,
        overflow: "hidden",
        borderTop: slot.kind === "meal" ? `1px dashed ${style.border}` : undefined,
        borderBottom: slot.kind === "meal" ? `1px dashed ${style.border}` : undefined,
        fontStyle: slot.kind === "meal" || slot.kind === "free" ? "italic" : undefined,
      }}
    >
      {/* Duration is in the accessible name rather than on screen: at this size the figure
          competes with the label, and the band's height already carries it visually. */}
      <span className="sr-only">
        {KIND_WORD[slot.kind]}: {label}, {formatMinutes(slot.minutes)} from{" "}
        {clockOf(slot.start - base)}
      </span>
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
    </div>
  );
}
