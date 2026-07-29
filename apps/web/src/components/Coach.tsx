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

/**
 * Conversation starters. Every one is a *planning* question — what to work on, when, in
 * what order (packages/ai/src/guardrail.ts draws the same line). The `kicker` is quest
 * decoration only: it is rendered aria-hidden, so the accessible name of each chip stays
 * the plain question underneath it.
 */
const SUGGESTIONS: { prompt: string; kicker: string }[] = [
  { prompt: "What should I work on now?", kicker: "RIGHT NOW" },
  { prompt: "I only have 25 minutes", kicker: "A SHORT WINDOW" },
  { prompt: "I missed yesterday, fix my week", kicker: "A MISSED DAY" },
  { prompt: "Why this instead of my reading?", kicker: "THE REASONING" },
];

/**
 * The quest-theme opening. This exists because the coach panel was a large empty slab of
 * parchment before the first message — the fix is to have the guide set the scene, the way
 * a game master opens a session, and to move the starters inside the panel where the eye
 * already is. Wording carries no streak, no decay and no implication of being behind
 * (docs/02-prd.md §3), and it states the boundary the coach actually enforces.
 */
const GUIDE_OPENING =
  "The map is drawn and the week lies open. Tell me what stands in front of you, and I will say where to begin, how long it should take, and what is safe to leave for later.";
