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
  /** Blocks that were still held for this item and are now the student's time again. */
  releasedSessions: number;
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
  onReplan,
  onGoToSetup,
  onOpenWork,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  /** A light refresh of the plan (re-read), used after starting or finishing a block. */
  onChanged: () => void;
  /**
   * A full replan, used when a block did not happen. Skipping keeps the work owed, so the
   * schedule has to be re-solved for the leftover to reflow into open time rather than sitting
   * where it was already missed. Falls back to a plain refresh if not supplied.
   */
  onReplan?: () => void;
  /** Takes the student to Setup, where the effort survey lives. */
  onGoToSetup: () => void;
  /**
   * Opens an assignment's full record -- the Assignments table row it lives in, which carries
   * its course, type, due date, effort, worth and status, and is where those are edited. Every
   * assignment this view names becomes a way in, so a title that meant nothing on its own
   * ("Reading quiz #1") is one click from everything the app knows about it.
   */
  onOpenWork: (workItemId: string) => void;
}) {
  const progress = plan.progress;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Session id whose "what came up?" prompt is open, or null. */
  const [interrupting, setInterrupting] = useState<string | null>(null);
  const [finished, setFinished] = useState<
    { title: string; points: number | null; minutes: number; released: number } | null
  >(null);

  const [primary, ...alternatives] = plan.recommendations;
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
  const today = new Date().toISOString().slice(0, 10);

  /**
   * "Revelation (REL 101)" -- the class an assignment belongs to, with its code when the
   * syllabus gave one. The plain answer to "which course is this for?", which the alternatives
   * and the forecast never used to state at all.
   */
  function courseLabel(courseId: string): string {
    const course = coursesById.get(courseId);
    if (!course) return "";
    return course.code ? `${course.name} (${course.code})` : course.name;
  }

  /**
   * An assignment title rendered as the way into its full record. Looks like the text around
   * it and reveals itself as a control on hover and focus, so the affordance is there without
   * turning the card into a field of links.
   */
  function titleLink(workItemId: string, title: string, className?: string) {
    return (
      <button
        type="button"
        className={`link-button${className ? ` ${className}` : ""}`}
        onClick={() => onOpenWork(workItemId)}
        aria-label={`Open details for ${title}`}
      >
        {title}
      </button>
    );
  }

  // Quest-theme presentation only. Domain data and Plain/Mission rendering are untouched.
  const quest = theme === "quest";
  const questInk = "#2a1f14";
  const questGold = "#c9a227";
  const questWax = "#8c2f28";

  /**
   * How far the questline this task belongs to has actually come.
   *
   * This slot used to hold four pips derived from the *session length* — an effort
   * estimate. Sitting immediately after "Questline: <course>" they read as questline
   * progress, and so a course the roster reported as "0 of 6 tasks, 0%" showed two filled
   * pips on the hero card. The fix is not better wording: it is to put the real number
   * here, drawn from the same ledger the Week tab prints, so the two can never disagree.
   */
  function questlineStanding(courseId: string) {
    const course = progress?.courses.find((c) => c.courseId === courseId);
    if (!course || course.itemsTotal === 0) return null;
    // A four-pip scale cannot express an early questline: 2 of 19 rounds to zero filled
    // pips, and four hollow diamonds read as a glyph that failed to load rather than as
    // "barely started". A short track shows the same fraction honestly at any size, and
    // it is the same language the Week roster speaks.
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "3.4rem",
            height: "6px",
            borderRadius: "1px",
            border: `1px solid ${questGold}`,
            background: "rgba(74, 54, 32, 0.25)",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${Math.max(course.completionFraction * 100, course.itemsDone > 0 ? 4 : 0)}%`,
              background: questGold,
            }}
          />
        </span>
        <span aria-hidden="true">
          {course.basis === "points"
            ? `${Math.round(course.pointsDone)} / ${Math.round(course.pointsTotal)} XP`
            : `${course.itemsDone} / ${course.itemsTotal}`}
        </span>
        <span className="sr-only">
          {course.basis === "points"
            ? `${Math.round(course.pointsDone)} of ${Math.round(course.pointsTotal)} points`
            : `${course.itemsDone} of ${course.itemsTotal} assignments`}{" "}
          finished in this course
        </span>
      </span>
    );
  }

  /** Records what took the time instead, and skips the block in the same call. */
  async function report(
    sessionId: string,
    body: { title: string; commitmentType: string; recurring: boolean | null },
  ) {
    setBusy(sessionId + "interrupted");
    setError(null);
    try {
      await api.post(`/api/work-sessions/${sessionId}/interrupted`, body);
      // The block did not happen; replan so the still-owed work reflows into open time.
      (onReplan ?? onChanged)();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function act(sessionId: string, action: "start" | "skip" | "lock", body?: unknown) {
    setBusy(sessionId + action);
    setError(null);
    try {
      await api.post(`/api/work-sessions/${sessionId}/${action}`, body);
      // A skip means the block did not happen, so the leftover has to be re-solved into open
      // time; starting or locking only needs the plan re-read.
      (action === "skip" ? (onReplan ?? onChanged) : onChanged)();
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
        setFinished({
          title,
          points: result.pointsBanked,
          minutes,
          released: result.releasedSessions ?? 0,
        });
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  // Everything scheduled after today: visible, de-emphasized, and explicitly "protected".
  //
  // Grouped by work item rather than listed per session. A long assignment is split into
  // several blocks, so the raw list printed "Lab Notebook" three times with nothing to
  // tell the entries apart — which reads as a rendering fault and hides how much else is
  // coming. One row per piece of work, with its blocks summed.
  const protectedLater = (() => {
    const groups = new Map<
      string,
      { id: string; courseId: string; title: string; when: string; minutes: number; blocks: number }
    >();
    for (const s of plan.sessions.filter((s) => s.startAt.slice(0, 10) > today)) {
      const existing = groups.get(s.workItemId);
      if (existing) {
        existing.minutes += s.minutes;
        existing.blocks += 1;
        continue;
      }
      groups.set(s.workItemId, {
        id: s.workItemId,
        courseId: s.courseId,
        title: itemsById.get(s.workItemId)?.title ?? "Session",
        // The first block's day: when this work starts, not when it ends.
        when: new Date(s.startAt).toLocaleDateString(undefined, { weekday: "short" }),
        minutes: s.minutes,
        blocks: 1,
      });
    }
    return [...groups.values()].slice(0, 6);
  })();

  const capacityPercent =
    plan.capacity.availableMinutes > 0
      ? Math.min(100, (plan.capacity.usedMinutes / plan.capacity.availableMinutes) * 100)
      : 0;
  const capacityPressure = capacityPercent >= 90 ? "tight" : capacityPercent >= 70 ? "full" : "easy";

  /**
   * How much of this week's booked time rests on a per-type constant rather than a real number.
   *
   * The effort survey has existed for a while and lives on Setup, three cards down. Nothing
   * pointed at it. On the five-course test term that meant 53 of 61 items carried no estimate
   * and the student was never told — every "you have four hours today" was a guess presented in
   * the same voice as a fact.
   *
   * Reported in minutes rather than as a count, because "eleven items" is not a consequence and
   * "two and a half of today's four hours" is. Nothing appears when the plan is grounded.
   */
  const guessedMinutes = (() => {
    const unknown = new Set(
      plan.risks.filter((r) => r.code === "EFFORT_UNKNOWN").map((r) => r.workItemId),
    );
    if (unknown.size === 0) return null;
    const minutes = plan.sessions
      .filter((s) => unknown.has(s.workItemId))
      .reduce((sum, s) => sum + s.minutes, 0);
    return minutes > 0 ? { minutes, items: unknown.size } : null;
  })();

  // Risks arrive one per work item, so the same sentence — "This due date has not been
  // confirmed." — was printed several times in a row. Collapsing identical explanations and
  // counting them says the same thing once and tells the student how widespread it is.
  const risks = (() => {
    const byText = new Map<string, { key: string; level: string; text: string; count: number }>();
    for (const risk of plan.risks) {
      /**
       * Dropped only when the line above is actually showing.
       *
       * That line states the same fact with its consequence and a button attached, so printing
       * "The time this takes is still a guess · 55 items" directly underneath says it twice in
       * adjacent rows. But it renders nothing when no unknown-effort item was scheduled this
       * week, and suppressing the row unconditionally would delete the information instead of
       * replacing it.
       */
      if (risk.code === "EFFORT_UNKNOWN" && guessedMinutes) continue;
      const text = risk.explanation ?? explainRisk(risk.code);
      const key = `${risk.level}:${text}`;
      const existing = byText.get(key);
      if (existing) existing.count += 1;
      else byText.set(key, { key, level: risk.level, text, count: 1 });
    }
    /**
     * Severest first, then only four.
     *
     * The cap was applied to collection order, which is the order the scheduler happens to push
     * risks: the per-item warnings are collected while work is being sized, and the "could not
     * fit this" ones only at the very end. So three watch-level rows could push a genuine
     * at-risk row off the bottom — observed on the test term, where "No available window fits
     * this before it is due" was invisible until an unrelated change freed a slot.
     *
     * Four is the cap because a wall of warnings is a wall nobody reads. Which four is the
     * decision that makes the cap safe rather than lossy.
     */
    const severity: Record<string, number> = { decision_needed: 0, at_risk: 1, watch: 2, safe: 3 };
    return [...byText.values()]
      .sort((a, b) => (severity[a.level] ?? 9) - (severity[b.level] ?? 9) || b.count - a.count)
      .slice(0, 4);
  })();



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
            {/* Says only what actually happened. The previous copy claimed the week
                redrew itself while the forecast below was pixel-identical — the blocks
                for the finished item were still sitting there. Now they are released,
                and the sentence reports the real count instead of a flourish. */}
            <p className="completion-note">
              {finished.released > 0
                ? quest
                  ? `${finished.released} held ${
                      finished.released === 1 ? "block" : "blocks"
                    } released — that time is yours again.`
                  : `${finished.released} scheduled ${
                      finished.released === 1 ? "block" : "blocks"
                    } for this were freed up.`
                : quest
                  ? "Banked. Nothing else was being held for it."
                  : "Recorded. Nothing else was scheduled for it."}
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
              {questlineStanding(primary.courseId)}
            </p>
          )}
          <p className="title">{titleLink(primary.workItemId, primary.title, "title-link")}</p>
          <p className="meta">
            {courseLabel(primary.courseId)} &middot; {primary.durationMinutes} minutes
            &middot;{" "}
            {new Date(primary.startAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
              // UTC, like every other clock in the app: stored wall-clock times are UTC.
              timeZone: "UTC",
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
              onClick={() => setInterrupting(primary.sessionId)}
            >
              Skipped
            </button>
          </div>

          {/* "Skipped" used to record `did_not_start` and stop there, throwing away the one
              fact worth having: not that the block did not happen, but what was there
              instead. Naming it is optional and takes one tap to decline — but when the same
              thing takes the same hour three weeks running, this is where the planner learns
              it, and the weekly review can offer to put it in the calendar for good. */}
          {interrupting === primary.sessionId && (
            <InterruptionPrompt
              busy={busy !== null}
              onSkip={() => {
                setInterrupting(null);
                void act(primary.sessionId, "skip");
              }}
              onReport={(body) => {
                setInterrupting(null);
                void report(primary.sessionId, body);
              }}
            />
          )}
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
                <span className="mention">
                  <span>
                    {quest && (
                      <span aria-hidden="true" style={{ color: questGold }}>
                        {"◆ "}
                      </span>
                    )}
                    {titleLink(alt.workItemId, alt.title)}
                    <span className="muted"> &middot; {alt.durationMinutes} min</span>
                  </span>
                  <span className="course-line muted">{courseLabel(alt.courseId)}</span>
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
                <span className="mention">
                  <span>
                    {quest && <span aria-hidden="true" style={{ color: "#8a6f1f" }}>{"◈ "}</span>}
                    {titleLink(s.id, s.title)}
                  </span>
                  <span className="course-line muted">{courseLabel(s.courseId)}</span>
                </span>
                <span>
                  {s.when} &middot; {formatEffort(s.minutes)}
                  {s.blocks > 1 && (
                    <span className="muted"> &middot; {s.blocks} blocks</span>
                  )}
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
        {/* A near-full bar means the week has almost no slack left — an alarm. Drawn in
            the same gold as everything else it read as a trophy: full meter, goal met.
            The pressure state repaints it and says plainly what a full week costs. */}
        <div
          className="capacity-bar"
          data-pressure={capacityPressure}
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
          {capacityPressure === "tight" && (
            <>
              {" "}
              <strong>
                {quest
                  ? "Little strength held in reserve — one long day will not fit."
                  : "Almost no slack left — one long day will not fit."}
              </strong>
            </>
          )}
        </p>

        {guessedMinutes && (
          <p className="guessed-time">
            <span>
              {quest
                ? `${formatEffort(guessedMinutes.minutes)} of this week's plan is guesswork — `
                : `${formatEffort(guessedMinutes.minutes)} of this week is booked on a guess — `}
              {guessedMinutes.items === 1
                ? "one piece of work whose length nobody has said."
                : `${guessedMinutes.items} pieces of work whose length nobody has said.`}
            </span>{" "}
            {/* A button rather than a sentence of advice: the whole point is to remove the
                step where the student has to go and find the survey. */}
            <button className="action" onClick={onGoToSetup}>
              {quest ? "Say how long they take" : "Tell it how long they take"}
            </button>
          </p>
        )}

        {risks.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            {risks.map((risk) => (
              <div className="risk" data-level={risk.level} key={risk.key}>
                <span className="level">{risk.level.replace("_", " ")}</span>
                <span>
                  {risk.text}
                  {risk.count > 1 && (
                    <span className="muted"> · {risk.count} items</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * "What came up?" — asked once, answered in one tap, and never insisted on.
 *
 * The whole value of this prompt is the *pattern* it makes possible: the same answer at the
 * same hour three weeks running is a standing commitment nobody wrote down, and the weekly
 * review can then offer to put it in the calendar so the planner stops booking over it.
 *
 * It is worded to make declining as ordinary as answering. "Skip it" is the plain first
 * option and carries no consequence — the block is recorded as not done either way, exactly
 * as it always was. Nothing here counts, scores, or remembers a miss (docs/01 §3); the
 * question is about the calendar, not about the student.
 */
const INTERRUPTION_KINDS: { value: string; label: string }[] = [
  { value: "work", label: "Work" },
  { value: "class", label: "Class or campus" },
  { value: "club", label: "Club or team" },
  { value: "worship", label: "Worship or service" },
  { value: "appointment", label: "Appointment" },
  { value: "exercise", label: "Exercise" },
  { value: "commute", label: "Travel" },
  { value: "other", label: "Something else" },
];

function InterruptionPrompt({
  busy,
  onSkip,
  onReport,
}: {
  busy: boolean;
  onSkip: () => void;
  onReport: (body: { title: string; commitmentType: string; recurring: boolean | null }) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("other");

  return (
    <form
      style={{
        marginTop: "0.75rem",
        paddingTop: "0.75rem",
        borderTop: "1px solid var(--border)",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const named = title.trim();
        if (named.length === 0) onSkip();
        else onReport({ title: named, commitmentType: kind, recurring: null });
      }}
    >
      <p className="muted" style={{ margin: "0 0 0.5rem" }}>
        Anything take this time instead? Saying so helps the planner stop booking an hour you
        are never free for. Leave it blank if you would rather not.
      </p>
      <div
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}
      >
        <label style={{ display: "grid", gap: "0.2rem", flex: "1 1 12rem" }}>
          <span className="sr-only">What came up?</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Shift, practice, ride home…"
            autoFocus
          />
        </label>
        <label style={{ display: "grid", gap: "0.2rem" }}>
          <span className="sr-only">What kind of thing was it?</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {INTERRUPTION_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="button-row" style={{ marginTop: "0.6rem" }}>
        <button className="action primary" type="submit" disabled={busy}>
          {title.trim().length > 0 ? "Save and move on" : "Skip it"}
        </button>
        {title.trim().length > 0 && (
          <button className="action" type="button" disabled={busy} onClick={onSkip}>
            Rather not say
          </button>
        )}
      </div>
    </form>
  );
}
