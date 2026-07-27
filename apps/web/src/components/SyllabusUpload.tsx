import { useState } from "react";
import type { Course } from "@schoolquest/domain";
import { api, isDesktop } from "../lib/api";

/**
 * Syllabus upload.
 *
 * This is the desktop app's reason to exist: uploading and reviewing a syllabus is a
 * sit-down task with a real file picker, not something to do on a phone. The PWA shows
 * an explanation instead of the picker rather than hiding the feature entirely — a
 * missing button with no explanation reads as a bug.
 */
export function SyllabusUpload({ courses }: { courses: Course[] }) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isDesktop) {
    return (
      <section className="card">
        <h2>Syllabus upload</h2>
        <p className="muted">
          Syllabus upload and review live in the desktop app. Open SchoolQuest on your computer
          to add a syllabus — this companion app is for following the plan, not building it.
        </p>
      </section>
    );
  }

  async function upload(file: File) {
    if (!courseId) {
      setError("Add a course first.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", "syllabus");
      await api.upload(`/api/courses/${courseId}/documents`, form);
      setStatus(
        `Stored "${file.name}". Extraction into reviewable assignments is not wired up yet — ` +
          `nothing from this file has touched your plan.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Syllabus upload</h2>

      <label className="sr-only" htmlFor="upload-course">
        Course
      </label>
      <select
        id="upload-course"
        value={courseId}
        onChange={(e) => setCourseId(e.target.value)}
        style={{
          background: "var(--surface-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "0.5rem 0.7rem",
          font: "inherit",
          marginBottom: "0.75rem",
          width: "100%",
        }}
      >
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        disabled={busy || courses.length === 0}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />

      {status && <p className="notice">{status}</p>}
      {error && <p className="error">{error}</p>}

      <p className="muted" style={{ marginBottom: 0 }}>
        Nothing extracted from a syllabus changes your plan until you review and confirm it.
      </p>
    </section>
  );
}
