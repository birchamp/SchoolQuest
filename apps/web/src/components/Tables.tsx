import { useMemo, useState } from "react";
import type { Course, ThemeName, WorkItem } from "@schoolquest/domain";
import { buildWeekCalendar, type SlotKind } from "@schoolquest/planning-engine";
import { api } from "../lib/api";
import { courseTincture } from "../lib/course-colour";
import type { PlanResponse } from "../lib/types";

/**
 * The same data, as rows.
 *
 * Every visual view here trades completeness for legibility — the week shows beats rather
 * than blocks, the arc shows landmarks rather than every date, the board shows one reason per
 * course. Those trades are right for a student who cannot hold nine things at once and wrong
 * for one who wants to scan, sort, and check. Neither is a fallback for the other.
 *
 * Two rules keep these honest rather than merely dense:
 *
 *  - **Sortable, because that is the whole reason to want a table.** A list you cannot
 *    reorder is a worse version of the visual view, not an alternative to it.
 *  - **Nothing appears here that is not on the visual view, and nothing is dropped.** A
 *    table is a different rendering of the same facts; if it needs a figure the map does not
 *    have, the map is missing something and that is the bug to fix.
 *
 * The assignments table is also the only place a due date can be corrected, which is why it
 * carries inputs rather than text: extraction gets dates wrong, and a plan built on a wrong
 * date is wrong in a way the student cannot see.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function courseLabel(course: Course | undefined): string {
  if (!course) return "—";
  return course.code && !course.name.includes(course.code)
    ? `${course.name} (${course.code})`
    : course.name;
}

/** A column header that sorts, and says which way it is sorting. */
function SortHeader<K extends string>({
  column,
  label,
  sort,
  onSort,
  numeric,
}: {
  column: K;
  label: string;
  sort: { key: K; desc: boolean };
  onSort: (key: K) => void;
  numeric?: boolean;
}) {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      style={{ textAlign: numeric ? "right" : "left" }}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
          fontWeight: active ? 800 : 600,
        }}
      >
        {label}
        <span aria-hidden="true">{active ? (sort.desc ? " ↓" : " ↑") : ""}</span>
      </button>
    </th>
  );
}

function useSort<K extends string>(initial: K) {
  const [sort, setSort] = useState<{ key: K; desc: boolean }>({ key: initial, desc: false });
  const onSort = (key: K) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: false }));
  return { sort, onSort };
}

