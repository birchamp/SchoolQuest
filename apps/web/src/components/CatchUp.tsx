import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Catch-up: reconcile the study blocks whose time has passed but were never marked.
 *
 * The load-bearing rule this screen enforces: **"not marked done" never means "not done."** The
 * app never assumes a block happened, so before anything reschedules it asks the student what
 * actually got done. Without this a block the student finished but forgot to check off would be
 * treated as undone and reflowed back into the future as phantom work -- and, separately, a block
 * missed yesterday was simply unreachable, since Today only ever acts on the current block.
 *
 * Marking reuses the ordinary per-session endpoints. Only once the list is clear is a deliberate
 * replan offered -- reflow is never automatic, and never before the student has spoken.
 */

interface CatchUpBlock {
  sessionId: string;
  workItemId: string;
  title: string;
  courseName: string | null;
  courseCode: string | null;
  startAt: string;
  endAt: string;
  minutes: number;
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function whenLabel(startAt: string, endAt: string): string {
  const s = new Date(startAt);
  const e = new Date(endAt);
  const time = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${DAY[s.getDay()]} ${time(s)}–${time(e)}`;
}

export function CatchUp({
  termId,
  now,
  onReconciled,
  onReplan,
}: {
  termId: string;
  /** Dev-only simulated clock, forwarded so a walked term reconciles against its own "now". */
  now?: string | null;
  /** Called after a block is marked, so the rest of the app reflects the change. */
  onReconciled: () => void;
  /** A deliberate, stable replan of what is left. Offered only once catch-up is clear. */
  onReplan: () => void;
}) {
  const [blocks, setBlocks] = useState<CatchUpBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True once the student has cleared a non-empty list this visit, so we can offer the replan. */
  const [justCleared, setJustCleared] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = now ? `?now=${encodeURIComponent(now)}` : "";
      const { blocks } = await api.get<{ blocks: CatchUpBlock[] }>(
        `/api/terms/${termId}/catchup${q}`,
      );
      setBlocks(blocks);
    } catch {
      setBlocks([]);
    } finally {
      setLoaded(true);
    }
  }, [termId, now]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mark(block: CatchUpBlock, action: "done" | "missed") {
    setBusy(block.sessionId + action);
    setError(null);
    try {
      if (action === "done") {
        await api.post(`/api/work-sessions/${block.sessionId}/complete`, { outcome: "completed" });
      } else {
        await api.post(`/api/work-sessions/${block.sessionId}/skip`);
      }
      const rest = blocks.filter((b) => b.sessionId !== block.sessionId);
      setBlocks(rest);
      if (rest.length === 0) setJustCleared(true);
      onReconciled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  async function markAll(action: "done" | "missed") {
    setBusy("all" + action);
    setError(null);
    try {
      for (const block of blocks) {
        if (action === "done") {
          await api.post(`/api/work-sessions/${block.sessionId}/complete`, { outcome: "completed" });
        } else {
          await api.post(`/api/work-sessions/${block.sessionId}/skip`);
        }
      }
      setBlocks([]);
      setJustCleared(true);
      onReconciled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return null;

  // Nothing outstanding, and nothing was cleared this visit: no card at all.
  if (blocks.length === 0 && !justCleared) return null;

  if (blocks.length === 0) {
    // Caught up. Offer the one deliberate replan, then get out of the way.
    return (
      <section className="card" aria-labelledby="catchup-done-heading">
        <h2 id="catchup-done-heading">Caught up</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Thanks -- that is recorded. Anything you did not get to is still owed; replan to fit it
          back into your week around everything already on it.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="button-row">
          <button
            className="action primary"
            onClick={() => {
              onReplan();
              setJustCleared(false);
            }}
          >
            Replan my week
          </button>
          <button className="action" onClick={() => setJustCleared(false)}>
            Not now
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="catchup-heading">
      <h2 id="catchup-heading">Before we go on</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {blocks.length === 1
          ? "One study block came and went without being marked. Did you do it?"
          : `${blocks.length} study blocks came and went without being marked. Which did you do?`}{" "}
        Nothing reschedules until you say -- a block left unmarked is never assumed done.
      </p>

      {error && <p className="error">{error}</p>}

      <ul className="uploaded-syllabi" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {blocks.map((block) => (
          <li
            key={block.sessionId}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ flex: "1 1 14rem" }}>
              <strong>{block.title}</strong>
              <span className="muted">
                {" "}
                &middot; {block.courseCode ?? block.courseName ?? "course"} &middot;{" "}
                {whenLabel(block.startAt, block.endAt)}
              </span>
            </span>
            <span className="button-row">
              <button
                className="action primary"
                disabled={busy !== null}
                onClick={() => void mark(block, "done")}
              >
                Did it
              </button>
              <button
                className="action"
                disabled={busy !== null}
                onClick={() => void mark(block, "missed")}
              >
                Didn&apos;t
              </button>
            </span>
          </li>
        ))}
      </ul>

      {blocks.length > 1 && (
        <div className="button-row" style={{ marginTop: "0.6rem" }}>
          <button className="action" disabled={busy !== null} onClick={() => void markAll("done")}>
            I did all of these
          </button>
          <button className="action" disabled={busy !== null} onClick={() => void markAll("missed")}>
            I didn&apos;t get to any
          </button>
        </div>
      )}
    </section>
  );
}