const GUIDE_CODA = "No day is lost by resting — the plan simply redraws itself around you.";
const GUIDE_CREED =
  "The guide counsels on order and timing: what to begin, what to protect, and how to redraw a week. It will not write, solve, or answer the work itself.";

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

  // --- Quest-theme empty state ------------------------------------------------------
  // Inline styles only: the stylesheet is shared and owned elsewhere. Colours come from
  // the quest custom properties, which are defined on body[data-theme="quest"] and so
  // resolve for anything rendered inside this branch.
  const questEdge = "#9b7c3c";
  const questMuted = "#6b5636";
  const questMutedStrong = "#4a3620";

  /** One corner mark of the illuminated frame. Decoration; never announced. */
  const cornerMark = (pos: { top?: number; bottom?: number; left?: number; right?: number }) => (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        ...pos,
        fontSize: "0.5rem",
        lineHeight: 1,
        color: "rgba(138, 111, 31, 0.75)",
      }}
    >
      ◆
    </span>
  );

  const questOpening = (
    <div style={{ maxWidth: "46rem", margin: "0.2rem auto 0", width: "100%" }}>
      {/* 1. The illuminated block: the guide sets the scene. */}
      <div
        style={{
          position: "relative",
          padding: "1.15rem 1.35rem 1.05rem",
          borderRadius: "4px",
          border: `1px solid ${questEdge}`,
          background:
            "linear-gradient(165deg, rgba(255, 250, 238, 0.85), rgba(228, 212, 176, 0.5))",
          boxShadow:
            "inset 0 1px 0 rgba(255, 252, 244, 0.8), inset 0 0 34px rgba(139, 106, 44, 0.13)",
        }}
      >
        {cornerMark({ top: 4, left: 6 })}
        {cornerMark({ top: 4, right: 6 })}
        {cornerMark({ bottom: 4, left: 6 })}
        {cornerMark({ bottom: 4, right: 6 })}

        {/* No eyebrow here. The card heading already names the guide; a second and third
            label saying the same words read as a rendering fault rather than a flourish,
            so the illuminated capital opens the block on its own. */}
        <p
          style={{
            margin: 0,
            fontSize: "1.02rem",
            lineHeight: 1.55,
            color: "var(--q-ink)",
          }}
        >
          <span className="sr-only">{GUIDE_OPENING}</span>
          <span aria-hidden="true">
            <span
              style={{
                float: "left",
                fontSize: "3.1rem",
                lineHeight: 0.8,
                fontWeight: 700,
                margin: "0.1rem 0.3rem 0 0",
                color: "var(--q-wax)",
                textShadow: "0 1px 0 rgba(255, 252, 244, 0.85)",
              }}
            >
              {GUIDE_OPENING.slice(0, 1)}
            </span>
            {GUIDE_OPENING.slice(1)}
          </span>
        </p>

        <p
          style={{
            clear: "both",
            margin: "0.75rem 0 0",
            fontStyle: "italic",
            fontSize: "0.9rem",
            lineHeight: 1.5,
            color: questMutedStrong,
          }}
        >
          {GUIDE_CODA}
        </p>
      </div>

      {/* 2. A rule beneath, the way a chapter break is set in a rulebook. */}
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.7rem",
          margin: "1.15rem 0 0.9rem",
        }}
      >
        <span
          style={{
            flex: 1,
            height: "1px",
            background:
              "linear-gradient(90deg, transparent, rgba(138, 111, 31, 0.75) 70%, rgba(138, 111, 31, 0.85))",
          }}
        />
        <span style={{ color: "var(--q-gold-dim)", fontSize: "0.75rem", letterSpacing: "0.3em" }}>
          ✦
        </span>
        <span
          style={{
            flex: 1,
            height: "1px",
            background:
              "linear-gradient(270deg, transparent, rgba(138, 111, 31, 0.75) 70%, rgba(138, 111, 31, 0.85))",
          }}
        />
      </div>

      {/* 3. The starters, as seals set into the page rather than pills floating below it. */}
      <div role="group" aria-label="Suggested questions to ask the coach">
        <p
          aria-hidden="true"
          style={{
            margin: "0 0 0.6rem",
            textAlign: "center",
            fontSize: "0.64rem",
            fontWeight: 700,
            letterSpacing: "0.22em",
            color: "var(--q-wax)",
          }}
        >
          ◈&nbsp;&nbsp;OPENING MOVES&nbsp;&nbsp;◈
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 19rem), 1fr))",
            gap: "0.55rem",
          }}
        >
          {SUGGESTIONS.map((s) => (
            <button
              key={s.prompt}
              type="button"
              onClick={() => void send(s.prompt)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                font: "inherit",
                cursor: "pointer",
                padding: "0.55rem 0.75rem 0.6rem",
                borderRadius: "4px",
                border: `1px solid ${questEdge}`,
                background:
                  "linear-gradient(165deg, rgba(255, 250, 238, 0.92), rgba(228, 212, 176, 0.7))",
                color: "var(--q-ink)",
                boxShadow: "inset 0 1px 0 rgba(255, 252, 244, 0.85), 0 1px 3px rgba(0, 0, 0, 0.18)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "block",
                  marginBottom: "0.15rem",
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  color: questMuted,
                }}
              >
                <span style={{ color: "var(--q-gold-dim)" }}>✧</span> {s.kicker}
              </span>
              <span style={{ fontSize: "0.93rem", lineHeight: 1.35 }}>{s.prompt}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 4. The boundary, stated plainly and quietly. */}
      <p
        style={{
          display: "flex",
          gap: "0.55rem",
          alignItems: "baseline",
          margin: "1rem 0 0",
          padding: "0.6rem 0.8rem",
          borderLeft: "3px solid var(--q-wax)",
          background: "rgba(74, 54, 32, 0.08)",
          fontSize: "0.82rem",
          lineHeight: 1.5,
          fontStyle: "italic",
          color: questMutedStrong,
        }}
      >
        {/* A geometric mark, not ⚑ — the flag has emoji presentation in this font stack and
            rendered as a bright orange system glyph against the gold and oxblood palette. */}
        <span aria-hidden="true" style={{ color: "var(--q-wax)", fontStyle: "normal" }}>
          ❖
        </span>
        <span>{GUIDE_CREED}</span>
      </p>
    </div>
  );

  // The message area itself is shared between themes; quest wraps it in a parchment
  // card so the chat reads as a framed panel rather than bubbles floating on leather.
  // The floor exists so the quest panel is a substantial page of parchment rather than a
  // sliver. Plain has no such frame, so the same floor left a ~200px void between the
  // intro and the starters — a calm planner must not look broken to look calm.
  const chatArea = (
    <div className="chat" style={quest ? { minHeight: "18rem" } : undefined}>
      {messages.length === 0 &&
        (quest ? (
          questOpening
        ) : (
          <div className="bubble assistant">
            I help you decide what to work on and when. I will not do the assignments themselves,
            and I stick to your coursework — ask me what is worth starting, how to break something
            down, or how to recover a day you lost.
          </div>
        ))}

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

  // --- Composer ---------------------------------------------------------------------
  // Same form, same accessible name, same tab order under both themes; only the chrome
  // changes. Under quest it is rendered *inside* the parchment section so it belongs to
  // the same object as the panel above it — before this it was the one element sitting
  // bare on the leather, and it read as unstyled. `position: static` retires the sticky
  // behaviour there, because a footer of the page cannot also float over the page.
  const composer = (
    <form
      className="composer"
      style={quest ? { position: "static", padding: 0 } : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void send(draft);
      }}
    >
      <label className="sr-only" htmlFor="coach-input">
        Ask the planning coach
      </label>
      {quest && (
        // The nib resting beside the slot. Decoration; never announced.
        <span
          aria-hidden="true"
          style={{
            alignSelf: "center",
            color: "var(--q-gold-dim)",
            fontSize: "0.85rem",
            lineHeight: 1,
            padding: "0 0.1rem",
          }}
        >
          ✦
        </span>
      )}
      <input
        id="coach-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`Ask the ${label("coach", theme).toLowerCase()}…`}
        disabled={sending}
        autoComplete="off"
        style={
          quest
            ? {
                // A slot pressed into the parchment rather than a control laid on top of
                // it. The parchment fill and brown edge come from the themed .card input
                // rule; the recess is the part inline styling can add.
                borderRadius: "3px",
                padding: "0.6rem 0.75rem",
                boxShadow:
                  "inset 0 2px 4px rgba(74, 54, 32, 0.32), inset 0 -1px 0 rgba(255, 252, 244, 0.6)",
              }
            : undefined
        }
      />
      <button className="action primary" type="submit" disabled={sending || !draft.trim()}>
        Send
      </button>
    </form>
  );

  return (
    <div>
      {quest ? (
        <section className="card">
          {/* Themed wording is decoration; the heading a screen reader announces is plain.
              This is the only place the guide is named — see the empty state. */}
          <h2>
            <span aria-hidden="true">⚜ THE {label("coach", theme).toUpperCase()}</span>
            <span className="sr-only">Planning coach</span>
          </h2>
          {chatArea}

          {/* The error belongs to the panel too. --at-risk is tuned for the leather ground
              and washes out on parchment, so the ink is the seal red the card already uses. */}
          {error && (
            <p className="error" style={{ margin: "0.2rem 0 0", color: "var(--q-wax)" }}>
              {error}
            </p>
          )}

          {/* The writing shelf: a double rule echoing the card's own double frame, with the
              parchment shaded where the desk falls away. */}
          <div
            style={{
              marginTop: "0.3rem",
              paddingTop: "0.85rem",
              borderTop: "3px double rgba(138, 111, 31, 0.7)",
              background: "linear-gradient(180deg, rgba(74, 54, 32, 0.12), transparent 75%)",
            }}
          >
            {composer}
          </div>
        </section>
      ) : (
        <>
          {chatArea}

          {error && <p className="error">{error}</p>}

          {/* Quest carries the starters inside the parchment panel. Plain lists them as an
              even set of options: the flex pill row wrapped 3 + 1 and left a ragged shelf,
              which is the sort of thing a calm planner is judged on. */}
          {messages.length === 0 && (
            <div role="group" aria-label="Suggested questions to ask the coach">
              <p className="muted" style={{ margin: "0 0 0.45rem", fontSize: "0.82rem" }}>
                Or start with one of these:
              </p>
              <div
                className="suggestions"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 24rem), 1fr))",
                  gap: "0.5rem",
                }}
              >
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.prompt}
                    onClick={() => send(s.prompt)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      borderRadius: "8px",
                      padding: "0.5rem 0.75rem",
                    }}
                  >
                    {s.prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {composer}
        </>
      )}
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
