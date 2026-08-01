import { useState } from "react";
import type { Course, ThemeName, WorkItem } from "@schoolquest/domain";
import { explainHealth, label } from "@schoolquest/theme-language";
import { api } from "../lib/api";
import { courseInitials, courseTincture } from "../lib/course-colour";
import type { CourseHealthView, TermHealthView } from "../lib/types";

/**
 * Which class needs me?
 *
 * The one question the app could not answer. The week map shows time, the arc shows
 * landmarks, the roster shows completion and the grade page shows standing — each answers
 * its own question well, and a student holding five courses had to assemble "where am I
 * weakest right now" out of four screens. Assembling things out of four screens is the exact
 * deficit this product exists to compensate for, so the board does the assembling.
 *
 * Everything here is arranged around being read in about five seconds:
 *
 *  - Worst first, always. The ordering *is* the prioritisation, and it is the whole point.
 *  - One sentence per course, not a row of metrics. The sentence is already the instruction;
 *    a number is a riddle the student has to solve before it becomes one.
 *  - The remaining concerns collapse behind a disclosure rather than stacking, so a course
 *    with four problems still occupies one line at rest.
 *  - Colour never carries the verdict alone. Every level ships its word, and the word is
 *    what a screen reader gets.
 *
 * The grade is never shown without the basis it rests on. A percentage drawn from three
 * quizzes and one drawn from half the course look identical in a big number, and treating
 * them as the same thing is the most misleading thing a student dashboard can do.
 */

/** Parchment-safe values, measured (see SessionBrief.tsx for where each figure comes from). */
const QUEST_INK_DIM = "#5b4930";
const QUEST_WAX = "#8c2f28";
/**
 * The amber used elsewhere on parchment (#8a6f1f) measures 3.28:1 here — under AA. This is
 * darkened until it clears: 4.98:1 on the darkest parchment stop, against 5.62:1 for the wax
 * red beside it and 5.88:1 for the dim ink.
 */
const QUEST_GOLD_DIM = "#6f5200";

/**
 * Verdict colours, per ground.
 *
 * `--at-risk` and `--watch` are tuned for the dark page, not for the parchment a quest card
 * paints under them. Using them here measured 1.99:1 and 1.11:1 — the second is invisible,
 * and it is the identical failure the ledger already records for the Main Quest rationale at
 * 1.06:1. A theme that repaints the ground has to repaint every token that means "text on
 * the ground", every time, and the only way to know it did is to measure.
 *
 * The quest values are the ones already proven on this parchment elsewhere in the app: the
 * wax red used for card headings, and the dim ink used for every secondary line.
 */
