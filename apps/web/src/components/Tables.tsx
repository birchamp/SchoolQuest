import { Fragment, useMemo, useState } from "react";
import type { Course, ThemeName, WorkItem } from "@schoolquest/domain";
import {
  buildWeekCalendar,
  DEFAULT_EFFORT_MINUTES,
  type SlotKind,
} from "@schoolquest/planning-engine";
import { api } from "../lib/api";
import { courseTincture } from "../lib/course-colour";
import { openDeadlines } from "../lib/deadlines";
import {
  composeDueAt,
  DEFAULT_DUE_TIME,
  dueDatePart,
  dueTimePart,
  formatDueDay,
} from "../lib/due-time";
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
 * The assignments table is also where work is *changed*, which is why it carries inputs rather
 * than text. A syllabus is a forecast, not a record: an instructor moves an exam, announces a
 * paper in class, or drops a chapter, and none of that is in the PDF. Three things happen in a
 * lecture and all three land here -- a new date, a new task, a task dropped.
 *
 * Kept in one table rather than spread across three screens, because they are one job: the
 * student is reconciling what was said in class against what the app believes. Splitting that
 * across a date field here, an add form there and a delete somewhere else is how two of the
 * three never get done.
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

/**
 * The course code alone, where a column has to stay narrow.
 *
 * Spelled out in the assignments table, "United States History to 1877 (HIS 210)" wrapped
 * over five lines in every row and pushed that row's own controls off the right of the
 * table. The full name is still there, on the cell's title.
 */
