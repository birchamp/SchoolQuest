import type { ThemeName } from "@schoolquest/domain";
import { label } from "@schoolquest/theme-language";
import type { PlanDiff, PlanDiffBlock, PlanResponse } from "../lib/types";

/**
 * What the last replan changed, said once and dismissable.
 *
 * Every regenerate used to redraw the week silently. A student who marked a day lost saw a
 * new week and had to find the difference by eye, which is the working-memory tax this app
 * exists to remove -- and the reassurance the product promises ("if I do that, will everything
 * else still get done?") is precisely a statement about what moved and what did not.
 *
 * Reads the diff the server returned with the plan. It names blocks by assignment and day, in
 * the app's UTC wall clock like every other view, and says nothing when nothing changed --
 * "nothing moved" is the answer worth stating then, in one line.
 */
export function PlanChanges({
  diff,
  plan,
  theme,
  risksNow,
  onDismiss,
}: {
  diff: PlanDiff;
  plan: PlanResponse;
  theme: ThemeName;
  /** Items the new plan flags as at risk or needing a decision, by count. */
  risksNow: number;
  onDismiss: () => void;
}) {
  const titles = new Map(plan.workItems.map((w) => [w.id, w.title]));
  const name = (b: PlanDiffBlock) => titles.get(b.workItemId) ?? label("workSession", theme);
  const quest = theme === "quest";

  const counts = [
    diff.kept.length > 0 ? `${diff.kept.length} kept` : null,
    diff.moved.length > 0 ? `${diff.moved.length} moved` : null,
    diff.added.length > 0 ? `${diff.added.length} added` : null,
    diff.dropped.length > 0 ? `${diff.dropped.length} dropped` : null,
  ].filter((c): c is string => c !== null);

  return (
    <section className="card plan-changes" aria-labelledby="plan-changes-heading" data-testid="plan-changes">
      <h2 id="plan-changes-heading">{quest ? "The map was redrawn" : "Plan updated"}</h2>
      {diff.unchanged ? (
        <p style={{ margin: 0 }}>
          Nothing moved. {diff.kept.length > 0 && `All ${diff.kept.length} blocks are where they were.`}
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong>{counts.join(" · ")}</strong>
            {risksNow > 0 && (
              <span className="muted">
                {" "}
                &middot; {risksNow} {risksNow === 1 ? "item" : "items"} still at risk
              </span>
            )}
          </p>
          <ul className="plan-changes-list">
            {diff.moved.map((m) => (
              <li key={m.from.sessionId}>
                <span className="plan-changes-kind">Moved</span> {name(m.to)}: {when(m.from)}{" "}
                <span aria-hidden="true">→</span>
                <span className="sr-only">to</span> {when(m.to)}
              </li>
            ))}
            {diff.added.map((b) => (
              <li key={b.sessionId}>
                <span className="plan-changes-kind">Added</span> {name(b)}: {when(b)}
              </li>
            ))}
            {diff.dropped.map((b) => (
              <li key={b.sessionId}>
                <span className="plan-changes-kind">Dropped</span> {name(b)}: was {when(b)}
                {plan.unscheduledWorkItemIds.includes(b.workItemId) && (
                  <span className="muted"> &middot; no room left this week; it is listed as a risk, not forgotten</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="button-row" style={{ marginTop: "0.6rem" }}>
        <button className="action" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </section>
  );
}

/** "Mon 9:00 AM", in the app's UTC wall clock. */
function when(b: PlanDiffBlock): string {
  const d = new Date(b.startAt);
  return `${d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })} ${d.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit", timeZone: "UTC" },
  )}`;
}
