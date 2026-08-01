import { useCallback, useEffect, useState } from "react";
import { type ThemeName } from "@schoolquest/domain";
import { label } from "@schoolquest/theme-language";
import { api } from "../lib/api";
import { DayPicker, TimeRange } from "./DayPicker";
import { courseTincture } from "../lib/course-colour";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface SnapshotCourse {
  id: string;
  name: string;
  code: string | null;
  /** Identity colour. Older courses predate assignment; `colorTokenFor` covers them. */
  colorToken?: string | null;
}

interface SnapshotMeeting {
  id: string;
  courseId: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  location: string | null;
}

interface SnapshotCommitment {
  id: string;
  title: string;
  commitmentType: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

interface Snapshot {
  courses: SnapshotCourse[];
  meetingPatterns: SnapshotMeeting[];
  commitments: SnapshotCommitment[];
}

/**
 * The Setup tab is mounted by App without a `theme` prop, and threading one through would
 * mean editing App.tsx. The active theme is already published on the document — App writes
 * `document.body.dataset.theme` on every render — so it is read from there instead. The
 * observer is not optional: the theme switcher lives on this very screen, so without it
 * these cards would keep the previous chrome until some unrelated re-render happened to
 * come along.
 *
 * `override` exists so a future call site can hand the theme down properly; nothing passes
 * it today.
 */
function useBodyTheme(override?: ThemeName): ThemeName {
  const [theme, setTheme] = useState<ThemeName>(
    () => (document.body.dataset["theme"] as ThemeName | undefined) ?? "plain",
  );

  useEffect(() => {
    const read = () =>
      setTheme((document.body.dataset["theme"] as ThemeName | undefined) ?? "plain");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return override ?? theme;
}

/**
 * Themed wording on screen, plain wording for assistive technology. Screen-reader output
 * must never depend on the visual theme (docs/02-prd.md §5 Accessibility), and inside a
 * control this is also what keeps the accessible name plain: the themed span is hidden
 * from the name computation, the plain one is not.
 */
function Themed({ visible, plain }: { visible: string; plain: string }) {
  if (visible === plain) return <>{visible}</>;
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{plain}</span>
    </>
  );
}

/** Quest palette, duplicated from the `--q-*` custom properties as literals (cf. Questline). */
const Q = {
  gold: "#c9a227",
  goldBright: "#e8c95a",
  goldDim: "#8a6f1f",
  goldEdge: "#6d5718",
  wax: "#8c2f28",
  forest: "#3f6c45",
  leather2: "#241a10",
  cream: "#f4ead2",
} as const;

/**
 * A `select` in the Quest theme has `appearance: none` and a background shorthand that
 * wins the cascade, which between them left the control with no dropdown arrow at all —
 * a cream rectangle indistinguishable from a read-only field. Rather than fight an
 * `!important` shorthand from an inline style, the affordance is drawn as a sibling
 * overlay: a gold pull-tab with a chevron, `pointer-events: none` so every click still
 * lands on the select underneath.
 *
 * Data-URI SVG only — the CSP forbids external assets.
 */
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E" +
  "%3Cpath d='M1.5 1.5l4.5 4.5 4.5-4.5' fill='none' stroke='%232a1f14' stroke-width='2' " +
  "stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

function SelectChevron({ dim }: { dim?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 1,
        right: 1,
        bottom: 1,
        width: "1.7rem",
        pointerEvents: "none",
        borderRadius: "0 3px 3px 0",
        borderLeft: `1px solid ${Q.goldEdge}`,
        background: `${CHEVRON} no-repeat center / 12px 8px, linear-gradient(180deg, ${Q.goldBright}, ${Q.gold} 55%, ${Q.goldDim})`,
        boxShadow: "inset 0 1px 0 rgba(255, 244, 205, 0.6)",
        opacity: dim ? 0.45 : 1,
      }}
    />
  );
}

/**
 * Course sigils, so a course carries the same mark here as it does on the Region Map.
 *
 * Three deliberate departures from the roster chip on the Week tab. It is a heater shield
 * rather than a rounded square, so the mark is a device and not a recoloured avatar. It
 * has heraldic structure — a gold bordure, a gold chief, and a per-bend division of the
 * field — instead of a flat fill. And the tinctures come only from the theme's own
 * palette (oxblood, vert, sable under gold), because the olive-grey the roster falls back
 * to is the one muddy colour in an otherwise disciplined gold/oxblood/cream system.
 */
