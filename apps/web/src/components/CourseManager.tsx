import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { DayPicker, TimeRange } from "./DayPicker";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface SnapshotCourse {
  id: string;
  name: string;
  code: string | null;
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
 * Course and commitment management on the Setup tab.
 *
 * Courses give the plan something to schedule; commitments (work shifts, practices) give
 * it the truth about when the student is actually free. Both existed as API routes with
 * no UI, which meant a fresh account could never reach a working plan.
 */
export function CourseManager({
  termId,
  onChanged,
}: {
  termId: string;
  onChanged: () => void;
}) {
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
        <h2>Courses</h2>
        {snapshot === null ? (
          <p className="muted">Loading…</p>
        ) : snapshot.courses.length === 0 ? (
          <p className="muted">
            No courses yet. Add one below — a name is enough to start; a syllabus upload
            fills in the rest.
          </p>
        ) : (
          <ul className="alternatives">
            {snapshot.courses.map((course) => (
              <li key={course.id}>
                <span>
                  {course.name}
                  {course.code && !course.name.includes(course.code) && (
                    <span className="muted"> · {course.code}</span>
                  )}
                </span>
                <span className="muted">{meetingSummary(course.id) ?? "no meeting times"}</span>
              </li>
            ))}
          </ul>
        )}

        <AddCourseForm
          termId={termId}
          onAdded={() => {
            void refresh();
            onChanged();
          }}
          onError={setError}
        />
      </section>

      <section className="card">
        <h2>Fixed commitments</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Work shifts, practices, anything the planner must schedule around.
        </p>
        {snapshot && snapshot.commitments.length > 0 && (
          <ul className="alternatives">
            {snapshot.commitments.map((commitment) => (
              <li key={commitment.id}>
                <span>{commitment.title}</span>
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
  onAdded,
  onError,
}: {
  termId: string;
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
        Add a course
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
      onError(err instanceof Error ? err.message : "Could not add the course.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "0.8rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <input
          aria-label="Course name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Course name"
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
          {busy ? "Adding…" : "Add course"}
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
  onAdded,
  onError,
}: {
  termId: string;
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
        Add a commitment
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
        <select
          aria-label="Commitment type"
          value={commitmentType}
          onChange={(e) => setCommitmentType(e.target.value)}
          style={{ ...fieldStyle, flex: 1, minWidth: "7rem" }}
        >
          <option value="work">Work</option>
          <option value="club">Club</option>
          <option value="exercise">Exercise</option>
          <option value="worship">Worship</option>
          <option value="appointment">Appointment</option>
          <option value="other">Other</option>
        </select>
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
          {busy ? "Adding…" : "Add commitment"}
        </button>
        <button className="action" type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
