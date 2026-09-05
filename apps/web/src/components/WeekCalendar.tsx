import { useEffect, useRef, useState } from "react";
import type { Course, ThemeName } from "@schoolquest/domain";
import { toEpochMinutes } from "@schoolquest/domain";
import {
  buildWeekCalendar,
  type CalendarDeadline,
  type CalendarSlot,
  type SlotKind,
} from "@schoolquest/planning-engine";
import { api } from "../lib/api";
import { courseTincture } from "../lib/course-colour";
import { openDeadlines } from "../lib/deadlines";
import type { PlanResponse, PlannedSession } from "../lib/types";
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
 *
 * ## Deadlines, and why they were the bug
 *
 * Hours were the only thing this drew, and a deadline costs no hours. So a paper due Thursday
 * with its block booked on Monday put a green band on Monday and left Thursday empty, and
 * anything the week could not fit at all appeared on no day whatsoever -- while both sat in
 * plain sight on the assignments board one tab away. Reported exactly that way, by a student:
 * work on the board that is not on the calendar.
 *
 * The fix is not a filter, it is a second kind of mark. Every open dated row on the board is
 * now drawn on the day it is owed, above the hours rather than among them, because a deadline
 * is a fact about a day and not a claim on any minute in it. A stated clock time also gets a
 * line across the grid at its hour, so "due at nine" is legible as a position and not only as
 * text. `nothing booked` is called out where it is true: a deadline with no time set aside
 * behind it anywhere this week is the one the student most needs to see.
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

/** A study band is moved in these steps: a quarter hour up or down, a whole day across. */
const NUDGE_MINUTES = 15;

