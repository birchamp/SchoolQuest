import { useEffect, useState } from "react";
import type { Course } from "@schoolquest/domain";
import { api } from "../lib/api";
import { extractPdfText } from "../lib/pdf-text";
import type { ExtractionResponse } from "../lib/extraction-types";
import { ExtractionReview } from "./ExtractionReview";

/**
 * Syllabus upload and extraction.
 *
 * Works in any shell — review is nicest on a big screen, but nothing here requires Tauri,
 * and gating it stranded browser use entirely. The PDF is parsed in the client, and the
 * resulting page text is what goes to the server for extraction. That is a deliberate
 * split: the Cloudflare Workers free plan gives 10ms of CPU per request, which cannot
 * parse a PDF, while any client machine barely notices. The Worker only waits on the
 * model, which is I/O and costs no CPU budget.
 */

type Phase =
  | { name: "idle" }
  | { name: "reading"; progress: string }
  | { name: "extracting" }
  | { name: "review"; documentId: string; filename: string; result: ExtractionResponse }
  | { name: "done"; summary: string };

export function SyllabusUpload({
  courses,
  onPlanChanged,
}: {
  courses: Course[];
  onPlanChanged: () => void;
}) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);

  // Courses can be created after this mounts (the add-course form sits right above).
  // Without this sync, the picker stays empty and upload reports "Add a course first"
  // even though one now exists.
  useEffect(() => {
    if (!courses.some((c) => c.id === courseId)) setCourseId(courses[0]?.id ?? "");
  }, [courses, courseId]);

  async function handleFile(file: File) {
    if (!courseId) {
      setError("Add a course first.");
      return;
    }

    setError(null);
    try {
      // --- 1. Read the PDF locally.
      setPhase({ name: "reading", progress: "Reading the document…" });
      const parsed = await extractPdfText(file, (done, total) =>
        setPhase({ name: "reading", progress: `Reading page ${done} of ${total}…` }),
      );

      if (parsed.likelyScanned) {
        setPhase({ name: "idle" });
        setError(
          "This PDF appears to be a scan with no selectable text. Extraction needs real text, " +
            "and OCR is not supported yet — you can still add the assignments by hand.",
        );
        return;
      }

      // --- 2. Store the original. The PDF stays viewable next to the extracted data (FR-3).
      const form = new FormData();
      form.append("file", file);
      form.append("type", "syllabus");
      const { document } = await api.upload<{ document: { id: string; filename: string } }>(
        `/api/courses/${courseId}/documents`,
        form,
      );

      // --- 3. Extract from the page text, not the bytes.
      setPhase({ name: "extracting" });
      const result = await api.post<ExtractionResponse>(`/api/documents/${document.id}/extract`, {
        pages: parsed.pages,
      });

      setPhase({
        name: "review",
        documentId: document.id,
        filename: document.filename,
        result,
      });
    } catch (e) {
      setPhase({ name: "idle" });
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  if (phase.name === "review") {
    return (
      <ExtractionReview
        documentId={phase.documentId}
        filename={phase.filename}
        initial={phase.result}
        onCancel={() => setPhase({ name: "idle" })}
        onConfirmed={(created) => {
          setPhase({
            name: "done",
            summary:
              `Added ${created.workItems} assignment${created.workItems === 1 ? "" : "s"}` +
              `${created.categories ? `, ${created.categories} grading categories` : ""}` +
              `${created.meetingPatterns ? `, ${created.meetingPatterns} class meetings` : ""}.`,
          });
          onPlanChanged();
        }}
      />
    );
  }

  const working = phase.name === "reading" || phase.name === "extracting";

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
        disabled={working}
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

      {/* The native file input's "No file chosen" strip cannot be styled, so the input
          is visually hidden behind a real label-button. Keyboard and screen-reader flow
          is unchanged: the input keeps focus and its label names the action. */}
      <label
        className="action"
        style={{
          display: "inline-block",
          cursor: working || courses.length === 0 ? "default" : "pointer",
          opacity: working || courses.length === 0 ? 0.5 : 1,
        }}
      >
        Choose a syllabus PDF…
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={working || courses.length === 0}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </label>

      {phase.name === "reading" && (
        <p className="muted" aria-live="polite">
          {phase.progress}
        </p>
      )}
      {phase.name === "extracting" && (
        <p className="muted" aria-live="polite">
          Finding assignments, dates, and grading weights…
        </p>
      )}
      {phase.name === "done" && (
        <>
          <p className="notice">{phase.summary}</p>
          <button className="action" onClick={() => setPhase({ name: "idle" })}>
            Upload another
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}

      <p className="muted" style={{ marginBottom: 0 }}>
        The PDF is read on this computer. Nothing extracted from it changes your plan until you
        review and confirm it.
      </p>
    </section>
  );
}
