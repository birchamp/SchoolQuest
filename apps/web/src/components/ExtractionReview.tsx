import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  ISSUE_TEXT,
  REJECTION_TEXT,
  type AssignmentPayload,
  type ClaimView,
  type ExtractionResponse,
  type QuestionPayload,
} from "../lib/extraction-types";

/**
 * Extraction review (docs/02-prd.md FR-3, FR-4).
 *
 * The rule this screen exists to enforce: nothing extracted reaches the plan until a human
 * has looked at it. So the design goal is not "show the AI's answer" but "make checking it
 * fast". Every row carries the page and the literal quote it came from, and anything the
 * validator could not establish is stated in plain language rather than hidden behind a
 * confidence number.
 */
export function ExtractionReview({
  documentId,
  filename,
  initial,
  onConfirmed,
  onCancel,
}: {
  documentId: string;
  filename: string;
  initial?: ExtractionResponse;
  onConfirmed: (created: { workItems: number; categories: number; meetingPatterns: number }) => void;
  onCancel: () => void;
}) {
  const [claims, setClaims] = useState<ClaimView[]>(initial?.claims ?? []);
  const [rejected] = useState(initial?.rejected ?? []);
  const [warnings] = useState(initial?.warnings ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  /** What each answered question actually changed, keyed by question claim id. */
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initial) return;
    api
      .get<{ claims: ClaimView[] }>(`/api/documents/${documentId}/extraction`)
      .then((r) => setClaims(r.claims))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the review."));
  }, [documentId, initial]);

  // Default to accepting everything that is not a suspected duplicate. The common case is
  // "this is right", and making the student tick twenty boxes to get there is its own
  // barrier — but a duplicate should be a deliberate choice.
  useEffect(() => {
    setSelected(
      new Set(
        claims
          .filter((c) => c.claimType !== "clarification_question")
          .filter((c) => !(c.payload["duplicateOf"] as string | null))
          .map((c) => c.id),
      ),
    );
  }, [claims]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Sends an answer somewhere that acts on it.
   *
   * This used to PATCH the answer onto the question claim and stop: nothing anywhere read
   * `payload.answer`, so the question vanished from the screen and the claim stayed exactly as
   * undated as before. Every review looked clean regardless of what was actually settled, which
   * made clarification — the app's whole answer to the ambiguity it detects — a dead end.
   *
   * The server now applies a date when the answer contains one and says plainly when it does
   * not. The `.catch(() => undefined)` is gone with it: an answer that failed to save used to
   * look identical to one that worked.
   */
  async function saveAnswer(claim: ClaimView, answer: string) {
    setAnswers((prev) => ({ ...prev, [claim.id]: answer }));
    setError(null);
    try {
      const result = await api.post<{ applied: { title: string }[]; note: string }>(
        `/api/documents/${documentId}/extraction/answer`,
        { questionClaimId: claim.id, answer },
      );
      setOutcomes((prev) => ({ ...prev, [claim.id]: result.note }));
      if (result.applied.length > 0) {
        const fresh = await api.get<{ claims: ClaimView[] }>(
          `/api/documents/${documentId}/extraction`,
        );
        setClaims(fresh.claims);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That answer did not save.");
    }
  }

  /**
   * Applies one weekday to every assignment still listed by week range.
   *
   * The whole point of asking: a syllabus schedules thirteen quizzes by week and names the
   * weekday once in prose. One click here dates all thirteen, instead of leaving the
   * student to type thirteen dates.
   */
  async function resolveWeekday(weekday: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{
        weekday: string;
        resolved: {
          claimId: string;
          title: string;
          dueDate: string;
          needsAttention: boolean;
          reason: string | null;
        }[];
        unresolved: { title: string; reason: string }[];
      }>(`/api/documents/${documentId}/extraction/resolve-weekday`, { weekday });

      const byClaim = new Map(result.resolved.map((r) => [r.claimId, r]));
      setClaims((prev) =>
        prev.map((c) => {
          const hit = byClaim.get(c.id);
          if (!hit) return c;
          const payload = c.payload as unknown as AssignmentPayload;
          return {
            ...c,
            payload: {
              ...c.payload,
              dueDate: {
                ...payload.dueDate,
                iso: hit.dueDate,
                ...(hit.needsAttention ? {} : { ambiguity: "none" }),
              },
              issues: (payload.issues ?? []).filter(
                (i) => i !== "AMBIGUOUS_DATE" && i !== "MISSING_DATE",
              ),
              // Mirrors the server exactly. This used to say "confirmed" for everything,
              // which told the student a machine's reading had been settled by their click.
              confidenceStatus: hit.needsAttention ? "low_inference" : "high_inference",
            },
          };
        }),
      );

      const settled = result.resolved.filter((r) => !r.needsAttention).length;
      const flagged = result.resolved.filter((r) => r.needsAttention);
      setResolution(
        `Dated ${settled} item${settled === 1 ? "" : "s"} to the ` +
          `${result.weekday} of each listed week.` +
          (flagged.length > 0
            ? ` ${flagged.length} could not be settled that way: ${flagged
                .map((r) => r.title)
                .join(", ")}.`
            : "") +
          (result.unresolved.length > 0
            ? ` ${result.unresolved.length} could not use that day — check those below.`
            : ""),
      );
      // The server may have raised a finals-week question, so pull the list back rather than
      // leaving the screen showing a set of questions that no longer matches.
      if (flagged.length > 0) {
        const fresh = await api.get<{ claims: ClaimView[] }>(
          `/api/documents/${documentId}/extraction`,
        );
        setClaims(fresh.claims);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply that day.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{
        created: { workItems: number; categories: number; meetingPatterns: number };
      }>(`/api/documents/${documentId}/extraction/confirm`, {
        acceptedClaimIds: [...selected],
      });
      onConfirmed(result.created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save these.");
    } finally {
      setBusy(false);
    }
  }

  const assignments = claims.filter((c) => c.claimType === "assignment");
  const categories = claims.filter((c) => c.claimType === "grading_category");
  const meetings = claims.filter((c) => c.claimType === "meeting_pattern");
  const questions = claims.filter((c) => c.claimType === "clarification_question");

  return (
    <div>
      <section className="card">
        <h2>Review what was found</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          From <strong>{filename}</strong>. Nothing here is in your plan yet. Uncheck anything
          wrong, fix what needs fixing, then confirm.
        </p>

        {warnings.map((w, i) => (
          <div className="risk" data-level="watch" key={i}>
            <span className="level">check</span>
            <span>{w}</span>
          </div>
        ))}

        {rejected.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <h2>Discarded before review</h2>
            {rejected.map((r, i) => (
              <div className="risk" data-level="at_risk" key={i}>
                <span className="level">dropped</span>
                <span>
                  <strong>{r.title}</strong> — {REJECTION_TEXT[r.reason] ?? r.reason}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {questions.length > 0 && (
        <section className="card">
          <h2>A few questions</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            These change how your week gets planned. &ldquo;I don&apos;t know yet&rdquo; is a real
            answer — it stays visible as uncertainty instead of becoming a guess.
          </p>
          {resolution && <p className="notice">{resolution}</p>}

          {questions.map((claim) => {
            const q = claim.payload as unknown as QuestionPayload;

            // A "listed by week" question has a concrete, applicable answer: the weekday.
            // Offering the days as buttons resolves the whole set in one click, where a
            // free-text box would just record the word and change nothing.
            if (q.kind === "relative_date") {
              return (
                <div
                  key={claim.id}
                  style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)" }}
                >
                  <p style={{ margin: "0 0 0.2rem", fontWeight: 500 }}>{q.question}</p>
                  <p className="muted" style={{ margin: "0 0 0.5rem" }}>{q.why}</p>
                  <QuestionSource evidence={q.evidence} />
                  <div className="button-row">
                    {[
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      // A real syllabus in the corpus makes its weekly logs due "every Sunday
                      // by midnight". With no Sunday button the student could not give the
                      // right answer, only a wrong one or none.
                      "Saturday",
                      "Sunday",
                    ].map((day) => (
                      <button
                        key={day}
                        className="action"
                        disabled={busy}
                        onClick={() => void resolveWeekday(day)}
                      >
                        {day}
                      </button>
                    ))}
                    <button
                      className="action"
                      disabled={busy}
                      onClick={() => void saveAnswer(claim, "unknown")}
                    >
                      I don&apos;t know yet
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={claim.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)" }}>
                <p style={{ margin: "0 0 0.2rem", fontWeight: 500 }}>{q.question}</p>
                <p className="muted" style={{ margin: "0 0 0.5rem" }}>{q.why}</p>
                <QuestionSource evidence={q.evidence} />
                <div className="button-row">
                  <input
                    aria-label={q.question}
                    value={answers[claim.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [claim.id]: e.target.value }))
                    }
                    onBlur={(e) => e.target.value && void saveAnswer(claim, e.target.value)}
                    placeholder="Your answer"
                    style={{
                      flex: 1,
                      minWidth: "12rem",
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      color: "var(--text)",
                      font: "inherit",
                      fontSize: "0.9rem",
                      padding: "0.45rem 0.7rem",
                    }}
                  />
                  <button
                    className="action"
                    onClick={() => void saveAnswer(claim, "unknown")}
                    disabled={answers[claim.id] === "unknown"}
                  >
                    I don&apos;t know yet
                  </button>
                </div>
                {/*
                  What the answer actually did. Without this the question simply vanished, which
                  read as "settled" whether or not anything changed — the false pass this whole
                  path existed to produce.
                */}
                {outcomes[claim.id] && (
                  <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.82rem" }}>
                    {outcomes[claim.id]}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {assignments.length > 0 && (
        <section className="card">
          <h2>Assignments ({assignments.length})</h2>
          {assignments.map((claim) => (
            <AssignmentRow
              key={claim.id}
              claim={claim}
              checked={selected.has(claim.id)}
              onToggle={() => toggle(claim.id)}
              onPatch={(payload) =>
                setClaims((prev) =>
                  prev.map((c) => (c.id === claim.id ? { ...c, payload: { ...c.payload, ...payload } } : c)),
                )
              }
            />
          ))}
        </section>
      )}

      {categories.length > 0 && (
        <section className="card">
          <h2>Grading categories</h2>
          {categories.map((claim) => (
            <SimpleRow
              key={claim.id}
              claim={claim}
              checked={selected.has(claim.id)}
              onToggle={() => toggle(claim.id)}
              title={`${claim.payload["name"] as string} — ${
                claim.payload["weightPercent"] === null
                  ? "weight not stated"
                  : `${claim.payload["weightPercent"] as number}%`
              }`}
            />
          ))}
        </section>
      )}

      {meetings.length > 0 && (
        <section className="card">
          <h2>Class meetings</h2>
          {meetings.map((claim) => (
            <SimpleRow
              key={claim.id}
              claim={claim}
              checked={selected.has(claim.id)}
              onToggle={() => toggle(claim.id)}
              title={`${formatDays(claim.payload["daysOfWeek"] as number[])} ${
                claim.payload["startTime"] as string
              }–${claim.payload["endTime"] as string}${
                claim.payload["location"] ? ` · ${claim.payload["location"] as string}` : ""
              }`}
            />
          ))}
        </section>
      )}

      {error && <p className="error">{error}</p>}

      <section className="card">
        <div className="button-row">
          <button className="action primary" onClick={confirm} disabled={busy || selected.size === 0}>
            {busy ? "Adding…" : `Add ${selected.size} to my plan`}
          </button>
          <button className="action" onClick={onCancel} disabled={busy}>
            Not now
          </button>
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: "0.6rem" }}>
          Anything you leave unchecked stays here — it is not deleted, and you can come back.
        </p>
      </section>
    </div>
  );
}

function AssignmentRow({
  claim,
  checked,
  onToggle,
  onPatch,
}: {
  claim: ClaimView;
  checked: boolean;
  onToggle: () => void;
  onPatch: (payload: Record<string, unknown>) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const payload = claim.payload as unknown as AssignmentPayload;
  const issues = payload.issues ?? [];
  const needsAttention = issues.length > 0;

  async function patchDate(iso: string) {
    // A student's edit is authoritative: it clears the ambiguity the model flagged.
    const dueDate = { ...payload.dueDate, iso: iso || null, ambiguity: "none" };
    onPatch({ dueDate });
    await api.patch(`/api/extraction-claims/${claim.id}`, { payload: { dueDate } }).catch(() => undefined);
  }

  return (
    <div style={{ padding: "0.7rem 0", borderBottom: "1px solid var(--border)" }}>
      <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", cursor: "pointer" }}>
        <input type="checkbox" checked={checked} onChange={onToggle} style={{ marginTop: "0.35rem" }} />
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 500 }}>{payload.title}</span>
          {payload.isMajorProject && <span className="muted"> · major project</span>}
          <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
            {payload.type.replace("_", " ")}
            {payload.pointsPossible !== null && ` · ${payload.pointsPossible} points`}
            {payload.category && ` · ${payload.category}`}
          </span>
        </span>
      </label>

      <div style={{ marginLeft: "1.6rem", marginTop: "0.4rem" }}>
        <div className="button-row" style={{ alignItems: "center" }}>
          <label className="muted" htmlFor={`due-${claim.id}`} style={{ fontSize: "0.85rem" }}>
            Due
          </label>
          <input
            id={`due-${claim.id}`}
            type="date"
            defaultValue={payload.dueDate.iso ?? ""}
            onChange={(e) => void patchDate(e.target.value)}
            style={{
              background: "var(--surface-2)",
              border: `1px solid ${payload.dueDate.iso ? "var(--border)" : "var(--watch)"}`,
              borderRadius: "6px",
              color: "var(--text)",
              font: "inherit",
              fontSize: "0.85rem",
              padding: "0.3rem 0.5rem",
            }}
          />
          {payload.dueDate.raw && payload.dueDate.iso === null && (
            <span className="muted" style={{ fontSize: "0.82rem" }}>
              syllabus says &ldquo;{payload.dueDate.raw}&rdquo;
            </span>
          )}
          <button className="action" style={{ padding: "0.3rem 0.6rem", fontSize: "0.82rem" }} onClick={() => setShowEvidence((v) => !v)}>
            {showEvidence ? "Hide source" : `Source · p.${claim.pageNumber ?? "?"}`}
          </button>
        </div>

        {needsAttention && (
          <ul style={{ margin: "0.45rem 0 0", paddingLeft: "1rem" }}>
            {issues.map((issue) => (
              <li className="muted" style={{ fontSize: "0.82rem" }} key={issue}>
                {ISSUE_TEXT[issue] ?? issue}
                {issue === "DUPLICATE_OF_EARLIER_CLAIM" && payload.duplicateOf && (
                  <> (&ldquo;{payload.duplicateOf}&rdquo;)</>
                )}
              </li>
            ))}
          </ul>
        )}

        {showEvidence && (
          <blockquote className="notice" style={{ marginTop: "0.5rem", fontStyle: "italic" }}>
            &ldquo;{claim.sourceExcerpt}&rdquo;
            <span className="muted" style={{ display: "block", fontStyle: "normal", marginTop: "0.3rem" }}>
              Page {claim.pageNumber}
              {payload.evidenceVerified
                ? " · found in the document"
                : " · could not be matched exactly"}
            </span>
          </blockquote>
        )}
      </div>
    </div>
  );
}

function SimpleRow({
  claim,
  checked,
  onToggle,
  title,
}: {
  claim: ClaimView;
  checked: boolean;
  onToggle: () => void;
  title: string;
}) {
  const [showEvidence, setShowEvidence] = useState(false);

  return (
    <div style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
      <label style={{ display: "flex", gap: "0.6rem", alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span style={{ flex: 1, fontSize: "0.92rem" }}>{title}</span>
        <button
          className="action"
          style={{ padding: "0.25rem 0.55rem", fontSize: "0.8rem" }}
          onClick={(e) => {
            e.preventDefault();
            setShowEvidence((v) => !v);
          }}
        >
          p.{claim.pageNumber ?? "?"}
        </button>
      </label>
      {showEvidence && (
        <blockquote className="notice" style={{ marginTop: "0.4rem", fontStyle: "italic" }}>
          &ldquo;{claim.sourceExcerpt}&rdquo;
        </blockquote>
      )}
    </div>
  );
}

function formatDays(days: number[]): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.map((d) => names[d] ?? "?").join(" ");
}

/**
 * The syllabus lines a question came from.
 *
 * A question with no source is a question a student cannot check. "Which day of Week 5?" means
 * nothing alone and is obvious next to the row it came from -- and reading the real line is also
 * the only way to notice the app has misread something, which no other part of this screen
 * surfaces.
 *
 * Quoted, monospaced and marked with the page, so it reads as "this is what the document says"
 * rather than as more of the app's own prose. `<blockquote>` and `<cite>` because that is what
 * this is: a quotation with a source.
 */
function QuestionSource({ evidence }: { evidence?: { page: number; excerpt: string }[] }) {
  if (!evidence || evidence.length === 0) return null;

  return (
    <div style={{ margin: "0 0 0.6rem" }}>
      <p className="muted" style={{ margin: "0 0 0.25rem", fontSize: "0.78rem" }}>
        {evidence.length === 1 ? "From your syllabus:" : "From your syllabus:"}
      </p>
      {evidence.map((source) => (
        <blockquote
          key={`${source.page}-${source.excerpt}`}
          style={{
            margin: "0 0 0.3rem",
            padding: "0.35rem 0.6rem",
            borderLeft: "3px solid var(--accent-dim)",
            background: "var(--surface-2)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "0.8rem",
            lineHeight: 1.45,
            /* Syllabus lines are often long table rows; wrapping beats a scrollbar here. */
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {source.excerpt}
          <cite className="muted" style={{ display: "block", fontStyle: "normal", fontSize: "0.72rem", marginTop: "0.2rem" }}>
            page {source.page}
          </cite>
        </blockquote>
      ))}
    </div>
  );
}