const SHIELD =
  "polygon(7% 0%, 93% 0%, 100% 7%, 100% 48%, 96% 66%, 86% 82%, 68% 94%, 50% 100%," +
  " 32% 94%, 14% 82%, 4% 66%, 0% 48%, 0% 7%)";

/**
 * Sigil lettering, matched to the Week tab so the two screens agree. Digits are skipped
 * on purpose: "BIO 240" as a two-character mark reads as "B2", which looks like a typo.
 */
function initialsFor(course: SnapshotCourse): string {
  const source = course.code ?? course.name ?? course.id;
  const words = source.match(/[A-Za-z]+/g) ?? [];
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  return (second ? first.slice(0, 1) + second.slice(0, 1) : first.slice(0, 3)).toUpperCase();
}

function CourseSigil({ course }: { course: SnapshotCourse }) {
  const tincture = courseTincture(course.id, course.colorToken, true);
  return (
    <span
      aria-hidden="true"
      style={{
        width: 29,
        height: 33,
        flex: "0 0 auto",
        display: "grid",
        padding: 2,
        clipPath: SHIELD,
        background: `linear-gradient(180deg, ${Q.goldBright}, ${Q.gold} 55%, ${Q.goldDim})`,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          // A chief at the top and a point at the bottom both eat into where letters can
          // sit, so the charge is nudged into the widest band of the field rather than
          // into the geometric middle.
          paddingTop: 3,
          paddingBottom: 5,
          clipPath: SHIELD,
          background:
            // The chief and the per-bend sheen both lifted the field under the letters —
            // cream on the gold chief measures 1.26:1. The gold band is now a border-top on
            // its own, outside the charge's box, and the bend is darkening only, so the
            // whole lettered area stays at the tincture's own value.
            `linear-gradient(107deg, rgba(0, 0, 0, 0.06) 0 46%, rgba(0, 0, 0, 0.3) 46%),` +
            ` ${tincture}`,
          borderTop: `4px solid ${Q.goldBright}`,
          color: Q.cream,
          fontSize: "0.56rem",
          fontWeight: 700,
          letterSpacing: "0.01em",
          lineHeight: 1,
          textShadow: "0 1px 0 rgba(0, 0, 0, 0.55)",
        }}
      >
        {initialsFor(course)}
      </span>
    </span>
  );
}

/** Card heading: themed on screen, plain for assistive tech, with the quest fleur-de-lis. */
function CardHeading({ quest, visible, plain }: { quest: boolean; visible: string; plain: string }) {
  return (
    <h2>
      {quest && (
        <span aria-hidden="true" style={{ color: Q.goldDim }}>
          {"⚜ "}
        </span>
      )}
      <Themed visible={visible} plain={plain} />
    </h2>
  );
}

/**
 * Course and commitment management on the Setup tab.
 *
 * Courses give the plan something to schedule; commitments (work shifts, practices) give
 * it the truth about when the student is actually free. Both existed as API routes with
 * no UI, which meant a fresh account could never reach a working plan.
 *
 * Quest chrome is presentation only: every field, every request, and every accessible
 * name is identical under all three themes.
 */
