import { useState } from "react";
import type { ThemeName } from "@schoolquest/domain";
import { explainRisk, label } from "@schoolquest/theme-language";
import { api } from "../lib/api";
import type { PlanResponse } from "../lib/types";

/** "95" -> "1h 35m". Minutes alone stop being legible somewhere past a couple of hours. */
function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** What the server reports back when a session outcome is recorded. */
interface CompleteResult {
  status: string;
  workItemStatus: string;
  /** The item's real `pointsPossible`, and only on the call that finished it. */
  pointsBanked: number | null;
}

/**
 * The Today view (docs/02-prd.md FR-11).
 *
 * One primary recommendation with a plain-language rationale, at most two alternatives,
 * and a quiet list of what is protected later — never an undifferentiated task list.
 */
export function Today({
  plan,
  theme,
  onChanged,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  onChanged: () => void;
}) {
  const progress = plan.progress;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<
    { title: string; points: number | null; minutes: number } | null
  >(null);

  const [primary, ...alternatives] = plan.recommendations;
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
  const today = new Date().toISOString().slice(0, 10);

  // Quest-theme presentation only. Domain data and Plain/Mission rendering are untouched.
  const quest = theme === "quest";
  const questInk = "#2a1f14";
  const questGold = "#c9a227";
  const questWax = "#8c2f28";

  /** 1-4 effort pips from session length; wording for screen readers stays plain. */
  function effortPips(durationMinutes: number) {
    const n = durationMinutes <= 30 ? 1 : durationMinutes <= 60 ? 2 : durationMinutes <= 90 ? 3 : 4;
    return (
      <span
        role="img"
        aria-label={`estimated effort: ${n} of 4`}
        style={{ color: questGold, letterSpacing: "0.15em" }}
      >
        <span aria-hidden="true">{"◆".repeat(n) + "◇".repeat(4 - n)}</span>
      </span>
    );
  }

  async function act(sessionId: string, action: "start" | "skip" | "lock", body?: unknown) {
    setBusy(sessionId + action);
    setError(null);
    try {
      await api.post(`/api/work-sessions/${sessionId}/${action}`, body);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Records an outcome and, when that outcome actually finished a piece of work, marks the
   * moment. This is the one celebratory beat in the app and it stays deliberately quiet:
   * an acknowledgment the student can dismiss, never a modal, never a sound, never a
   * score that can later go down.
   */
  async function complete(sessionId: string, outcome: string, title: string, minutes: number) {
    setBusy(sessionId + outcome);
    setError(null);
    try {
      const result = await api.post<CompleteResult>(
        `/api/work-sessions/${sessionId}/complete`,
        { outcome },
      );
      if (result.workItemStatus === "completed") {
        setFinished({ title, points: result.pointsBanked, minutes });
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  // Everything scheduled after today: visible, de-emphasized, and explicitly "protected".
  const protectedLater = plan.sessions
    .filter((s) => s.startAt.slice(0, 10) > today)
    .slice(0, 6)
    .map((s) => ({
      id: s.id,
      title: itemsById.get(s.workItemId)?.title ?? "Session",
      when: new Date(s.startAt).toLocaleDateString(undefined, { weekday: "short" }),
      minutes: s.minutes,
    }));

  const capacityPercent =
    plan.capacity.availableMinutes > 0
      ? Math.min(100, (plan.capacity.usedMinutes / plan.capacity.availableMinutes) * 100)
      : 0;

  return (
    <div>
      {error && <p className="error">{error}</p>}

      {progress && progress.itemsTotal > 0 && (
        <section className="campaign-strip" aria-label={`${label("progress", theme)} this term`}>
          <div className="campaign-strip-head">
            <span className="campaign-strip-title">
              {quest && <span aria-hidden="true">{"⚜ "}</span>}
              {quest ? "Campaign progress" : "Term progress"}
            </span>
            {/* Points are only ever shown when the engine says they are the real measure.
                Most syllabi state category weights rather than per-item points, and in
                that case the honest count is how many pieces of work are finished. */}
            <span className="campaign-strip-count">
              <span aria-hidden="true">
                {quest && <span style={{ color: questGold }}>{"✦ "}</span>}
                {progress.basis === "points"
                  ? `${Math.round(progress.pointsDone).toLocaleString()} / ${Math.round(
                      progress.pointsTotal,
                    ).toLocaleString()} ${quest ? "XP" : "pts"}`
                  : `${progress.itemsDone} / ${progress.itemsTotal} ${quest ? "quests" : "tasks"}`}
              </span>
              <span className="sr-only">
                {progress.basis === "points"
                  ? `${Math.round(progress.pointsDone)} of ${Math.round(
                      progress.pointsTotal,
                    )} points completed`
                  : `${progress.itemsDone} of ${progress.itemsTotal} assignments completed`}
              </span>
            </span>
          </div>
          <div
            className="capacity-bar campaign-track"
            role="meter"
            aria-valuenow={Math.round(progress.completionFraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={
              progress.basis === "points"
                ? "Share of this term's points already earned"
                : "Share of this term's assignments already finished"
            }
          >
            <span style={{ width: `${progress.completionFraction * 100}%` }} />
          </div>
          {progress.sessionsCompleted > 0 && (
            <p className="campaign-strip-foot">
              {quest && (
                <span aria-hidden="true" style={{ color: questGold }}>
                  {"◆ "}
                </span>
              )}
              {quest ? "Time at the table: " : "Focused time logged: "}
              {formatEffort(progress.effortMinutes)} across {progress.sessionsCompleted}{" "}
              {progress.sessionsCompleted === 1 ? "session" : "sessions"}
            </p>
          )}
        </section>
      )}

      {/* The one celebratory beat in the app. It reports what was actually banked and
          nothing more — no streak, no multiplier, nothing that can be lost tomorrow. */}
      {finished && (
        <div className="completion-moment" role="status">
          <div>
            <p className="completion-title">
              {quest && (
                <span aria-hidden="true" style={{ color: questGold }}>
                  {"◈ "}
                </span>
              )}
              {quest ? "Quest complete" : "Marked done"}
            </p>
            {/* Points when the syllabus gave any, banked time otherwise. Most items carry
                no point value at all, and "+0 XP" would be both wrong and dispiriting —
                the minutes actually worked are always true. */}
            <p className="completion-detail">
              {finished.title}
              {" · "}
              <strong>
                {finished.points !== null ? (
                  <>
                    <span aria-hidden="true">
                      +{Math.round(finished.points)} {quest ? "XP" : "pts"}
                    </span>
                    <span className="sr-only">{Math.round(finished.points)} points recorded</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">
                      {formatEffort(finished.minutes)} {quest ? "at the table" : "logged"}
                    </span>
                    <span className="sr-only">{finished.minutes} minutes of work recorded</span>
                  </>
                )}
              </strong>
            </p>
            <p className="completion-note">
              {quest
                ? "Banked. The week redraws itself around what is left."
                : "Recorded. Your plan has been updated around what remains."}
            </p>
          </div>
          <button className="action" onClick={() => setFinished(null)}>
            Dismiss
          </button>
        </div>
      )}

      {primary ? (
        <section className="card primary-action" aria-labelledby="primary-heading">
          <h2 id="primary-heading">
            {quest ? (
              <>
                <span aria-hidden="true">⚜ </span>MAIN QUEST
              </>
            ) : (
              label("todayAction", theme)
            )}
          </h2>
          {quest && (
            <p
              style={{
                margin: "0 0 0.35rem",
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                flexWrap: "wrap",
                fontSize: "0.78rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: questWax,
              }}
            >
              <span>Questline: {coursesById.get(primary.courseId)?.name}</span>
              {(() => {
                const xp = itemsById.get(primary.workItemId)?.pointsPossible;
                return xp != null ? (
                  <span
                    style={{
                      border: `1px solid ${questGold}`,
                      borderRadius: "4px",
                      padding: "0.1rem 0.45rem",
                      color: questInk,
                      background: "rgba(201, 162, 39, 0.25)",
                      fontWeight: 700,
                    }}
                  >
                    <span aria-hidden="true">✦ </span>
                    {xp} XP
                  </span>
                ) : null;
              })()}
              {effortPips(primary.durationMinutes)}
            </p>
          )}
          <p className="title">{primary.title}</p>
          <p className="meta">
            {coursesById.get(primary.courseId)?.name} &middot; {primary.durationMinutes} minutes
            &middot;{" "}
            {new Date(primary.startAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          <p className="rationale">{primary.explanation}</p>
          {primary.tradeoff && <p className="muted">{primary.tradeoff}</p>}

          <div className="button-row">
            <button
              className="action primary"
              disabled={busy !== null}
              onClick={() => act(primary.sessionId, "start")}
            >
              {label("startSession", theme)}
            </button>
            {/* Two-tap completion path (FR-12). */}
            <button
              className="action"
              disabled={busy !== null}
              onClick={() =>
                complete(
                  primary.sessionId,
                  "completed",
                  primary.title,
                  primary.durationMinutes,
                )
              }
            >
              Mark done
            </button>
            <button
              className="action"
              disabled={busy !== null}
              onClick={() =>
                complete(
                  primary.sessionId,
                  "needs_another_session",
                  primary.title,
                  primary.durationMinutes,
                )
              }
            >
              Needs more time
            </button>
            <button
              className="action"
              disabled={busy !== null}
              onClick={() => act(primary.sessionId, "skip")}
            >
              Not now
            </button>
          </div>
        </section>
      ) : (
        <section className="card">
          <h2>{label("todayAction", theme)}</h2>
          <p className="muted">
            Nothing is scheduled for the rest of today. That is a real answer, not an error — the
            week ahead is still planned.
          </p>
        </section>
      )}

      {alternatives.length > 0 && (
        <section className="card">
          <h2>{quest ? "Side quests" : "Or instead"}</h2>
          <ul className="alternatives">
            {alternatives.slice(0, 2).map((alt) => (
              <li key={alt.sessionId}>
                <span>
                  {quest && (
                    <span aria-hidden="true" style={{ color: questGold }}>
                      {"◆ "}
                    </span>
                  )}
                  {alt.title}
                  <span className="muted"> &middot; {alt.durationMinutes} min</span>
                </span>
                <button
                  className="action"
                  disabled={busy !== null}
                  onClick={() => act(alt.sessionId, "start")}
                >
                  Start
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card protected">
        <h2>{label("futureWork", theme)}</h2>
        {protectedLater.length === 0 ? (
          <p className="muted">Nothing else is scheduled this week.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {protectedLater.map((s) => (
              <li key={s.id}>
                <span>
                  {quest && <span aria-hidden="true" style={{ color: "#8a6f1f" }}>{"◈ "}</span>}
                  {s.title}
                </span>
                <span>
                  {s.when} &middot; {s.minutes}m
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
          This work is accounted for. You are not choosing to drop it by working on something
          else now.
        </p>
      </section>

      <section className="card">
        <h2>{quest ? "Stamina" : "Capacity this week"}</h2>
        <div
          className="capacity-bar"
          role="meter"
          aria-valuenow={Math.round(capacityPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Share of available study time already scheduled"
        >
          <span style={{ width: `${capacityPercent}%` }} />
        </div>
        <p className="muted">
          {plan.capacity.usedMinutes} of {plan.capacity.availableMinutes} available minutes are
          scheduled.
        </p>

        {plan.risks.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            {plan.risks.slice(0, 4).map((risk, index) => (
              <div className="risk" data-level={risk.level} key={`${risk.code}-${index}`}>
                <span className="level">{risk.level.replace("_", " ")}</span>
                <span>{risk.explanation ?? explainRisk(risk.code)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
