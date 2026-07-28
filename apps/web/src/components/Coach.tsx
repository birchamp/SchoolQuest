import { useEffect, useRef, useState } from "react";
import type { ThemeName } from "@schoolquest/domain";
import { label } from "@schoolquest/theme-language";
import { api } from "../lib/api";
import type { CoachActionView, CoachMessageView, CoachReplyResponse } from "../lib/types";

/**
 * Coach chat (docs/02-prd.md FR-15).
 *
 * Two things matter in this component beyond plumbing:
 *  - A refusal renders as an ordinary reply with a dashed border, not as an error state.
 *    The coach declining to do an assignment is normal operation, not a failure.
 *  - Every action button is executed by the student's click, never by the model.
 */

const SUGGESTIONS = [
  "What should I work on now?",
  "I only have 25 minutes",
  "I missed yesterday, fix my week",
  "Why this instead of my reading?",
];

export function Coach({
  termId,
  theme,
  onPlanChanged,
}: {
  termId: string;
  theme: ThemeName;
  onPlanChanged: () => void;
}) {
  const [messages, setMessages] = useState<CoachMessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<{ messages: CoachMessageView[] }>("/api/coach/messages")
      .then((r) => setMessages(r.messages))
      .catch(() => setMessages([]));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;

    setDraft("");
    setError(null);
    setSending(true);
    // Optimistic echo so the input clears immediately — waiting with your words still in
    // the box feels like the app dropped them.
    setMessages((prev) => [
      ...prev,
      {
        id: `pending-${prev.length}`,
        role: "user",
        content: message,
        actions: [],
        refused: false,
        pending: true,
      },
    ]);

    try {
      const reply = await api.post<CoachReplyResponse>("/api/coach/messages", {
        termId,
        message,
      });

      setMessages((prev) => [
        ...prev.map((m) => (m.pending ? { ...m, pending: false } : m)),
        {
          id: `reply-${prev.length}`,
          role: "assistant",
          content: formatReply(reply),
          actions: reply.actions,
          refused: reply.refused,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The coach could not be reached.");
      setMessages((prev) => prev.filter((m) => !m.pending));
    } finally {
      setSending(false);
    }
  }

  async function runAction(action: CoachActionView) {
    const sessionId = action.payload["sessionId"];
    try {
      switch (action.type) {
        case "START_SESSION":
          if (typeof sessionId === "string") {
            await api.post(`/api/work-sessions/${sessionId}/start`);
          }
          break;
        case "SKIP_SESSION":
          if (typeof sessionId === "string") {
            await api.post(`/api/work-sessions/${sessionId}/skip`);
          }
          break;
        case "LOCK_SESSION":
          if (typeof sessionId === "string") {
            await api.post(`/api/work-sessions/${sessionId}/lock`, { locked: true });
          }
          break;
        case "REPLAN_WEEK":
          await api.post(`/api/terms/${termId}/plans/generate`, { reason: "coach_request" });
          break;
        default:
          // SHOW_* actions are navigational; refreshing the plan is the useful response.
          break;
      }
      onPlanChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That action did not work.");
    }
  }

  const quest = theme === "quest";

  // The message area itself is shared between themes; quest wraps it in a parchment
  // card so the chat reads as a framed panel rather than bubbles floating on leather.
  const chatArea = (
    <div className="chat" style={{ minHeight: "18rem" }}>
      {messages.length === 0 && (
        <div className="bubble assistant">
          I help you decide what to work on and when. I will not do the assignments
          themselves, and I stick to your coursework — ask me what is worth starting, how to
          break something down, or how to recover a day you lost.
        </div>
      )}

      {messages.map((m) => (
        <div
          key={m.id}
          className={`bubble ${m.role}${m.refused && m.role === "assistant" ? " refused" : ""}`}
          style={m.pending ? { opacity: 0.6 } : undefined}
        >
          {m.content}
          {m.actions.length > 0 && (
            <div className="button-row" style={{ marginTop: "0.7rem" }}>
              {m.actions.map((action, i) => (
                <button key={i} className="action" onClick={() => runAction(action)}>
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {sending && (
        <div className="bubble assistant" aria-live="polite">
          <span className="muted">Thinking…</span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );

  return (
    <div>
      {quest ? (
        <section className="card">
          <h2>{label("coach", theme)} — your guide</h2>
          {chatArea}
        </section>
      ) : (
        chatArea
      )}

      {error && <p className="error">{error}</p>}

      {messages.length === 0 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <label className="sr-only" htmlFor="coach-input">
          Ask the planning coach
        </label>
        <input
          id="coach-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Ask the ${label("coach", theme).toLowerCase()}…`}
          disabled={sending}
          autoComplete="off"
        />
        <button className="action primary" type="submit" disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/** Appends facts and assumptions so the student can see what was known vs inferred. */
function formatReply(reply: CoachReplyResponse): string {
  let text = reply.message;
  if (reply.assumptions.length > 0) {
    text += `\n\nAssuming: ${reply.assumptions.join("; ")}`;
  }
  return text;
}
