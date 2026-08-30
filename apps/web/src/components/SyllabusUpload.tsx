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

/** What the file pickers accept -- PDF or Word, spelled once for the upload and replace inputs. */
const ACCEPT = `.pdf,.docx,application/pdf,${DOCX_MIME}`;

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
  /** A chosen replacement awaiting confirmation, because replacing wipes the class first. */
  /** A syllabus staged for removal, awaiting confirmation. */
  const [pendingRemove, setPendingRemove] = useState<UploadedDoc | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{ doc: UploadedDoc; file: File } | null>(
    null,
  );

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

  /**
   * Stores the original bytes against the selected course and returns the new document.
   *
   * The server checks the declared type, and browsers report .docx inconsistently -- an empty
   * string or application/octet-stream, depending on what the OS has registered. By the time this
   * runs the file has already been parsed as a .docx successfully, so re-declaring it is a
   * statement of fact rather than a guess, and it keeps the server's check strict. Shared by a
   * first upload and by replacing an existing syllabus.
   */
  async function storeFile(file: File): Promise<{ id: string; filename: string }> {
    const isDocx = /\.docx$/i.test(file.name);
    const form = new FormData();
    form.append("file", isDocx && file.type !== DOCX_MIME ? new File([file], file.name, { type: DOCX_MIME }) : file);
    form.append("type", "syllabus");
    const { document } = await api.upload<{ document: { id: string; filename: string } }>(
      `/api/courses/${courseId}/documents`,
      form,
    );
    return document;
  }

  async function handleFile(file: File) {
    if (!courseId) {
      setError(`Add a ${courseNoun.toLowerCase()} first.`);
      return;
    }

    setError(null);
    try {
      // Read locally (FR-3: the original stays viewable), store it, then extract from the page
      // text rather than the bytes.
      const pages = await readToPages(file, file.name, file.type);
      if (pages === null) return;
      const document = await storeFile(file);
      await extractAndReview(document.id, document.filename, pages);
    } catch (e) {
      setPhase({ name: "idle" });
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  /**
   * Re-upload and start the class over: swap a new file in for an existing syllabus, and wipe
   * everything the old one produced. Runs only after the student confirms, because it is
   * destructive.
   *
   * Order matters. The new file is parsed and stored first, so a file that turns out to be a scan
   * -- or an upload that fails -- stops here and nothing is lost. Only then is the class reset
   * (its assignments, grades, grading scheme and class times deleted) and the old document
   * removed. Finally the new syllabus is read into the now-empty course. The course itself, and
   * the calendar, survive; nothing reaches the plan until the new read is confirmed.
   */
  async function doReplace(doc: UploadedDoc, file: File) {
    if (!courseId) return;
    setError(null);
    try {
      const pages = await readToPages(file, file.name, file.type);
      if (pages === null) return;
      const document = await storeFile(file);
      await api.post(`/api/courses/${courseId}/reset-academics`);
      await api.del(`/api/documents/${doc.id}`).catch(() => {
        // Best effort: the new syllabus is already in and about to be read. A stale old row is
        // visible in this same list and can be removed by hand rather than blocking the re-read.
      });
      await extractAndReview(document.id, document.filename, pages);
    } catch (e) {
      setPhase({ name: "idle" });
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  /**
   * Removes an uploaded syllabus: its stored file and its extraction claims. Any assignments a
   * confirmed review already created stay -- those are the student's records, not the file's, and
   * are edited or skipped on the Assignments screen. This is just for getting a wrong or stray
   * document off the class.
   */
  async function removeDoc(doc: UploadedDoc) {
    setError(null);
    try {
      await api.del(`/api/documents/${doc.id}`);
      setPendingRemove(null);
      await loadDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  if (phase.name === "review") {
    return (
      <ExtractionReview
        documentId={phase.documentId}
        filename={phase.filename}
        initial={phase.result}
        // Refresh on the way out too: a replace deletes the old document before review, so the
        // list would otherwise still show a row that no longer exists if the review is cancelled.
        onCancel={() => {
          setPhase({ name: "idle" });
          void loadDocs();
        }}
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
          accept={ACCEPT}
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

          {/* Replacing is destructive -- it empties the class before reading the new file -- so
              it is never done on the click that picked the file. This is the deliberate second
              step, and it names exactly what is about to be lost. */}
          {pendingReplace && (
            <div className="replace-confirm" role="alertdialog" aria-label="Confirm replacing the syllabus">
              <p style={{ margin: "0 0 0.6rem" }}>
                Replace the syllabus for{" "}
                <strong>{courses.find((c) => c.id === courseId)?.name ?? "this class"}</strong> with{" "}
                <strong>{pendingReplace.file.name}</strong>?
              </p>
              <p className="muted" style={{ margin: "0 0 0.7rem" }}>
                This deletes every assignment, recorded grade, grading weight and class time
                already on this {courseNoun.toLowerCase()}, then reads the new file from scratch.
                It cannot be undone. Nothing changes until you confirm the new read afterwards.
              </p>
              <div className="button-row">
                <button
                  className="action primary"
                  disabled={working}
                  onClick={() => {
                    const { doc, file } = pendingReplace;
                    setPendingReplace(null);
                    void doReplace(doc, file);
                  }}
                >
                  {quest ? "Redraw the map" : "Replace and start over"}
                </button>
                <button
                  className="action"
                  disabled={working}
                  onClick={() => setPendingReplace(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <ul>
            {docs.map((doc) => (
              <li key={doc.id}>
                <span className="uploaded-syllabi-name">
                  {doc.filename}
                  <span className="muted"> &middot; {statusWord(doc.processingStatus)}</span>
                </span>
                <span className="uploaded-syllabi-actions">
                  {/* Continue: re-read the same file and open the review again. */}
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
                  {/* Start over: swap in a different file in place of this one. */}
                  <label
                    className="action"
                    style={{
                      cursor: working ? "default" : "pointer",
                      opacity: working ? 0.5 : 1,
                    }}
                  >
                    <Themed visible={quest ? "Chart anew…" : "Replace…"} plain="Replace…" />
                    <input
                      type="file"
                      accept={ACCEPT}
                      className="sr-only"
                      disabled={working}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        // Staged, not run: replacing wipes the class, so it waits on a confirm.
                        if (file) setPendingReplace({ doc, file });
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {/* Take a wrong or stray syllabus off the class. Assignments already added stay. */}
                  <button
                    className="action"
                    disabled={working}
                    onClick={() => setPendingRemove(pendingRemove?.id === doc.id ? null : doc)}
                  >
                    Remove
                  </button>
                </span>
                {pendingRemove?.id === doc.id && (
                  <div
                    className="replace-confirm"
                    role="alertdialog"
                    aria-label="Confirm removing the syllabus"
                    style={{ marginTop: "0.5rem" }}
                  >
                    <p style={{ margin: "0 0 0.5rem" }}>
                      Remove <strong>{doc.filename}</strong> from this {courseNoun.toLowerCase()}?
                    </p>
                    <p className="muted" style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>
                      This deletes the uploaded file. Any assignments already added from it stay --
                      edit or remove those on the {label("assignment", theme).toLowerCase()}s screen.
                    </p>
                    <div className="button-row">
                      <button className="action primary" disabled={working} onClick={() => void removeDoc(doc)}>
                        Remove
                      </button>
                      <button className="action" disabled={working} onClick={() => setPendingRemove(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
            <strong>Review again</strong> re-reads this file and opens the review -- use it if a
            class has no work yet. <strong>Replace</strong> starts the class over: it clears the
            class's assignments and grading, then reads a different file in their place. Both open
            the review, and nothing changes until you confirm it.
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
