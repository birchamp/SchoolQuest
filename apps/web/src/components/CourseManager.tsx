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
  courseId: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
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
                <span className="muted">
                  {meetingSummary(course.id) ?? (
                    <Themed
                      visible={quest ? "hours not yet set" : "no meeting times"}
                      plain="no meeting times"
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
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
              <li key={commitment.id}>
                <span>
                  {quest && (
                    <span aria-hidden="true" style={{ color: Q.wax, marginRight: "0.4rem" }}>
                      ◈
                    </span>
                  )}
                  {commitment.title}
                </span>
                <span className="muted">
                  {commitment.daysOfWeek.map((d) => DAY_LABELS[d]).join(" ")}{" "}
                  {commitment.startTime}–{commitment.endTime}
                </span>
              </li>
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
