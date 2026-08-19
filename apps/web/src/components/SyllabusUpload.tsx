import { useCallback, useEffect, useState } from "react";
import type { Course, ThemeName } from "@schoolquest/domain";
import { label } from "@schoolquest/theme-language";
import { api } from "../lib/api";
import { extractDocxText } from "../lib/docx-text";
import { extractPdfText, type DocumentPage } from "../lib/pdf-text";
import type { ExtractionResponse } from "../lib/extraction-types";
import { ExtractionReview } from "./ExtractionReview";
import { useBodyTheme } from "../lib/use-body-theme";

/**
 * Syllabus upload and extraction.
 *
 * Works in any shell — review is nicest on a big screen, but nothing here requires Tauri,
 * and gating it stranded browser use entirely. The PDF is parsed in the client, and the
 * resulting page text is what goes to the server for extraction. That is a deliberate
 * split: the Cloudflare Workers free plan gives 10ms of CPU per request, which cannot
 * parse a PDF, while any client machine barely notices. The Worker only waits on the
 * model, which is I/O and costs no CPU budget.
 *
 * Quest chrome is presentation only. The file that gets uploaded, the course it is filed
 * against, and every request made here are identical under all three themes.
 */

/** Word's own MIME type, spelled once. */
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Phase =
  | { name: "idle" }
  | { name: "reading"; progress: string }
  | { name: "extracting" }
  | { name: "review"; documentId: string; filename: string; result: ExtractionResponse }
  | {
      name: "done";
      created: { workItems: number; categories: number; meetingPatterns: number };
    };

/** A syllabus already uploaded for the selected course, as the documents list returns it. */
interface UploadedDoc {
  id: string;
  filename: string;
  type: string;
  mimeType: string;
  processingStatus: string;
}

/** Plain, honest words for a stored document's processing state. */
function statusWord(status: string): string {
  switch (status) {
    case "extracted":
      return "read";
    case "processing":
      return "reading...";
    case "failed":
      return "last read failed";
    default:
      return "not read yet";
  }
}


/** Themed wording on screen, plain wording for assistive technology. */
function Themed({ visible, plain }: { visible: string; plain: string }) {
  if (visible === plain) return <>{visible}</>;
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{plain}</span>
    </>
  );
}

const Q = {
  gold: "#c9a227",
  goldBright: "#e8c95a",
  goldDim: "#8a6f1f",
  goldEdge: "#6d5718",
  wax: "#8c2f28",
} as const;

