import { useState } from "react";
import type { ThemeName } from "@schoolquest/domain";
import { explainRisk, label } from "@schoolquest/theme-language";
import { api } from "../lib/api";
import type { PlanResponse } from "../lib/types";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [primary, ...alternatives] = plan.recommendations;
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
  const today = new Date().toISOString().slice(0, 10);

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

  async function complete(sessionId: string, outcome: string) {
    setBusy(sessionId + outcome);
    setError(null);
    try {
      await api.post(`/api/work-sessions/${sessionId}/complete`, { outcome });
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

      {primary ? (
        <section className="card primary-action" aria-labelledby="primary-heading">
          <h2 id="primary-heading">{label("todayAction", theme)}</h2>
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
              onClick={() => complete(primary.sessionId, "completed")}
            >
              Mark done
            </button>
            <button
              className="action"
              disabled={busy !== null}
              onClick={() => complete(primary.sessionId, "needs_another_session")}
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
          <h2>Or instead</h2>
          <ul className="alternatives">
            {alternatives.slice(0, 2).map((alt) => (
              <li key={alt.sessionId}>
                <span>
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
                <span>{s.title}</span>
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
        <h2>Capacity this week</h2>
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