export function WeekCalendar({
  plan,
  theme,
  hiddenCourseIds,
  onChanged,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  /**
   * Called after a block is moved or locked, so the plan is read back. When absent the grid is
   * read-only, which is how the screenshot tools use it.
   */
  onChanged?: () => void;
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
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
  const today = new Date().toISOString().slice(0, 10);

  /**
   * Editing a block from the grid.
   *
   * Every band here used to be inert: the server has had move and lock routes for as long as
   * it has had blocks, and no screen called them (the coach could lock one, if the model
   * happened to propose it). Keyboard first, because a grid a screen-reader user can operate
   * is the PRD's own criterion (FR-10) and it is the version that can be tested; dragging is
   * the same two calls with a different gesture and can come later.
   *
   * The slot knows its work item and start minute; that pair finds the session row, which is
   * what the routes address.
   */
  const sessionsByKey = new Map<string, PlannedSession>(
    plan.sessions.map((s) => [`${s.workItemId}:${toEpochMinutes(s.startAt)}`, s]),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const selected = selectedId ? plan.sessions.find((s) => s.id === selectedId) ?? null : null;
  const editable = onChanged !== undefined;

  /**
   * Keeps the keyboard on the block it was moving.
   *
   * A moved band is drawn as a new element (its key is its start minute), so focus fell to
   * the page after every arrow press and the second press went nowhere. Only after an edit
   * from this grid, never on an unrelated refresh.
   */
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!refocus.current) return;
    const target = document.querySelector<HTMLElement>(`[data-session-id="${refocus.current}"]`);
    refocus.current = null;
    target?.focus();
  }, [plan]);

  async function moveBy(session: PlannedSession, deltaMinutes: number) {
    const startAt = new Date(Date.parse(session.startAt) + deltaMinutes * 60_000).toISOString();
    const endAt = new Date(Date.parse(session.endAt) + deltaMinutes * 60_000).toISOString();
    await edit(session.id, () => api.post(`/api/work-sessions/${session.id}/move`, { startAt, endAt }));
  }

  async function toggleLock(session: PlannedSession) {
    await edit(session.id, () => api.post(`/api/work-sessions/${session.id}/lock`, { locked: !session.locked }));
  }

  async function edit(sessionId: string, call: () => Promise<unknown>) {
    if (!editable || busy) return;
    setBusy(true);
    setEditError(null);
    try {
      await call();
      refocus.current = sessionId;
      onChanged?.();
    } catch (e) {
      // The server says exactly what is in the way -- another block, a class, a fixed
      // commitment -- and that sentence is the whole feedback.
      setEditError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  function onBandKey(session: PlannedSession, e: React.KeyboardEvent) {
    if (e.key !== "Escape") setSelectedId(session.id);
    const handlers: Record<string, () => void> = {
      ArrowUp: () => void moveBy(session, -NUDGE_MINUTES),
      ArrowDown: () => void moveBy(session, NUDGE_MINUTES),
      ArrowLeft: () => void moveBy(session, -24 * 60),
      ArrowRight: () => void moveBy(session, 24 * 60),
      l: () => void toggleLock(session),
      L: () => void toggleLock(session),
      Enter: () => setSelectedId(session.id),
      " ": () => setSelectedId(session.id),
      Escape: () => setSelectedId(null),
    };
    const handler = handlers[e.key];
    if (!handler) return;
    e.preventDefault();
    handler();
  }
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
    // Every open dated row the assignments board holds. Not "the ones the planner touched" --
    // the row with nothing booked behind it is the one that used to vanish.
    deadlines: openDeadlines(plan.workItems),
  });

  const dueCount = calendar.days.reduce((sum, d) => sum + d.due.length, 0);
  const unbookedDue = calendar.days.reduce(
    (sum, d) => sum + d.due.filter((x) => x.nothingBooked).length,
    0,
  );

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

      {/* Said plainly, because the promise is the point: what is on the assignments board is
          on this screen. A student who has been bitten once by a deadline the calendar did
          not carry will not take that on trust from an unexplained row of chips. */}
      {dueCount > 0 && (
        <p className="muted" style={{ margin: "0.4rem 0 0.8rem", fontSize: "0.82rem" }}>
          Deadlines sit above each day, whether or not time is booked for them --- every
          assignment on your list that is due this week is here, on the day it is due.
          {unbookedDue > 0 && (
            <>
              {" "}
              {unbookedDue === 1 ? "One has" : `${unbookedDue} have`} no time set aside this
              week, and {unbookedDue === 1 ? "says" : "say"} so.
            </>
          )}
        </p>
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

          {/* The deadline rail: one cell per day, above the hours.
              Above rather than among them on purpose. A deadline claims no minutes, so a band
              for it would either invent time the student does not owe or be buried under
              whatever really holds that hour. Here it is unmissable and it costs the grid
              nothing. The rail is drawn for the whole week whenever anything at all is due, so
              a day with nothing due reads as an empty cell in a rail rather than as a rail
              that is not there. */}
          {dueCount > 0 && <div />}
          {dueCount > 0 &&
            calendar.days.map((day) => (
              <div key={`due-${day.date}`} style={{ display: "grid", gap: "0.15rem", alignContent: "start" }}>
                {/* Never receded, unlike the bands below.
                    A band steps back when its class is switched off because it is an hour, and
                    the lens is about which hours to attend to. A deadline is a date, and a date
                    softened is a date half-hidden -- which is the failure this rail exists to
                    end. The week map leaves its unclaimed list at full strength for the same
                    reason, and the two views have to agree. */}
                {day.due.map((deadline) => (
                  <DueChip
                    key={deadline.workItemId}
                    deadline={deadline}
                    quest={quest}
                    course={coursesById.get(deadline.courseId)}
                  />
                ))}
              </div>
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
                  const session =
                    editable && slot.kind === "study" && slot.workItemId
                      ? sessionsByKey.get(`${slot.workItemId}:${slot.start}`) ?? null
                      : null;
                  return (
                    <Band
                      key={`${slot.kind}-${slot.start}`}
                      slot={slot}
                      base={base}
                      windowStart={calendar.windowStartMinute}
                      quest={quest}
                      course={slot.courseId ? coursesById.get(slot.courseId) : undefined}
                      receded={slot.courseId !== null && (hiddenCourseIds?.has(slot.courseId) ?? false)}
                      session={session}
                      selected={session !== null && session.id === selectedId}
                      onSelect={session ? () => setSelectedId(session.id) : undefined}
                      onKey={session ? (e) => onBandKey(session, e) : undefined}
                    />
                  );
                })}

                {/* A stated deadline, at its hour.
                    Only when a time was actually stated and it falls inside the drawn window:
                    a line at 23:59 would sit under the grid for most weeks, and "due Friday"
                    has no hour to point at in the first place. The chip above carries the
                    fact either way, so this is precision added to a statement already made
                    rather than the only place it appears -- which is what lets it be a hairline
                    and stay out of the way of the bands it crosses. */}
                {day.due
                  .filter(
                    (deadline) =>
                      deadline.timeStated &&
                      deadline.minuteOfDay >= calendar.windowStartMinute &&
                      deadline.minuteOfDay <= calendar.windowEndMinute,
                  )
                  .map((deadline) => (
                    <span
                      key={`line-${deadline.workItemId}`}
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top:
                          (deadline.minuteOfDay - calendar.windowStartMinute) * PIXELS_PER_MINUTE,
                        borderTop: "2px dashed var(--text)",
                      }}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>

      {editable && (
        <p id="calendar-block-help" className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.82rem" }}>
          Study blocks can be moved: pick one, then use the buttons, or the arrow keys on the
          block itself (up and down by a quarter hour, left and right by a day; L locks it in
          place so a replan leaves it alone).
        </p>
      )}

      {editable && selected && (
        <div
          className="calendar-block-tools"
          role="group"
          aria-label="Move or lock the selected study block"
          data-testid="calendar-block-tools"
        >
          <p style={{ margin: "0 0 0.4rem" }}>
            <strong>{itemsById.get(selected.workItemId)?.title ?? "Study"}</strong>
            <span className="muted">
              {" "}
              &middot; {describeWhen(selected)} &middot; {formatMinutes(selected.minutes)}
              {selected.locked && " · locked"}
            </span>
          </p>
          <div className="button-row">
            <button className="action" disabled={busy} onClick={() => void moveBy(selected, -NUDGE_MINUTES)}>
              Earlier
            </button>
            <button className="action" disabled={busy} onClick={() => void moveBy(selected, NUDGE_MINUTES)}>
              Later
            </button>
            <button className="action" disabled={busy} onClick={() => void moveBy(selected, -24 * 60)}>
              Previous day
            </button>
            <button className="action" disabled={busy} onClick={() => void moveBy(selected, 24 * 60)}>
              Next day
            </button>
            <button className="action" disabled={busy} onClick={() => void toggleLock(selected)} aria-pressed={selected.locked}>
              {selected.locked ? "Unlock" : "Lock in place"}
            </button>
            <button className="action" disabled={busy} onClick={() => setSelectedId(null)}>
              Done
            </button>
          </div>
          {editError && (
            <p className="error" role="alert" style={{ marginTop: "0.5rem" }}>
              {editError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** "Mon 9:00 AM", in the app's UTC wall clock. */
function describeWhen(session: PlannedSession): string {
  const d = new Date(session.startAt);
  return `${d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })} ${d.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit", timeZone: "UTC" },
  )}`;
}

/**
 * One deadline, on the day it is owed.
 *
 * Reads as a different object from a band and has to: a band is an hour you will spend, this
 * is a moment work is taken off you. So it is an outlined chip rather than a filled one, it
 * carries the word "due", and it sits outside the grid rather than inside it.
 *
 * Colour is never the only signal. The course tincture is an edge, the course code is printed
 * beside the title, and "nothing booked" is a *word* rather than a shade -- a student who
 * cannot tell two hues apart still reads the whole fact.
 */
function DueChip({
  deadline,
  quest,
  course,
}: {
  deadline: CalendarDeadline;
  quest: boolean;
  course: Course | undefined;
}) {
  const edge = course ? courseTincture(course.id, course.colorToken, quest) : "var(--text-dim)";
  const clock = deadline.timeStated ? clockOf(deadline.minuteOfDay) : null;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        // The course's own colour on the edge, the same place a study block carries it, so the
        // chip and the block for one assignment agree about which class they belong to.
        borderLeft: `3px solid ${edge}`,
        borderRadius: 4,
        /*
         * Outlined, never filled. `--surface-2` is the obvious chip ground and it is the wrong
         * one: the quest theme points it at dark leather for the page, and a card flips the
         * ground to parchment underneath it -- measured at 1.06:1 there, which is a fill nobody
         * can see and dark ink sitting on top of it. The codebase has already paid for that
         * once (see the note on `.question-course` in styles.css) and reached the same
         * conclusion: a border is the same separation and it survives every theme.
         */
        background: "transparent",
        color: "var(--text)",
        padding: "0.12rem 0.3rem",
        fontSize: "0.66rem",
        lineHeight: 1.25,
      }}
    >
      {/*
        The whole fact in one sentence for a screen reader, because the visual version is
        split across three lines and a chip read out as "Due 9am Response paper HIS 210 nothing
        booked" is a list of fragments rather than a statement.
      */}
      <span className="sr-only">
        Due{clock ? ` at ${clock}` : ""}: {deadline.title}
        {course ? `, ${course.code ?? course.name}` : ""}
        {deadline.nothingBooked ? ", with no study time booked this week" : ""}
      </span>
      <span aria-hidden="true">
        <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
          {/* No hour is printed when none was stated. The stored 23:59 is the *absence* of a
              time, and rendering it as one invites a student to work until half past eleven on
              a paper their instructor collects in a 9am lecture. */}
          Due{clock ? ` ${clock}` : ""}
        </span>
        <span style={{ display: "block", fontWeight: 600 }}>{deadline.title}</span>
        {course && <span style={{ display: "block" }}>{course.code ?? course.name}</span>}
        {deadline.nothingBooked && (
          <span style={{ display: "block", color: "var(--watch)", fontWeight: 700 }}>
            nothing booked
          </span>
        )}
      </span>
    </div>
  );
}

function Band({
  slot,
  base,
  windowStart,
  quest,
  course,
  receded,
  session,
  selected,
  onSelect,
  onKey,
}: {
  slot: CalendarSlot;
  base: number;
  windowStart: number;
  quest: boolean;
  course: Course | undefined;
  receded: boolean;
  /** The block behind a study band, when the grid is editable. */
  session?: PlannedSession | null;
  selected?: boolean;
  onSelect?: () => void;
  onKey?: (e: React.KeyboardEvent) => void;
}) {
  const interactive = Boolean(session && onSelect);
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

  return (
    <div
      {...(interactive
        ? {
            role: "button",
            tabIndex: 0,
            "aria-pressed": selected,
            "aria-describedby": "calendar-block-help",
            "data-session-id": session!.id,
            onClick: onSelect,
            onKeyDown: onKey,
          }
        : {})}
      style={{
        position: "absolute",
        left: 2,
        right: 2,
        top,
        height: Math.max(height - 1, 8),
        background: style.background,
        color: style.color,
        borderLeft: `3px solid ${receded ? "var(--border)" : edge}`,
        outline: selected ? "2px solid var(--accent)" : undefined,
        outlineOffset: selected ? 1 : undefined,
        cursor: interactive ? "pointer" : undefined,
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
        {session?.locked ? ", locked in place" : ""}
        {interactive ? ". Press Enter to select, arrow keys to move, L to lock." : ""}
      </span>
      {worthNaming && (
        <span aria-hidden="true">
          {/* No opacity anywhere in here. Dimming the time prefix with `opacity: 0.85`
              put it at 4.27:1 — the third time this codebase has shipped transparency as
              de-emphasis and measured below the floor for it. The band's own colour is
              already the quiet one; the prefix simply shares it. */}
          {slot.kind !== "free" && <span>{clockOf(slot.start - base)} </span>}
          {session?.locked && <span title="Locked in place">&#9646; </span>}
          {label}
          {course && height > 40 && (
            <span style={{ display: "block" }}>{course.code ?? course.name}</span>
          )}
        </span>
      )}
    </div>
  );
}