function shortCourse(course: Course | undefined): string {
  return course?.code ?? course?.name ?? "—";
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

type AssignmentKey = "title" | "course" | "type" | "due" | "effort" | "worth" | "status";

/**
 * Every piece of work in the term: the only place a date can be put right, the only place
 * to say a thing is handed in, and where its score is written down whenever it comes back.
 *
 * Extraction reads dates out of a syllabus and is sometimes wrong; nothing else in the
 * interface can change one. A plan built on a wrong date is wrong in a way the student
 * cannot see — the block simply sits in the wrong week — so this is not a convenience.
 *
 * The other two belong here for the same reason. Finishing work could only be said by
 * completing a *study block*, which is a different claim: work gets handed in during a
 * lecture, on a phone, in a session nobody booked, or after an evening that was never on
 * the plan. And the result usually lands weeks after the hand-in, by which time the student
 * is not looking at anything to do with that assignment — so the row that knows about it
 * has to be the row that accepts it.
 */
/** The per-type effort the planner falls back to when nobody has said, formatted for a cell. */
function assumedEffortLabel(workType: string): string {
  const mins = DEFAULT_EFFORT_MINUTES[workType] ?? 60;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

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
  const [times, setTimes] = useState<Record<string, string>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  /** The item whose delete is waiting on a yes, or null. */
  const [deleting, setDeleting] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, { earned: string; outOf: string }>>({});
  const [efforts, setEfforts] = useState<Record<string, string>>({});
  const [worths, setWorths] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);

  /**
   * Which items already carry a result, and what it was.
   *
   * A grade is its own record, not a field on the item: work can sit handed in for weeks
   * with nothing against it, which is the whole gap the score box fills. Without this the
   * row would go on asking for a number the student had already given it.
   */
  const gradedIds = useMemo(
    () => new Set((plan.grades ?? []).map((g) => g.workItemId)),
    [plan.grades],
  );
  const gradesByItem = useMemo(
    () => new Map((plan.grades ?? []).map((g) => [g.workItemId, g])),
    [plan.grades],
  );

  /**
   * The grading category behind each item, so a blank Worth cell can still say what the item is
   * worth by its category weight -- "35% - Research Paper" -- which is what most syllabi actually
   * state instead of per-item points.
   */
  const categoryById = useMemo(
    () => new Map((plan.gradingCategories ?? []).map((c) => [c.id, c])),
    [plan.gradingCategories],
  );

  const rows = useMemo(() => {
    const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
    const list = plan.workItems
      // Handed-in work stays on the list by default: it is the one finished state with
      // something still owed on it -- a result -- and hiding it is how a score never gets
      // written down. It drops off once the grade is in.
      .filter(
        (w) =>
          showDone ||
          (w.status === "submitted" && !gradedIds.has(w.id)) ||
          (w.status !== "completed" && w.status !== "submitted" && w.status !== "canceled"),
      )
      .map((item) => ({
        item,
        title: item.title,
        course: courseLabel(coursesById.get(item.courseId)),
        code: shortCourse(coursesById.get(item.courseId)),
        type: item.workType.replace(/_/g, " "),
        due: item.dueAt,
        effort: item.remainingMinutes ?? item.estimatedMinutes,
        worth: item.pointsPossible,
        status: item.status.replace(/_/g, " "),
      }));
    const key = sort.key;
    list.sort((a, b) => {
      const r = compare(a[key], b[key]);
      return sort.desc ? -r : r;
    });
    return list;
  }, [plan.workItems, plan.courses, sort, showDone, gradedIds]);

  async function saveEffort(item: WorkItem, value: string) {
    const trimmed = value.trim();
    const minutes = trimmed === "" ? null : Number(trimmed);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes <= 0)) {
      setError("Effort is whole minutes, or empty for unknown.");
      return;
    }
    const current = item.remainingMinutes ?? item.estimatedMinutes;
    if (minutes === current) return;
    setBusy(item.id);
    setError(null);
    try {
      await api.patch(`/api/work-items/${item.id}`, { estimatedMinutes: minutes });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  async function saveWorth(item: WorkItem, value: string) {
    const trimmed = value.trim();
    const points = trimmed === "" ? null : Number(trimmed);
    if (points !== null && (!Number.isFinite(points) || points < 0)) {
      setError("Worth is points, or empty for unknown.");
      return;
    }
    if (points === item.pointsPossible) return;
    setBusy(item.id);
    setError(null);
    try {
      await api.patch(`/api/work-items/${item.id}`, { pointsPossible: points });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  /** A graded item whose score is open for correction, or null. */
  const [editingGrade, setEditingGrade] = useState<string | null>(null);

  /** Opens the score box on a graded row, prefilled with the number already recorded. */
  function startEditGrade(item: WorkItem) {
    const grade = gradesByItem.get(item.id);
    setScores((s) => ({
      ...s,
      [item.id]: {
        earned: grade?.pointsEarned != null ? String(grade.pointsEarned) : "",
        outOf: grade?.pointsPossible != null ? String(grade.pointsPossible) : "",
      },
    }));
    setEditingGrade(item.id);
  }

  async function clearGrade(item: WorkItem) {
    setBusy(item.id);
    setError(null);
    try {
      await api.del(`/api/work-items/${item.id}/grade`);
      setEditingGrade(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  async function saveScore(item: WorkItem) {
    const entry = scores[item.id];
    const earned = Number(entry?.earned);
    // An *empty* total falls back to what the syllabus said the thing was out of, which is
    // usually right and always editable. Only empty: `||` would also swallow a typed "0",
    // and silently grading 42/100 when the student wrote 42/0 is worse than the error.
    const outOfTyped = (entry?.outOf ?? "").trim();
    const outOf = outOfTyped === "" ? (item.pointsPossible ?? NaN) : Number(outOfTyped);
    if (!Number.isFinite(earned) || !Number.isFinite(outOf) || outOf <= 0) {
      setError("A score needs a number, and a total to be out of.");
      return;
    }
    setBusy(item.id);
    setError(null);
    try {
      await api.put(`/api/work-items/${item.id}/grade`, {
        pointsEarned: earned,
        pointsPossible: outOf,
      });
      setScores((s) => ({ ...s, [item.id]: { earned: "", outOf: "" } }));
      setEditingGrade(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Saves the two halves of a deadline as the one instant the domain stores.
   *
   * Both boxes write through here, so editing the date cannot lose a stated time and editing the
   * time cannot move the date -- they are read back out of the same string on the next render.
   * End of day stays the reading of a date given with no time, which is what "due Friday" means
   * and what extraction writes when the syllabus is silent.
   */
  async function saveDue(item: WorkItem, date: string, time: string) {
    const next = composeDueAt(date, time);
    if (next === (item.dueAt ?? null)) return;
    setBusy(item.id);
    setError(null);
    try {
      await api.patch(`/api/work-items/${item.id}`, { dueAt: next });
      // Show what was actually stored: a cleared or half-typed clock saves as end of day, and a
      // box still reading "--:--" over a row due at 11:59 is a lie about the record.
      setEdits((s) => ({ ...s, [item.id]: dueDatePart(next) }));
      setTimes((s) => ({ ...s, [item.id]: dueTimePart(next) }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  async function saveTitle(item: WorkItem, value: string) {
    const next = value.trim();
    if (next.length === 0 || next === item.title) return;
    setBusy(item.id);
    setError(null);
    try {
      await api.patch(`/api/work-items/${item.id}`, { title: next });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * "Not doing it" is a status, not a delete. So is handing something in.
   *
   * "We are not doing chapter 7" is a fact about this term that can be reversed next week, and a
   * row that vanishes takes its history with it -- what it was worth, what was already done
   * against it, whether it was ever graded. `canceled` keeps the record and takes it out of the
   * plan, and "Show finished and canceled too" is how it is found again. Work that was never assigned at all
   * is the other case, and `deleteItem` below is the answer to that one.
   *
   * `submitted` is the same move for the opposite reason: the work is gone from the student's
   * hands but not from the term, because a result is still owed on it. The API releases the
   * blocks still held for it, the same way finishing a study session does.
   */
  async function setStatus(item: WorkItem, status: "canceled" | "not_started" | "submitted") {
    setBusy(item.id);
    setError(null);
    try {
      await api.patch(`/api/work-items/${item.id}`, { status });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Removing work that was never assigned, which "not doing it" cannot say.
   *
   * The two are different claims, so the table offers both. Cancelling keeps a real assignment
   * this term will not do -- with what it was worth and what was already done against it -- and
   * "Show finished and canceled too" is how it is found again. Deleting is for a row that should
   * not exist at all: extraction reading a syllabus table that was not one, the same midterm
   * confirmed twice under two names, a task typed into the wrong course. Left as cancelled those
   * pile up, and a list carrying every mistake anyone ever made is one the student stops reading,
   * which costs more than the record was ever worth.
   */
  async function deleteItem(item: WorkItem) {
    setBusy(item.id);
    setError(null);
    try {
      await api.del(`/api/work-items/${item.id}`);
      setDeleting(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not delete.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card wide-card" aria-labelledby="assignments-table-heading">
      <h2 id="assignments-table-heading">
        <span aria-hidden="true">{quest ? "Every task on the books" : "All assignments"}</span>
        <span className="sr-only">All assignments</span>
      </h2>
      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
        When an instructor moves a date, sets something new, or drops a task, change it here and the
        week is replanned around it. A date the syllabus never stated is shown empty rather than
        guessed, and a deadline with no stated hour is taken as the end of that day until you say
        otherwise. &ldquo;Not doing it&rdquo; keeps the record; Delete is for work that was never
        really there.
      </p>

      <div className="button-row" style={{ marginBottom: "0.6rem" }}>
        <button className="action primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add an assignment"}
        </button>
        <button className="action" onClick={() => setShowDone((v) => !v)}>
          {/* "Canceled" rather than "skipped": skipping is what Today does to one study block,
              and it is the word this table's own Status column prints for these rows. */}
          {showDone ? "Hide finished and canceled" : "Show finished and canceled too"}
        </button>
      </div>

      {adding && (
        <AddAssignmentForm
          courses={plan.courses}
          onAdded={() => {
            setAdding(false);
            onChanged();
          }}
          onError={setError}
        />
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader column="title" label="Assignment" sort={sort} onSort={onSort} />
              <SortHeader column="course" label="Course" sort={sort} onSort={onSort} />
              <SortHeader column="type" label="Type" sort={sort} onSort={onSort} />
              <SortHeader column="due" label="Due" sort={sort} onSort={onSort} />
              <SortHeader column="effort" label="Effort" sort={sort} onSort={onSort} numeric />
              <SortHeader column="worth" label="Worth" sort={sort} onSort={onSort} numeric />
              <SortHeader column="status" label="Status" sort={sort} onSort={onSort} />
              <th scope="col" style={{ textAlign: "right" }}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, course, code, type, effort, status }) => (
              // Keyed on the fragment rather than the row: a row awaiting a delete grows a
              // second <tr> for the confirmation, and both belong to the same item.
              <Fragment key={item.id}>
                {/* Anchored so the radar can send the reader straight to the row it is talking
                    about rather than to the top of a table of forty. */}
                <tr id={`work-item-${item.id}`}>
                  <th scope="row" style={{ fontWeight: 500 }}>
                    {/* Editable, because "the paper is now an annotated bibliography" is a thing
                        instructors say, and a title nobody can correct is one the student stops
                        trusting the whole list over. */}
                    <label>
                      <span className="sr-only">Name of {item.title}</span>
                      <input
                        type="text"
                        disabled={busy === item.id}
                        value={titles[item.id] ?? item.title}
                        onChange={(e) => setTitles((t) => ({ ...t, [item.id]: e.target.value }))}
                        onBlur={(e) => void saveTitle(item, e.target.value)}
                        /* Wide enough to read a real title. Rendered at 12rem, "Settle the topic and re-read
                            the" was cut mid-phrase, which makes the column useless for telling two
                            milestones of the same project apart. */
                        style={{ width: "100%", minWidth: "18rem", fontWeight: 500 }}
                      />
                    </label>
                    {item.sourceConfidence !== "confirmed" && (
                      <span className="muted" style={{ fontSize: "0.74rem", display: "block" }}>
                        date unconfirmed
                      </span>
                    )}
                  </th>
                  <td style={{ whiteSpace: "nowrap" }} title={course}>
                    {code}
                  </td>
                  <td style={{ textTransform: "capitalize" }}>{type}</td>
                  {/* Day and time of day together, because an instructor announces them together
                      -- "the quiz closes Friday at nine". The clock is what the planner schedules
                      against: with every deadline pinned to the end of its day, the whole morning
                      before a 9am close read as time still available to work in. */}
                  <td>
                    <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                      <label>
                        <span className="sr-only">Due date for {item.title}</span>
                        <input
                          type="date"
                          disabled={busy === item.id}
                          value={edits[item.id] ?? dueDatePart(item.dueAt)}
                          onChange={(e) => setEdits((s) => ({ ...s, [item.id]: e.target.value }))}
                          onBlur={(e) =>
                            void saveDue(
                              item,
                              e.target.value,
                              times[item.id] ?? dueTimePart(item.dueAt),
                            )
                          }
                        />
                      </label>
                      <label>
                        <span className="sr-only">Time of day {item.title} is due</span>
                        <input
                          type="time"
                          /* An undated item has no time to set: a clock with no day cannot be
                             stored, and a live box invites typing into one that will not hold it. */
                          disabled={
                            busy === item.id || (edits[item.id] ?? dueDatePart(item.dueAt)) === ""
                          }
                          value={times[item.id] ?? dueTimePart(item.dueAt)}
                          onChange={(e) => setTimes((s) => ({ ...s, [item.id]: e.target.value }))}
                          onBlur={(e) =>
                            void saveDue(
                              item,
                              edits[item.id] ?? dueDatePart(item.dueAt),
                              e.target.value,
                            )
                          }
                          style={{ width: "7.5rem" }}
                        />
                      </label>
                    </div>
                    {/* No note under the clock, deliberately.
                        It used to say "end of day assumed" whenever the time read 23:59, meaning
                        to present the default as an assumption worth correcting. But 11:59pm is
                        the commonest deadline a syllabus actually states, and the app cannot tell
                        a stated one from a filled-in one -- both are the same five characters --
                        so on a great many rows it was telling the student their own confirmed
                        answer had been guessed. A note that is wrong that often is worse than no
                        note: the box beside it already says 23:59, which is the true part.
                        Saying it honestly would take remembering where the time came from, which
                        is a stored fact nobody records yet. */}
                  </td>
                  {/* Both editable, because both are instructor announcements. "The quiz is
                      now worth 50" moves this assignment's size on the radar and its pull on
                      the grade; "plan two hours, not one" is the student correcting the one
                      number the whole schedule is built from. The effort survey only ever
                      asks about work with no estimate at all, so without this cell a wrong
                      estimate could never be corrected. */}
                  <td style={{ textAlign: "right" }}>
                    <label>
                      <span className="sr-only">Effort in minutes for {item.title}</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        placeholder="?"
                        style={{ width: "4.5rem", textAlign: "right" }}
                        disabled={
                          busy === item.id ||
                          item.status === "completed" ||
                          item.status === "submitted"
                        }
                        value={efforts[item.id] ?? (effort === null ? "" : String(effort))}
                        onChange={(e) => setEfforts((s) => ({ ...s, [item.id]: e.target.value }))}
                        onBlur={(e) => void saveEffort(item, e.target.value)}
                      />
                    </label>
                    {/* Blank does not mean zero: the planner is already using a per-type assumption.
                        Showing it makes the "?" a number to confirm rather than a hole to fill. */}
                    {effort === null &&
                      item.status !== "completed" &&
                      item.status !== "submitted" && (
                        <span className="muted" style={{ fontSize: "0.72rem", display: "block" }}>
                          ~{assumedEffortLabel(item.workType)} assumed
                        </span>
                      )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <label>
                      <span className="sr-only">Points {item.title} is worth</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        placeholder="?"
                        style={{ width: "4.5rem", textAlign: "right" }}
                        disabled={busy === item.id}
                        value={
                          worths[item.id] ??
                          (item.pointsPossible === null ? "" : String(item.pointsPossible))
                        }
                        onChange={(e) => setWorths((s) => ({ ...s, [item.id]: e.target.value }))}
                        onBlur={(e) => void saveWorth(item, e.target.value)}
                      />
                    </label>
                    {/* No per-item points is the common case: most syllabi weight by category. Show
                        that weight so the cell says what the item is worth rather than nothing. */}
                    {item.pointsPossible === null &&
                      (() => {
                        const cat = item.gradingCategoryId
                          ? categoryById.get(item.gradingCategoryId)
                          : null;
                        return cat && cat.weightPercent !== null ? (
                          <span className="muted" style={{ fontSize: "0.72rem", display: "block" }}>
                            {cat.weightPercent}% &middot; {cat.name}
                          </span>
                        ) : null;
                      })()}
                  </td>
                  <td style={{ textTransform: "capitalize" }}>
                    {status}
                    {/* The result, once it exists. Shown rather than re-asked: a row that goes
                        on offering an empty score box after the number is in reads as though
                        nothing was saved. */}
                    {gradesByItem.get(item.id)?.pointsEarned != null && (
                      <span className="muted" style={{ display: "block", fontSize: "0.74rem" }}>
                        scored {gradesByItem.get(item.id)!.pointsEarned} /{" "}
                        {gradesByItem.get(item.id)!.pointsPossible}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {/* Handed in and still waiting on a result -- or a recorded score reopened to
                        correct it. Either way the only thing to do is write the number down.
                        Weeks can pass in the waiting case, which is why it stays on the list. */}
                    {(item.status === "submitted" && !gradedIds.has(item.id)) ||
                    editingGrade === item.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveScore(item);
                        }}
                        style={{ display: "inline-flex", gap: "0.25rem", alignItems: "center" }}
                      >
                        <label>
                          <span className="sr-only">Points earned on {item.title}</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            inputMode="decimal"
                            placeholder="score"
                            style={{ width: "4.5rem" }}
                            disabled={busy === item.id}
                            value={scores[item.id]?.earned ?? ""}
                            onChange={(e) =>
                              setScores((prev) => ({
                                ...prev,
                                [item.id]: {
                                  earned: e.target.value,
                                  outOf: prev[item.id]?.outOf ?? "",
                                },
                              }))
                            }
                          />
                        </label>
                        <span aria-hidden="true">/</span>
                        <label>
                          <span className="sr-only">Out of, for {item.title}</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            inputMode="decimal"
                            placeholder={
                              item.pointsPossible ? String(item.pointsPossible) : "total"
                            }
                            style={{ width: "4.5rem" }}
                            disabled={busy === item.id}
                            value={scores[item.id]?.outOf ?? ""}
                            onChange={(e) =>
                              setScores((prev) => ({
                                ...prev,
                                [item.id]: {
                                  earned: prev[item.id]?.earned ?? "",
                                  outOf: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <button className="action" type="submit" disabled={busy === item.id}>
                          Save
                        </button>
                        {editingGrade === item.id ? (
                          <button
                            className="action"
                            type="button"
                            disabled={busy === item.id}
                            onClick={() => setEditingGrade(null)}
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            className="action"
                            type="button"
                            disabled={busy === item.id}
                            onClick={() => void setStatus(item, "not_started")}
                            title="Not handed in after all; puts its study time back on the plan"
                          >
                            Not yet
                          </button>
                        )}
                      </form>
                    ) : gradedIds.has(item.id) ? (
                      <>
                        <button
                          className="action"
                          disabled={busy === item.id}
                          onClick={() => startEditGrade(item)}
                          title="Correct the recorded score"
                        >
                          Edit grade
                        </button>{" "}
                        <button
                          className="action"
                          disabled={busy === item.id}
                          onClick={() => void clearGrade(item)}
                          title="Remove the recorded score; the row waits on a result again"
                        >
                          Clear grade
                        </button>
                      </>
                    ) : item.status === "canceled" ? (
                      <button
                        className="action"
                        disabled={busy === item.id}
                        onClick={() => void setStatus(item, "not_started")}
                      >
                        Put back
                      </button>
                    ) : item.status === "completed" ? (
                      <span className="muted">done</span>
                    ) : (
                      <>
                        <button
                          className="action"
                          disabled={busy === item.id}
                          onClick={() => void setStatus(item, "submitted")}
                          title="Frees the study time still booked for it; the score can wait"
                        >
                          Handed in
                        </button>{" "}
                        {/* Not "Skip": skipping is what Today does to a single study block, and one
                            word meaning "not this hour" on one screen and "not this term" on another
                            is how a student cancels work they only meant to postpone. */}
                        <button
                          className="action"
                          disabled={busy === item.id}
                          onClick={() => void setStatus(item, "canceled")}
                          title="Takes it out of the plan and keeps the record"
                        >
                          Not doing it
                        </button>
                      </>
                    )}{" "}
                    {/* Offered on every row, finished ones included: the commonest thing to delete
                        is a duplicate the extractor made, and confirming its twin marks it done. */}
                    <button
                      className="action"
                      disabled={busy === item.id}
                      onClick={() => setDeleting(deleting === item.id ? null : item.id)}
                      title="Removes it from the term entirely"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {deleting === item.id && (
                  <tr>
                    <td colSpan={8}>
                      <div
                        className="replace-confirm"
                        role="alertdialog"
                        aria-label={`Confirm deleting ${item.title}`}
                      >
                        <p style={{ margin: "0 0 0.4rem" }}>
                          Delete <strong>{item.title}</strong>?
                        </p>
                        <p className="muted" style={{ margin: "0 0 0.6rem" }}>
                          This takes it out of the term for good, with any stages it was broken
                          into, the study time booked for it and any score recorded against it. It
                          cannot be undone. To drop it from the plan but keep the record, use
                          &ldquo;Not doing it&rdquo; instead.
                        </p>
                        <div className="button-row">
                          <button
                            className="action primary"
                            disabled={busy === item.id}
                            onClick={() => void deleteItem(item)}
                          >
                            Delete it
                          </button>
                          <button
                            className="action"
                            disabled={busy === item.id}
                            onClick={() => setDeleting(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
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
      // The same deadlines the grid draws. The rule at the top of this file is that the table
      // and the visual view are two renderings of one set of facts; a "Due" mark the grid
      // carries and the ledger does not is that rule broken in the direction the ledger reader
      // notices last, because a missing row looks like a week with nothing due in it.
      deadlines: openDeadlines(plan.workItems),
    });

    const KIND_WORD: Record<SlotKind, string> = {
      class: "Class",
      commitment: "Committed",
      meal: "Meal",
      study: "Study",
      free: "Free",
      off: "Off",
    };

    const clock = (epochMinutes: number) =>
      new Date(epochMinutes * 60_000).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      });

    const blocks = calendar.days.flatMap((day) =>
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
            startLabel: clock(slot.start),
            minuteOfDay: slot.start - base,
            title: slot.title ?? KIND_WORD[slot.kind],
            course: slot.courseId ? courseLabel(coursesById.get(slot.courseId)) : "—",
            minutes: slot.minutes,
            kind: KIND_WORD[slot.kind],
          };
        }),
    );

    /**
     * A deadline is a row here too, with no length.
     *
     * `Length` is deliberately blank rather than zero: the column is minutes of the week
     * spent, and a deadline spends none of them, so a 0 would be added up by a reader
     * scanning the column and a dash would not. Sorting by Starts still puts it where it
     * belongs in the day, because a deadline does happen at a time even when it takes none.
     */
    const due = calendar.days.flatMap((day) =>
      day.due.map((deadline) => ({
        id: `${day.date}-due-${deadline.workItemId}`,
        day: day.date,
        dayOfWeek: day.dayOfWeek,
        start: deadline.at,
        // No hour printed unless one was stated: the stored 23:59 is the absence of a time,
        // and a ledger that prints it as one is the reason to work until 23:30 on something
        // collected at 9am.
        startLabel: deadline.timeStated ? clock(deadline.at) : "—",
        minuteOfDay: deadline.minuteOfDay,
        title: deadline.nothingBooked ? `${deadline.title} — nothing booked` : deadline.title,
        course: courseLabel(coursesById.get(deadline.courseId)),
        minutes: null as number | null,
        kind: "Due",
      })),
    );

    const list = [...blocks, ...due];
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
        committed {formatMinutes(rows.totals.commitment)} · meals {formatMinutes(rows.totals.meal)}{" "}
        · free {formatMinutes(rows.totals.free)}
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
                <td style={{ textAlign: "right" }}>
                  {row.minutes === null ? (
                    <span className="muted">—</span>
                  ) : (
                    formatMinutes(row.minutes)
                  )}
                </td>
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
        Every major piece of work in the term. Prep is the time already booked toward it — zero
        means nothing has been set aside yet.
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
                      {formatDueDay(row.due)}
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
                      {formatDueDay(row.due)}
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
                      {Math.round(row.grade)}%{/* Never a percentage without its basis. */}
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

/**
 * Work an instructor set in class, which is in no syllabus.
 *
 * The commonest real change and the one with no path at all before this: a paper announced on a
 * Tuesday exists nowhere in the PDF, so the plan simply did not know about it, and a plan
 * missing a quarter of the work is worse than no plan -- it is confidently wrong.
 *
 * Deliberately small. A course, a name, a date and roughly how long: enough for the scheduler to
 * place it, and nothing that would turn a thirty-second entry between classes into a form. The
 * time of day comes prefilled with end of day and is only touched when the instructor said an
 * hour. Everything else has a sensible default and can be corrected in the table afterwards.
 */
function AddAssignmentForm({
  courses,
  onAdded,
  onError,
}: {
  courses: Course[];
  onAdded: () => void;
  onError: (message: string | null) => void;
}) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [workType, setWorkType] = useState("assignment");
  const [due, setDue] = useState("");
  /** Prefilled with the end-of-day default, so adding work between classes stays four fields. */
  const [dueTime, setDueTime] = useState(DEFAULT_DUE_TIME);
  const [minutes, setMinutes] = useState("");
  const [points, setPoints] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!courseId || title.trim().length === 0) return;
    setBusy(true);
    onError(null);
    try {
      await api.post("/api/work-items", {
        courseId,
        title: title.trim(),
        workType,
        // Same reading of a calendar day as the date column: end of day is what "due Friday"
        // means, and it matches what extraction writes. The time box overrides it when the
        // instructor said one -- "the quiz closes at nine" is announced in the same breath.
        dueAt: composeDueAt(due, dueTime),
        estimatedMinutes: minutes ? Number(minutes) : null,
        // "A new quiz, worth 20" is one announcement; the weight arrives with the work.
        pointsPossible: points ? Number(points) : null,
      });
      setTitle("");
      setDue("");
      setDueTime(DEFAULT_DUE_TIME);
      setMinutes("");
      setPoints("");
      onAdded();
    } catch (e) {
      onError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        alignItems: "flex-end",
        margin: "0 0 0.8rem",
        padding: "0.7rem",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--surface-2)",
      }}
    >
      <label style={{ display: "grid", gap: "0.2rem" }}>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          Class
        </span>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.code ?? course.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: "0.2rem", flex: "1 1 14rem" }}>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          What is it
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Reading response 4"
        />
      </label>

      <label style={{ display: "grid", gap: "0.2rem" }}>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          Type
        </span>
        <select value={workType} onChange={(e) => setWorkType(e.target.value)}>
          {["assignment", "reading", "quiz", "exam", "paper", "project", "lab", "discussion"].map(
            (type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ),
          )}
        </select>
      </label>

      <label style={{ display: "grid", gap: "0.2rem" }}>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          Due
        </span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>

      <label style={{ display: "grid", gap: "0.2rem" }}>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          By
        </span>
        <input
          type="time"
          value={dueTime}
          disabled={due === ""}
          onChange={(e) => setDueTime(e.target.value)}
          style={{ width: "7.5rem" }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.2rem" }}>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          Worth (pts)
        </span>
        <input
          type="number"
          min={0}
          step="any"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="?"
          style={{ width: "5.5rem" }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.2rem" }}>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          Minutes
        </span>
        <input
          type="number"
          min={5}
          step={5}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="45"
          style={{ width: "6rem" }}
        />
      </label>

      <button
        className="action primary"
        disabled={busy || title.trim().length === 0}
        onClick={() => void add()}
      >
        {busy ? "Adding…" : "Add it"}
      </button>
    </div>
  );
}