/**
 * The course picker rendered as a cream rectangle with a hairline border and no arrow:
 * the Quest theme sets `appearance: none` on selects, and a background shorthand higher
 * in the cascade wipes out the chevron the stylesheet tries to paint. Nothing inline can
 * beat an `!important` shorthand, so the affordance is drawn as a sibling overlay — a
 * gold pull-tab with a chevron, `pointer-events: none` so clicks fall through to the
 * select. Data-URI SVG only; the CSP forbids external assets.
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

export function SyllabusUpload({
  courses,
  onPlanChanged,
  theme: themeProp,
  hasCalendar = true,
}: {
  courses: Course[];
  onPlanChanged: () => void;
  /** Optional. Omitted by the current call site, which is why the theme is read off body. */
  theme?: ThemeName;
  /**
   * Whether the term has a calendar yet.
   *
   * A gate, since the API made it one. A syllabus does not contain a calendar, it points at one:
   * "Week 14", "each Tuesday in class", "finals week". Read against an empty calendar those do
   * not fail loudly — they produce a date, silently, off by however much the guess was wrong.
   * The server refuses the upload with TERM_CALENDAR_REQUIRED, so the screen says so before the
   * student picks a file rather than after.
   */
  hasCalendar?: boolean;
}) {
  const theme = useBodyTheme(themeProp);
  const quest = theme === "quest";
  // "Questline" / "Course" / "Theater", and "Task" / "Assignment" — the wording lives in
  // @schoolquest/theme-language rather than in synonyms hard-coded here.
  const courseNoun = label("course", theme);
  const workNoun = label("assignment", theme).toLowerCase();

  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);

  // Courses can be created after this mounts (the add-course form sits right above).
  // Without this sync, the picker stays empty and upload reports "Add a course first"
  // even though one now exists.
  useEffect(() => {
    if (!courses.some((c) => c.id === courseId)) setCourseId(courses[0]?.id ?? "");
  }, [courses, courseId]);

  /**
   * The syllabi already on the selected course, so a class with no work can be re-read without
   * uploading the same file a second time. Follows the picker: switch course, see its documents.
   */
  const loadDocs = useCallback(async () => {
    if (!courseId) {
      setDocs([]);
      return;
    }
    try {
      const { documents } = await api.get<{ documents: UploadedDoc[] }>(
        `/api/courses/${courseId}/documents`,
      );
      setDocs(documents.filter((d) => d.type === "syllabus"));
    } catch {
      // A list that cannot load is just an absent list, not an error on the upload card.
      setDocs([]);
    }
  }, [courseId]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  /**
   * Reads a document to page text in the browser, or returns null after explaining why it could
   * not. `.docx` is decided by extension or the stored MIME type, since a freshly picked file
   * reports its type inconsistently.
   */
  async function readToPages(
    file: File,
    filename: string,
    mimeType?: string,
  ): Promise<DocumentPage[] | null> {
    setPhase({ name: "reading", progress: "Reading the document…" });
    const isDocx = /\.docx$/i.test(filename) || mimeType === DOCX_MIME;
    const parsed = isDocx
      ? await extractDocxText(file)
      : await extractPdfText(file, (done, total) =>
          setPhase({ name: "reading", progress: `Reading page ${done} of ${total}…` }),
        );

    if (parsed.likelyScanned) {
      setPhase({ name: "idle" });
      setError(
        "This PDF appears to be a scan with no selectable text. Extraction needs real text, " +
          "and OCR is not supported yet — you can still add the assignments by hand.",
      );
      return null;
    }
    return parsed.pages;
  }

  /**
   * Extracts against an already-stored document and enters review. Re-running replaces the
   * previous batch of claims rather than stacking duplicates (the server deletes the old ones),
   * and nothing reaches the plan until the student confirms.
   */
  async function extractAndReview(documentId: string, filename: string, pages: DocumentPage[]) {
    setPhase({ name: "extracting" });
    const result = await api.post<ExtractionResponse>(`/api/documents/${documentId}/extract`, {
      pages,
    });
    setPhase({ name: "review", documentId, filename, result });
  }

  /**
   * Re-reads a syllabus that is already uploaded, in place. The parsed page text is never stored
   * server-side, so this fetches the original file back and parses it again here before handing
   * the same document id to extraction. The old claims are replaced, no duplicate document is
   * made, and the student lands on the review screen exactly as a first upload would.
   */
  async function reprocess(doc: UploadedDoc) {
    setError(null);
    try {
      const blob = await api.blob(`/api/documents/${doc.id}/file`);
      const file = new File([blob], doc.filename, { type: doc.mimeType });
      const pages = await readToPages(file, doc.filename, doc.mimeType);
      if (pages === null) return;
      await extractAndReview(doc.id, doc.filename, pages);
    } catch (e) {
      setPhase({ name: "idle" });
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  async function handleFile(file: File) {
    if (!courseId) {
      setError(`Add a ${courseNoun.toLowerCase()} first.`);
      return;
    }

    setError(null);
    try {
      // --- 1. Read the document locally.
      const pages = await readToPages(file, file.name, file.type);
      if (pages === null) return;

      // --- 2. Store the original. It stays viewable next to the extracted data (FR-3).
      //
      // The server checks the declared type, and browsers report .docx inconsistently -- an
      // empty string or application/octet-stream, depending on what the OS has registered. By
      // this point the file has been parsed as a .docx successfully, so re-declaring it is a
      // statement of fact rather than a guess, and it keeps the server's check strict.
      const isDocx = /\.docx$/i.test(file.name);
      const form = new FormData();
      form.append("file", isDocx && file.type !== DOCX_MIME ? new File([file], file.name, { type: DOCX_MIME }) : file);
      form.append("type", "syllabus");
      const { document } = await api.upload<{ document: { id: string; filename: string } }>(
        `/api/courses/${courseId}/documents`,
        form,
      );

      // --- 3. Extract from the page text, not the bytes.
      await extractAndReview(document.id, document.filename, pages);
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
        // Counts are kept rather than a finished sentence, so the summary can be worded
        // for the active theme at render time and still read plainly to a screen reader.
        onConfirmed={(created) => {
          setPhase({ name: "done", created });
          onPlanChanged();
          void loadDocs();
        }}
      />
    );
  }

  const working = phase.name === "reading" || phase.name === "extracting";

  function summarize(noun: string): string {
    if (phase.name !== "done") return "";
    const { workItems, categories, meetingPatterns } = phase.created;
    return (
      `Added ${workItems} ${noun}${workItems === 1 ? "" : "s"}` +
      `${categories ? `, ${categories} grading categories` : ""}` +
      `${meetingPatterns ? `, ${meetingPatterns} class meetings` : ""}.`
    );
  }

  return (
    <section className="card">
      <h2>
        {quest && (
          <span aria-hidden="true" style={{ color: Q.goldDim }}>
            {"⚜ "}
          </span>
        )}
        <Themed visible={quest ? "Chart a questline" : "Syllabus upload"} plain="Syllabus upload" />
      </h2>

      {/* The Plain card opens straight into the picker; the quest one says what a syllabus
          is for here, because "Chart a questline" alone does not name the document. */}
      {quest && (
        <p className="muted" style={{ marginTop: 0 }}>
          <Themed
            visible="A syllabus is the map a questline is drawn from. Choose the PDF and its dates, weights, and tasks are read straight off it."
            plain="Upload a course syllabus PDF and its dates, grading weights, and assignments are read out of it."
          />
        </p>
      )}

      {/*
        The order is the rule, and the server enforces it. Said here, before a file is chosen,
        because a refusal the student meets after picking five PDFs is a worse way to learn it.
      */}
      {!hasCalendar && (
        <div className="risk" data-level="decision_needed" style={{ margin: "0 0 0.7rem" }}>
          <span className="level">first</span>
          <span>
            Add your semester calendar before uploading. A syllabus says &ldquo;Week 14&rdquo; and
            &ldquo;finals week&rdquo; without ever saying which dates those are — the calendar is
            the only thing that knows, so reading one without it produces dates nobody can trust.
          </span>
        </div>
      )}

      {/* Quest gets a visible label as well as the accessible one: with the native arrow
          suppressed, an unlabelled cream box beside a button reads as decoration. */}
      {quest ? (
        <label
          htmlFor="upload-course"
          style={{
            display: "block",
            fontSize: "0.7rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: Q.wax,
            marginBottom: "0.3rem",
          }}
        >
          <Themed visible={courseNoun} plain="Course" />
        </label>
      ) : (
        <label className="sr-only" htmlFor="upload-course">
          Course
        </label>
      )}

      <span
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          marginBottom: "0.75rem",
        }}
      >
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
            width: "100%",
          }}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {quest && <SelectChevron dim={working} />}
      </span>

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
        <Themed
          visible={quest ? "Chart from a syllabus PDF…" : "Choose a syllabus PDF…"}
          plain="Choose a syllabus PDF…"
        />
        <input
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          disabled={working || courses.length === 0 || !hasCalendar}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </label>

      {/* Already-uploaded syllabi for this course, each re-readable in place. This is the
          answer to a class that shows a syllabus but no work: the read can be run again --
          because it was never confirmed, or because the first pass found nothing -- without
          uploading the same file a second time and leaving a duplicate behind. */}
      {docs.length > 0 && (
        <div className="uploaded-syllabi">
          <p className="uploaded-syllabi-head">
            <Themed
              visible={quest ? "Maps already charted" : "Already uploaded"}
              plain="Already uploaded"
            />
          </p>
          <ul>
            {docs.map((doc) => (
              <li key={doc.id}>
                <span className="uploaded-syllabi-name">
                  {doc.filename}
                  <span className="muted"> &middot; {statusWord(doc.processingStatus)}</span>
                </span>
                <button
                  className="action"
                  disabled={working}
                  onClick={() => void reprocess(doc)}
                >
                  <Themed
                    visible={quest ? "Read it again" : "Review again"}
                    plain="Review again"
                  />
                </button>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
            Reads the syllabus again and opens the review. Use this if a class has no work yet.
            Nothing changes until you confirm.
          </p>
        </div>
      )}

      {phase.name === "reading" && (
        <p className="muted" aria-live="polite">
          {phase.progress}
        </p>
      )}
      {phase.name === "extracting" && (
        <p className="muted" aria-live="polite">
          <Themed
            visible={
              quest
                ? "Reading the syllabus for tasks, dates, and grading weights…"
                : "Finding assignments, dates, and grading weights…"
            }
            plain="Finding assignments, dates, and grading weights…"
          />
        </p>
      )}
      {phase.name === "done" && (
        <>
          <p className="notice">
            {quest && (
              <span aria-hidden="true" style={{ color: Q.goldDim }}>
                {"✦ "}
              </span>
            )}
            <Themed visible={summarize(workNoun)} plain={summarize("assignment")} />
          </p>
          <button className="action" onClick={() => setPhase({ name: "idle" })}>
            <Themed
              visible={quest ? "Chart another" : "Upload another"}
              plain="Upload another"
            />
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}

      <p className="muted" style={{ marginBottom: 0 }}>
        <Themed
          visible={
            quest
              ? "The PDF is read on this computer. Nothing found in it is written to your questlines until you have reviewed and confirmed it."
              : "The PDF is read on this computer. Nothing extracted from it changes your plan until you review and confirm it."
          }
          plain="The PDF is read on this computer. Nothing extracted from it changes your plan until you review and confirm it."
        />
      </p>
    </section>
  );
}