function compare(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return 1; // Unknowns sort last, never as zero.
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/* ------------------------------------------------------------------ assignments */

type AssignmentKey = "title" | "course" | "type" | "due" | "effort" | "status";

/**
 * Every piece of work in the term, and the only place a date can be put right.
 *
 * Extraction reads dates out of a syllabus and is sometimes wrong; until now nothing in the
 * interface could change one. A plan built on a wrong date is wrong in a way the student
 * cannot see — the block simply sits in the wrong week — so this is not a convenience.
 */
export function AssignmentsTable({
  plan,
  theme,
  onChanged,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  onChanged: () => void;
}) {
  const quest = theme === "quest";
  const { sort, onSort } = useSort<AssignmentKey>("due");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);

  const rows = useMemo(() => {
    const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
    const list = plan.workItems
      .filter((w) => showDone || (w.status !== "completed" && w.status !== "canceled"))
      .map((item) => ({
        item,
        title: item.title,
        course: courseLabel(coursesById.get(item.courseId)),
        type: item.workType.replace(/_/g, " "),
        due: item.dueAt,
        effort: item.remainingMinutes ?? item.estimatedMinutes,
        status: item.status.replace(/_/g, " "),
      }));
    const key = sort.key;
    list.sort((a, b) => {
      const r = compare(a[key], b[key]);
      return sort.desc ? -r : r;
    });
    return list;
  }, [plan.workItems, plan.courses, sort, showDone]);

  async function saveDate(item: WorkItem, value: string) {
    setBusy(item.id);
    setError(null);
    try {
      // A date input gives a calendar day; the domain stores an instant. End of day is the
      // honest reading of "due Friday" and matches what extraction writes.
      await api.patch(`/api/work-items/${item.id}`, {
        dueAt: value ? `${value}T23:59:00.000Z` : null,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-labelledby="assignments-table-heading">
      <h2 id="assignments-table-heading">
        <span aria-hidden="true">{quest ? "Every task on the books" : "All assignments"}</span>
        <span className="sr-only">All assignments</span>
      </h2>
      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
        Change a due date here and the week is replanned around it. A date the syllabus never
        stated is shown empty rather than guessed.
      </p>

      <div className="button-row" style={{ marginBottom: "0.6rem" }}>
        <button className="action" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide finished" : "Show finished too"}
        </button>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader column="title" label="Assignment" sort={sort} onSort={onSort} />
              <SortHeader column="course" label="Course" sort={sort} onSort={onSort} />
              <SortHeader column="type" label="Type" sort={sort} onSort={onSort} />
              <SortHeader column="due" label="Due" sort={sort} onSort={onSort} />
              <SortHeader column="effort" label="Effort" sort={sort} onSort={onSort} numeric />
              <SortHeader column="status" label="Status" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, course, type, effort, status }) => (
              <tr key={item.id}>
                <th scope="row" style={{ fontWeight: 500 }}>
                  {item.title}
                  {item.sourceConfidence !== "confirmed" && (
                    <span className="muted" style={{ fontSize: "0.74rem", display: "block" }}>
                      date unconfirmed
                    </span>
                  )}
                </th>
                <td>{course}</td>
                <td style={{ textTransform: "capitalize" }}>{type}</td>
                <td>
                  <label>
                    <span className="sr-only">Due date for {item.title}</span>
                    <input
                      type="date"
                      disabled={busy === item.id}
                      value={edits[item.id] ?? (item.dueAt ? item.dueAt.slice(0, 10) : "")}
                      onChange={(e) =>
                        setEdits((s) => ({ ...s, [item.id]: e.target.value }))
                      }
                      onBlur={(e) => {
                        const next = e.target.value;
                        const current = item.dueAt ? item.dueAt.slice(0, 10) : "";
                        if (next !== current) void saveDate(item, next);
                      }}
                    />
                  </label>
                </td>
                <td style={{ textAlign: "right" }}>
                  {effort === null ? <span className="muted">—</span> : formatMinutes(effort)}
                </td>
                <td style={{ textTransform: "capitalize" }}>{status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">Nothing here yet.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ the week */

type BlockKey = "day" | "start" | "title" | "course" | "minutes" | "kind";

/** Every block of the week as rows, including the hours that are not study. */
export function WeekTable({ plan, theme }: { plan: PlanResponse; theme: ThemeName }) {
  const quest = theme === "quest";
  const { sort, onSort } = useSort<BlockKey>("start");
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
    const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
    const calendar = buildWeekCalendar({
      horizonStart: plan.horizonStart ?? plan.planVersion?.horizonStart ?? today,
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

    const KIND_WORD: Record<SlotKind, string> = {
      class: "Class",
      commitment: "Committed",
      meal: "Meal",
      study: "Study",
      free: "Free",
      off: "Off",
    };

    const list = calendar.days.flatMap((day) =>
      day.slots
        // Free time is real and shown on the calendar, but as rows it is dozens of lines
        // saying nothing. The totals line carries it instead.
        .filter((slot) => slot.kind !== "free")
        .map((slot) => {
          const base = Date.parse(`${day.date}T00:00:00Z`) / 60_000;
          return {
            id: `${day.date}-${slot.kind}-${slot.start}`,
            day: day.date,
            dayOfWeek: day.dayOfWeek,
            start: slot.start,
            startLabel: new Date(slot.start * 60_000).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
              timeZone: "UTC",
            }),
            minuteOfDay: slot.start - base,
            title: slot.title ?? KIND_WORD[slot.kind],
            course: slot.courseId ? courseLabel(coursesById.get(slot.courseId)) : "—",
            minutes: slot.minutes,
            kind: KIND_WORD[slot.kind],
          };
        }),
    );
    const key = sort.key;
    list.sort((a, b) => {
      const r = compare(a[key === "day" ? "day" : key], b[key === "day" ? "day" : key]);
      return sort.desc ? -r : r;
    });
    return { list, totals: calendar.totals };
  }, [plan, sort, today]);

  return (
    <section className="card" aria-labelledby="week-table-heading">
      <h2 id="week-table-heading">
        <span aria-hidden="true">{quest ? "The week, as a ledger" : "This week, as rows"}</span>
        <span className="sr-only">This week, as rows</span>
      </h2>
      <p className="muted" style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>
        study {formatMinutes(rows.totals.study)} · class {formatMinutes(rows.totals.class)} ·
        committed {formatMinutes(rows.totals.commitment)} · meals{" "}
        {formatMinutes(rows.totals.meal)} · free {formatMinutes(rows.totals.free)}
      </p>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader column="day" label="Day" sort={sort} onSort={onSort} />
              <SortHeader column="start" label="Starts" sort={sort} onSort={onSort} />
              <SortHeader column="kind" label="What" sort={sort} onSort={onSort} />
              <SortHeader column="title" label="Detail" sort={sort} onSort={onSort} />
              <SortHeader column="course" label="Course" sort={sort} onSort={onSort} />
              <SortHeader column="minutes" label="Length" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {rows.list.map((row) => (
              <tr key={row.id}>
                <td>
                  {DAY_NAMES[row.dayOfWeek]} {Number(row.day.slice(8, 10))}
                </td>
                <td>{row.startLabel}</td>
                <td>{row.kind}</td>
                <th scope="row" style={{ fontWeight: 500 }}>
                  {row.title}
                </th>
                <td>{row.course}</td>
                <td style={{ textAlign: "right" }}>{formatMinutes(row.minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.list.length === 0 && <p className="muted">Nothing is booked this week.</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ what is coming */

type AheadKey = "due" | "title" | "course" | "days" | "prep";

/** The term's landmarks as rows — the arc's data, sortable and complete. */
export function LookaheadTable({ plan, theme }: { plan: PlanResponse; theme: ThemeName }) {
  const quest = theme === "quest";
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const { sort, onSort } = useSort<AheadKey>("due");
  const brief = plan.brief;

  const rows = useMemo(() => {
    const byId = new Map(plan.courses.map((c) => [c.id, c]));
    const dated = (brief?.milestones ?? []).map((m) => ({
      id: m.workItemId,
      title: m.title,
      course: courseLabel(byId.get(m.courseId)),
      courseId: m.courseId,
      due: m.dueAt,
      days: m.daysAway,
      prep: m.prepMinutes,
      confirmed: m.dueConfirmed,
    }));
    const undated = (brief?.undatedMilestones ?? []).map((m) => ({
      id: m.workItemId,
      title: m.title,
      course: courseLabel(byId.get(m.courseId)),
      courseId: m.courseId,
      due: null,
      days: null,
      prep: m.prepMinutes,
      confirmed: false,
    }));
    const list = [...dated, ...undated];
    const key = sort.key;
    list.sort((a, b) => {
      const r = compare(a[key], b[key]);
      return sort.desc ? -r : r;
    });
    return list;
  }, [brief, plan.courses, sort]);

  return (
    <section className="card" aria-labelledby="ahead-table-heading">
      <h2 id="ahead-table-heading">
        <span aria-hidden="true">{quest ? "Set pieces ahead" : "What is coming"}</span>
        <span className="sr-only">What is coming</span>
      </h2>
      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
        Every major piece of work in the term. Prep is the time already booked toward it —
        zero means nothing has been set aside yet.
      </p>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader column="title" label="What" sort={sort} onSort={onSort} />
              <SortHeader column="course" label="Course" sort={sort} onSort={onSort} />
              <SortHeader column="due" label="Due" sort={sort} onSort={onSort} />
              <SortHeader column="days" label="Days away" sort={sort} onSort={onSort} numeric />
              <SortHeader column="prep" label="Prep booked" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" style={{ fontWeight: 500 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      marginRight: "0.4rem",
                      background: courseTincture(
                        row.courseId,
                        coursesById.get(row.courseId)?.colorToken,
                        quest,
                      ),
                    }}
                  />
                  {row.title}
                </th>
                <td>{row.course}</td>
                <td>
                  {row.due ? (
                    <>
                      {new Date(row.due).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                      {!row.confirmed && (
                        <span className="muted" style={{ fontSize: "0.74rem" }}>
                          {" "}
                          (unconfirmed)
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">no date known</span>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {row.days === null ? <span className="muted">—</span> : row.days}
                </td>
                <td style={{ textAlign: "right" }}>{formatMinutes(row.prep)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">Nothing major is on the books yet.</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ courses */

type CourseKey = "course" | "level" | "booked" | "open" | "due" | "grade";

/** The dashboard's board as rows. */
export function CoursesTable({ plan, theme }: { plan: PlanResponse; theme: ThemeName }) {
  const quest = theme === "quest";
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const { sort, onSort } = useSort<CourseKey>("level");
  const health = plan.health;

  const rows = useMemo(() => {
    const byId = new Map(plan.courses.map((c) => [c.id, c]));
    const list = (health?.courses ?? []).map((row) => ({
      id: row.courseId,
      course: courseLabel(byId.get(row.courseId)),
      level: row.level === "at_risk" ? 0 : row.level === "needs_attention" ? 1 : 2,
      levelWord:
        row.level === "at_risk"
          ? "Needs a decision"
          : row.level === "needs_attention"
            ? "Needs attention"
            : "On track",
      booked: row.bookedMinutes,
      open: row.openItems,
      due: row.nextDueAt,
      dueTitle: row.nextDueTitle,
      grade: row.gradePercent,
      gradedCount: row.gradedCount,
      gradedWeightFraction: row.gradedWeightFraction,
      concerns: row.concerns,
    }));
    const key = sort.key;
    list.sort((a, b) => {
      const r = compare(a[key], b[key]);
      return sort.desc ? -r : r;
    });
    return list;
  }, [health, plan.courses, sort]);

  if (rows.length === 0) return null;

  return (
    <section className="card" aria-labelledby="courses-table-heading">
      <h2 id="courses-table-heading">
        <span aria-hidden="true">{quest ? "The table, as a ledger" : "Courses, as rows"}</span>
        <span className="sr-only">Courses, as rows</span>
      </h2>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader column="course" label="Course" sort={sort} onSort={onSort} />
              <SortHeader column="level" label="State" sort={sort} onSort={onSort} />
              <SortHeader column="booked" label="This week" sort={sort} onSort={onSort} numeric />
              <SortHeader column="open" label="Open" sort={sort} onSort={onSort} numeric />
              <SortHeader column="due" label="Next due" sort={sort} onSort={onSort} />
              <SortHeader column="grade" label="Standing" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" style={{ fontWeight: 500 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      marginRight: "0.4rem",
                      background: courseTincture(
                        row.id,
                        coursesById.get(row.id)?.colorToken,
                        quest,
                      ),
                    }}
                  />
                  {row.course}
                  {row.concerns[0] && (
                    <span className="muted" style={{ display: "block", fontSize: "0.76rem" }}>
                      {row.concerns[0].detail}
                    </span>
                  )}
                </th>
                <td>{row.levelWord}</td>
                <td style={{ textAlign: "right" }}>{formatMinutes(row.booked)}</td>
                <td style={{ textAlign: "right" }}>{row.open}</td>
                <td>
                  {row.due ? (
                    <>
                      {new Date(row.due).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                      {row.dueTitle && (
                        <span className="muted" style={{ display: "block", fontSize: "0.76rem" }}>
                          {row.dueTitle}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {row.grade === null ? (
                    <span className="muted">no grades yet</span>
                  ) : (
                    <>
                      {Math.round(row.grade)}%
                      {/* Never a percentage without its basis. */}
                      <span className="muted" style={{ display: "block", fontSize: "0.74rem" }}>
                        {row.gradedWeightFraction > 0
                          ? `${Math.round(row.gradedWeightFraction * 100)}% graded`
                          : `${row.gradedCount} result${row.gradedCount === 1 ? "" : "s"}`}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