export function CourseManager({
  termId,
  onChanged,
  theme: themeProp,
}: {
  termId: string;
  onChanged: () => void;
  /** Optional. Omitted by the current call site, which is why the theme is read off body. */
  theme?: ThemeName;
}) {
  const theme = useBodyTheme(themeProp);
  const quest = theme === "quest";
  // "Questline" / "Course" / "Theater" — the wording lives in @schoolquest/theme-language
  // rather than in a synonym hard-coded here.
  const courseNoun = label("course", theme);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Course whose class times are open for editing, or null. */
  const [editingMeetings, setEditingMeetings] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.get<Snapshot>(`/api/terms/${termId}/snapshot`));
    } catch {
      setSnapshot(null);
    }
  }, [termId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function meetingSummary(courseId: string): string | null {
    const meetings = snapshot?.meetingPatterns.filter((m) => m.courseId === courseId) ?? [];
    if (meetings.length === 0) return null;
    return meetings
      .map((m) => `${m.daysOfWeek.map((d) => DAY_LABELS[d]).join(" ")} ${m.startTime}–${m.endTime}`)
      .join(", ");
  }

  return (
    <>
      <section className="card">
        <CardHeading quest={quest} visible={`${courseNoun}s`} plain="Courses" />
        {snapshot === null ? (
          <p className="muted">Loading…</p>
        ) : snapshot.courses.length === 0 ? (
          <p className="muted">
            <Themed
              visible={
                quest
                  ? "No questlines charted yet. Add one below — a name is enough to begin, and a syllabus fills in the rest."
                  : "No courses yet. Add one below — a name is enough to start; a syllabus upload fills in the rest."
              }
              plain="No courses yet. Add one below — a name is enough to start; a syllabus upload fills in the rest."
            />
          </p>
        ) : (
          <ul className="alternatives">
            {snapshot.courses.map((course) => (
              <li key={course.id}>
                <span style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                  {quest && <CourseSigil course={course} />}
                  <span>
                    {course.name}
                    {course.code && !course.name.includes(course.code) && (
                      <span className="muted"> · {course.code}</span>
                    )}
                  </span>
                </span>
                <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span className="muted">
                    {meetingSummary(course.id) ?? (
                      <Themed
                        visible={quest ? "hours not yet set" : "no meeting times"}
                        plain="no meeting times"
                      />
                    )}
                  </span>
                  <button className="action" onClick={() => setEditingMeetings(course.id)}>
                    Class times
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {editingMeetings && (
          <MeetingTimesForm
            courseId={editingMeetings}
            patterns={snapshot?.meetingPatterns.filter((m) => m.courseId === editingMeetings) ?? []}
            onDone={() => {
              setEditingMeetings(null);
              void refresh();
              onChanged();
            }}
            onCancel={() => setEditingMeetings(null)}
            onError={setError}
          />
        )}

        <AddCourseForm
          termId={termId}
          quest={quest}
          courseNoun={courseNoun}
          onAdded={() => {
            void refresh();
            onChanged();
          }}
          onError={setError}
        />
      </section>

      <section className="card">
        <CardHeading
          quest={quest}
          visible={quest ? "Immovable hours" : "Fixed commitments"}
          plain="Fixed commitments"
        />
        <p className="muted" style={{ marginTop: 0 }}>
          <Themed
            visible={
              quest
                ? "Work shifts, practices, meals — the hours a week has to be built around. Nothing is ever scheduled over them."
                : "Work shifts, practices, anything the planner must schedule around."
            }
            plain="Work shifts, practices, anything the planner must schedule around."
          />
        </p>
        {snapshot && snapshot.commitments.length > 0 && (
          <ul className="alternatives">
            {snapshot.commitments.map((commitment) => (
              <CommitmentRow
                key={commitment.id}
                commitment={commitment}
                quest={quest}
                onChanged={() => {
                  void refresh();
                  onChanged();
                }}
                onError={setError}
              />
            ))}
          </ul>
        )}

        <AddCommitmentForm
          termId={termId}
          quest={quest}
          onAdded={() => {
            void refresh();
            onChanged();
          }}
          onError={setError}
        />
      </section>

      {error && <p className="error">{error}</p>}
    </>
  );
}

const fieldStyle = {
  background: "var(--surface-2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "0.5rem 0.7rem",
  font: "inherit",
  fontSize: "0.9rem",
} as const;

function AddCourseForm({
  termId,
  quest,
  courseNoun,
  onAdded,
  onError,
}: {
  termId: string;
  quest: boolean;
  courseNoun: string;
  onAdded: () => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [days, setDays] = useState<Set<number>>(new Set());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:15");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="action" style={{ marginTop: "0.6rem" }} onClick={() => setOpen(true)}>
        <Themed
          visible={quest ? "Add a questline" : "Add a course"}
          plain="Add a course"
        />
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (days.size > 0 && endTime <= startTime) {
      onError("Class meetings have to end after they start.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await api.post(`/api/terms/${termId}/courses`, {
        name: name.trim(),
        code: code.trim() || null,
        // Meeting times are optional here on purpose: the clarification flow asks for
        // them later if a syllabus does not state them either.
        ...(days.size > 0
          ? { meetingPatterns: [{ daysOfWeek: [...days].sort(), startTime, endTime }] }
          : {}),
      });
      setName("");
      setCode("");
      setDays(new Set());
      setOpen(false);
      onAdded();
    } catch (err) {
      onError(
        err instanceof Error ? err.message : `Could not add the ${courseNoun.toLowerCase()}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "0.8rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        {/* Placeholders carry the themed noun; the aria-label stays the plain one, so the
            accessible name never depends on the theme. */}
        <input
          aria-label="Course name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={quest ? "Questline name" : "Course name"}
          style={{ ...fieldStyle, flex: 2, minWidth: "12rem" }}
        />
        <input
          aria-label="Course code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code (optional)"
          style={{ ...fieldStyle, flex: 1, minWidth: "7rem" }}
        />
      </div>

      <DayPicker value={days} onChange={setDays} label="Class meets (optional)" />
      {days.size > 0 && (
        <TimeRange
          start={startTime}
          end={endTime}
          onStart={setStartTime}
          onEnd={setEndTime}
          label="Meeting time"
        />
      )}

      <div className="button-row">
        <button className="action primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? (
            "Adding…"
          ) : (
            <Themed visible={quest ? "Add questline" : "Add course"} plain="Add course" />
          )}
        </button>
        <button className="action" type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddCommitmentForm({
  termId,
  quest,
  onAdded,
  onError,
}: {
  termId: string;
  quest: boolean;
  onAdded: () => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [commitmentType, setCommitmentType] = useState("work");
  const [days, setDays] = useState<Set<number>>(new Set());
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("21:00");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="action" style={{ marginTop: "0.6rem" }} onClick={() => setOpen(true)}>
        <Themed
          visible={quest ? "Add immovable hours" : "Add a commitment"}
          plain="Add a commitment"
        />
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (days.size === 0) {
      onError("Pick which days this happens.");
      return;
    }
    if (endTime <= startTime) {
      onError("Commitments have to end after they start.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await api.post(`/api/terms/${termId}/commitments`, {
        title: title.trim(),
        commitmentType,
        daysOfWeek: [...days].sort(),
        startTime,
        endTime,
        flexibility: "fixed",
      });
      setTitle("");
      setDays(new Set());
      setOpen(false);
      onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the commitment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "0.8rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <input
          aria-label="Commitment name"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Work shift"
          style={{ ...fieldStyle, flex: 2, minWidth: "10rem" }}
        />
        {/* The wrapper exists to hang the quest chevron off; it carries the flex sizing the
            select used to, so the row is laid out exactly as before in every theme. Option
            wording is left alone — these are the categories the API stores. */}
        <span
          style={{ position: "relative", display: "inline-flex", flex: 1, minWidth: "7rem" }}
        >
          <select
            aria-label="Commitment type"
            value={commitmentType}
            onChange={(e) => setCommitmentType(e.target.value)}
            style={{ ...fieldStyle, width: "100%" }}
          >
            <option value="work">Work</option>
            <option value="club">Club</option>
            <option value="exercise">Exercise</option>
            <option value="worship">Worship</option>
            <option value="appointment">Appointment</option>
            <option value="other">Other</option>
          </select>
          {quest && <SelectChevron />}
        </span>
      </div>

      <DayPicker value={days} onChange={setDays} label="Which days" />
      <TimeRange
        start={startTime}
        end={endTime}
        onStart={setStartTime}
        onEnd={setEndTime}
        label="From"
      />

      <div className="button-row">
        <button className="action primary" type="submit" disabled={busy || !title.trim()}>
          {busy ? (
            "Adding…"
          ) : (
            <Themed visible={quest ? "Add these hours" : "Add commitment"} plain="Add commitment" />
          )}
        </button>
        <button className="action" type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * One standing commitment, editable in place.
 *
 * Commitments could be created and never touched. A shift that moves to a different evening
 * is the single commonest change in a student's term, and the only way to record it was to
 * add a second commitment and leave the first one protecting an hour nobody needed — so the
 * planner kept steering around a shift that had ended weeks earlier.
 */
function CommitmentRow({
  commitment,
  quest,
  onChanged,
  onError,
}: {
  commitment: SnapshotCommitment;
  quest: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<Set<number>>(new Set(commitment.daysOfWeek));
  const [startTime, setStartTime] = useState(commitment.startTime);
  const [endTime, setEndTime] = useState(commitment.endTime);
  const [title, setTitle] = useState(commitment.title);

  async function save() {
    if (endTime <= startTime || days.size === 0) {
      onError("A commitment needs at least one day and an end after its start.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await api.patch(`/api/commitments/${commitment.id}`, {
        title,
        daysOfWeek: [...days].sort(),
        startTime,
        endTime,
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    onError(null);
    try {
      await api.del(`/api/commitments/${commitment.id}`);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "That did not delete.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <li>
        <span>
          {quest && (
            <span aria-hidden="true" style={{ color: Q.wax, marginRight: "0.4rem" }}>
              ◈
            </span>
          )}
          {commitment.title}
        </span>
        <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className="muted">
            {commitment.daysOfWeek.map((d) => DAY_LABELS[d]).join(" ")} {commitment.startTime}–
            {commitment.endTime}
          </span>
          <button className="action" onClick={() => setEditing(true)}>
            Change
          </button>
        </span>
      </li>
    );
  }

  return (
    <li style={{ display: "block" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: "0.2rem", flex: "1 1 10rem" }}>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            What
          </span>
          <input style={fieldStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: "0.2rem" }}>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            From
          </span>
          <input
            style={fieldStyle}
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label style={{ display: "grid", gap: "0.2rem" }}>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            Until
          </span>
          <input
            style={fieldStyle}
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </label>
      </div>
      <DayPicker value={days} onChange={setDays} label="Days" />
      <div className="button-row">
        <button className="action primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
        <button className="action" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button className="action" disabled={busy} onClick={() => void remove()}>
          Remove it
        </button>
      </div>
    </li>
  );
}


/**
 * A course's class times, editable after the course exists.
 *
 * These could only be supplied in the same request that created the course. A class that
 * moves hour or room mid-term had no way in, so the calendar and the scheduler both went on
 * believing the student was free during a lecture — which is the one thing on the week that
 * is genuinely immovable.
 *
 * The whole set is replaced on save rather than appended to: a timetable is a statement
 * about the entire week, and merging would strand last term's Tuesday with nothing able to
 * remove it.
 */
function MeetingTimesForm({
  courseId,
  patterns,
  onDone,
  onCancel,
  onError,
}: {
  courseId: string;
  patterns: SnapshotMeeting[];
  onDone: () => void;
  onCancel: () => void;
  onError: (message: string | null) => void;
}) {
  const [rows, setRows] = useState(
    patterns.length > 0
      ? patterns.map((p, i) => ({
          key: `${p.id ?? i}`,
          days: new Set(p.daysOfWeek),
          startTime: p.startTime,
          endTime: p.endTime,
          location: p.location ?? "",
        }))
      : [
          {
            key: "new",
            days: new Set<number>([1, 3]),
            startTime: "09:00",
            endTime: "10:15",
            location: "",
          },
        ],
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    const bad = rows.find((r) => r.endTime <= r.startTime || r.days.size === 0);
    if (bad) {
      onError("Every class needs at least one day and an end after its start.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await api.put(`/api/courses/${courseId}/meeting-patterns`, {
        patterns: rows.map((r) => ({
          daysOfWeek: [...r.days].sort(),
          startTime: r.startTime,
          endTime: r.endTime,
          location: r.location.trim() || null,
        })),
      });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: "0.75rem",
        paddingTop: "0.75rem",
        borderTop: "1px solid var(--border)",
      }}
    >
      <p className="muted" style={{ margin: "0 0 0.5rem" }}>
        When this class meets. Nothing is ever scheduled over it, and it shows on your
        hour-by-hour week.
      </p>
      {rows.map((row) => (
        <div key={row.key} style={{ marginBottom: "0.6rem" }}>
          <DayPicker
            value={row.days}
            onChange={(days) =>
              setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, days } : r)))
            }
            label="Days"
          />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                From
              </span>
              <input
                style={fieldStyle}
                type="time"
                value={row.startTime}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r) => (r.key === row.key ? { ...r, startTime: e.target.value } : r)),
                  )
                }
              />
            </label>
            <label style={{ display: "grid", gap: "0.2rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Until
              </span>
              <input
                style={fieldStyle}
                type="time"
                value={row.endTime}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r) => (r.key === row.key ? { ...r, endTime: e.target.value } : r)),
                  )
                }
              />
            </label>
            <label style={{ display: "grid", gap: "0.2rem", flex: "1 1 8rem" }}>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Where (optional)
              </span>
              <input
                style={fieldStyle}
                value={row.location}
                placeholder="Science 210"
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r) => (r.key === row.key ? { ...r, location: e.target.value } : r)),
                  )
                }
              />
            </label>
            {rows.length > 1 && (
              <button
                className="action"
                onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="button-row">
        <button className="action primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save class times"}
        </button>
        <button
          className="action"
          disabled={busy}
          onClick={() =>
            setRows((rs) => [
              ...rs,
              {
                key: `new-${rs.length}-${rs.length}`,
                days: new Set<number>([2]),
                startTime: "13:00",
                endTime: "14:15",
                location: "",
              },
            ])
          }
        >
          Another meeting
        </button>
        <button className="action" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {rows.length > 0 && (
          <button className="action" disabled={busy} onClick={() => { setRows([]); void save(); }}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