function levelColour(level: string, quest: boolean): string {
  if (!quest) {
    return level === "at_risk"
      ? "var(--at-risk)"
      : level === "needs_attention"
        ? "var(--watch)"
        : "var(--text-dim)";
  }
  return level === "at_risk"
    ? QUEST_WAX
    : level === "needs_attention"
      ? QUEST_GOLD_DIM
      : QUEST_INK_DIM;
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "nothing";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "in 5 days" / "tomorrow" / "3 days ago". Never a bare signed number. */
function whenDue(days: number | null): string | null {
  if (days === null) return null;
  if (days < -1) return `${Math.abs(days)} days ago`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function Dashboard({
  health,
  courses,
  workItems,
  theme,
  onChanged,
}: {
  health: TermHealthView;
  courses: Course[];
  workItems: WorkItem[];
  theme: ThemeName;
  onChanged: () => void;
}) {
  const quest = theme === "quest";
  const coursesById = new Map(courses.map((c) => [c.id, c]));

  if (health.courses.length === 0) return null;

  const needing = health.coursesAtRisk + health.coursesNeedingAttention;

  return (
    <section className="card" aria-labelledby="dashboard-heading">
      <h2 id="dashboard-heading">
        <span aria-hidden="true">{label("dashboard", theme)}</span>
        <span className="sr-only">What needs you</span>
      </h2>

      {/* The headline is a count of what needs doing, never a score out of anything. */}
      <p className="muted" style={{ margin: "0 0 0.9rem" }}>
        {needing === 0
          ? `All ${health.courses.length} ${
              health.courses.length === 1 ? "course is" : "courses are"
            } holding steady. Nothing here needs you right now.`
          : `${needing} of ${health.courses.length} ${
              health.courses.length === 1 ? "course needs" : "courses need"
            } something from you${
              health.coursesUnplanned > 0
                ? `, and ${health.coursesUnplanned} ${
                    health.coursesUnplanned === 1 ? "has" : "have"
                  } no time booked this week`
                : ""
            }.`}
      </p>

      {health.courses.map((row) => (
        <CourseRow
          key={row.courseId}
          row={row}
          course={coursesById.get(row.courseId)}
          workItems={workItems}
          quest={quest}
          theme={theme}
          onChanged={onChanged}
        />
      ))}
    </section>
  );
}

function CourseRow({
  row,
  course,
  workItems,
  quest,
  theme,
  onChanged,
}: {
  row: CourseHealthView;
  course: Course | undefined;
  workItems: WorkItem[];
  quest: boolean;
  theme: ThemeName;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const verdict = explainHealth(row.level, theme);
  const tincture = courseTincture(row.courseId, course?.colorToken, quest);
  const name = course
    ? course.code && !course.name.includes(course.code)
      ? `${course.name} (${course.code})`
      : course.name
    : row.courseId;

  const top = row.concerns[0];
  const rest = row.concerns.slice(1);
  const due = whenDue(row.nextDueInDays);

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "0.7rem 0 0.6rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.6rem",
            height: "1.6rem",
            borderRadius: 5,
            background: tincture,
            color: "#fff",
            fontSize: "0.62rem",
            fontWeight: 700,
            letterSpacing: "0.02em",
            flex: "0 0 auto",
          }}
        >
          {courseInitials(row.courseId, course?.code ?? null, course?.name ?? "")}
        </span>

        <strong style={{ flex: "1 1 12rem" }}>{name}</strong>

        {/* The verdict word, never colour alone. */}
        <span
          style={{
            fontSize: "0.68rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 700,
            color: levelColour(row.level, quest),
          }}
        >
          <span aria-hidden="true">{verdict.label}</span>
          <span className="sr-only">{verdict.plainLabel}</span>
        </span>
      </div>

      {/* The one sentence that says what to do about it. */}
      {top ? (
        <p style={{ margin: "0.35rem 0 0.2rem" }}>{top.detail}</p>
      ) : (
        <p className="muted" style={{ margin: "0.35rem 0 0.2rem" }}>
          {verdict.hint}
        </p>
      )}

      {/* The facts a student checks next, on one line and in the order they are asked. */}
      <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.82rem" }}>
        {due && row.nextDueTitle ? (
          <>
            Next: {row.nextDueTitle} <span aria-hidden="true">·</span> {due}
          </>
        ) : (
          <>Nothing dated coming up</>
        )}
        {" · "}
        {/* An empty week is only a finding when there is work it should have held. A course
            with nothing left to do also books nothing, and marking that in the attention
            colour had the line contradicting the verdict beside it — the engine had already
            decided it was fine, and the styling argued back. */}
        {row.bookedMinutes === 0 && row.openItems > 0 ? (
          <span style={{ color: levelColour("needs_attention", quest), fontWeight: 600 }}>
            nothing booked this week
          </span>
        ) : row.bookedMinutes === 0 ? (
          <>nothing left to book</>
        ) : (
          <>
            {formatMinutes(row.bookedMinutes)} booked this week
            {row.blocks > 0 && ` across ${row.blocks} ${row.blocks === 1 ? "block" : "blocks"}`}
          </>
        )}
        {" · "}
        <GradeReading row={row} />
      </p>

      {/* Anything beyond the first concern is real but not the headline. Collapsed so a
          course with four problems still reads as one line until asked. */}
      {rest.length > 0 && (
        <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: "pointer", fontSize: "0.82rem", padding: "0.25rem 0" }}>
            {rest.length} more {rest.length === 1 ? "thing" : "things"} about this course
          </summary>
          <ul className="alternatives" style={{ margin: "0.15rem 0 0.35rem" }}>
            {rest.map((concern) => (
              <li key={concern.code} style={{ display: "block", fontSize: "0.86rem" }}>
                {concern.detail}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* The one concern the student can settle without leaving the page. Every other
          concern is answered by planning or by doing the work; this one is answered by
          typing a number the student already knows, and a board that names a problem it
          gives you no way to fix is worse than a board that stays quiet. */}
      {row.ungradedResults > 0 && (
        <RecordResults
          courseId={row.courseId}
          workItems={workItems}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

/**
 * The standing, always beside what it rests on.
 *
 * `gradedWeightFraction` is zero whenever the graded work is not mapped to weighted
 * categories, which is most of the time — so "0% of the course graded" would be both true
 * and badly misleading beside a real percentage. The count is the honest basis in that case.
 */
function GradeReading({ row }: { row: CourseHealthView }) {
  if (row.gradePercent === null) {
    return <span>no grades yet</span>;
  }
  const basis =
    row.gradedWeightFraction > 0
      ? `${Math.round(row.gradedWeightFraction * 100)}% of the course graded`
      : `${row.gradedCount} ${row.gradedCount === 1 ? "result" : "results"} so far`;
  return (
    <span>
      {Math.round(row.gradePercent)}% <span aria-hidden="true">·</span>{" "}
      <span className="sr-only">based on </span>
      {basis}
    </span>
  );
}

/** Inline entry for work that is finished and has no result against it. */
function RecordResults({
  courseId,
  workItems,
  onChanged,
}: {
  courseId: string;
  workItems: WorkItem[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, { earned: string; outOf: string }>>({});

  const pending = workItems.filter(
    (w) =>
      w.courseId === courseId &&
      (w.status === "completed" || w.status === "submitted") &&
      w.dueAt !== null &&
      Date.parse(w.dueAt) <= Date.now(),
  );
  if (pending.length === 0) return null;

  async function save(item: WorkItem) {
    const entry = scores[item.id];
    const earned = Number(entry?.earned);
    const outOf = Number(entry?.outOf ?? item.pointsPossible ?? NaN);
    if (!Number.isFinite(earned) || !Number.isFinite(outOf) || outOf <= 0) return;

    setBusy(item.id);
    setError(null);
    try {
      await api.put(`/api/work-items/${item.id}/grade`, {
        pointsEarned: earned,
        pointsPossible: outOf,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details style={{ marginTop: "0.35rem" }}>
      <summary style={{ cursor: "pointer", fontSize: "0.82rem", padding: "0.25rem 0" }}>
        Record what {pending.length === 1 ? "it" : "they"} scored
      </summary>
      {pending.map((item) => (
        <form
          key={item.id}
          onSubmit={(e) => {
            e.preventDefault();
            void save(item);
          }}
          style={{
            display: "flex",
            gap: "0.4rem",
            alignItems: "center",
            flexWrap: "wrap",
            padding: "0.3rem 0",
          }}
        >
          <span style={{ flex: "1 1 10rem", fontSize: "0.86rem" }}>{item.title}</span>
          <label>
            <span className="sr-only">Score for {item.title}</span>
            <input
              type="number"
              min={0}
              step="any"
              style={{ width: "5rem" }}
              placeholder="score"
              value={scores[item.id]?.earned ?? ""}
              onChange={(e) =>
                setScores((s) => ({
                  ...s,
                  [item.id]: { earned: e.target.value, outOf: s[item.id]?.outOf ?? "" },
                }))
              }
            />
          </label>
          <span aria-hidden="true" className="muted">
            out of
          </span>
          <label>
            <span className="sr-only">Total for {item.title}</span>
            <input
              type="number"
              min={1}
              step="any"
              style={{ width: "5rem" }}
              placeholder={item.pointsPossible !== null ? String(item.pointsPossible) : "total"}
              value={scores[item.id]?.outOf ?? ""}
              onChange={(e) =>
                setScores((s) => ({
                  ...s,
                  [item.id]: { earned: s[item.id]?.earned ?? "", outOf: e.target.value },
                }))
              }
            />
          </label>
          <button className="action" type="submit" disabled={busy === item.id}>
            Save
          </button>
        </form>
      ))}
      {error && <p className="error">{error}</p>}
    </details>
  );
}
