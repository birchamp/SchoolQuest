import type { ThemeName } from "@schoolquest/domain";
import { label } from "@schoolquest/theme-language";
import type { PlanResponse } from "../lib/types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Read-only Week Map (docs/02-prd.md FR-10).
 *
 * Drag-and-drop editing is desktop-only work and lands with Phase 4; this view exists so
 * the student can see the whole week — including what is protected later — from either
 * shell. Course color is paired with the course name so color is never the only signal.
 */
export function WeekMap({ plan, theme }: { plan: PlanResponse; theme: ThemeName }) {
  const quest = theme === "quest";
  const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);

  const start = plan.horizonStart ?? plan.planVersion?.horizonStart ?? today;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    return date.toISOString().slice(0, 10);
  });

  return (
    <section className="card">
      <h2>{label("weekMap", theme)}</h2>
      {quest && (
        <p className="muted" style={{ fontStyle: "italic", margin: "0 0 0.75rem" }}>
          The week lies open before you. Fixed banners hold their ground; the rest is
          yours to spend.
        </p>
      )}
      <div className="week">
        {days.map((date) => {
          const sessions = plan.sessions
            .filter((s) => s.startAt.slice(0, 10) === date)
            .sort((a, b) => a.startAt.localeCompare(b.startAt));
          const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
          const totalMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);

          return (
            <div className={`day${date === today ? " is-today" : ""}`} key={date}>
              <h3>
                {quest && date === today && <span aria-hidden="true">{"⚑ "}</span>}
                {DAY_NAMES[dayOfWeek]} {Number(date.slice(8, 10))}
                {date === today && <span className="sr-only"> (today)</span>}
              </h3>

              {sessions.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
                  {quest ? "Clear road" : "Open"}
                </p>
              ) : (
                sessions.map((s) => {
                  const item = itemsById.get(s.workItemId);
                  const course = coursesById.get(s.courseId);
                  return (
                    <div className="block" key={s.id}>
                      {quest && (
                        <span
                          aria-hidden="true"
                          style={{ float: "left", marginRight: "0.35rem" }}
                        >
                          {"◆"}
                        </span>
                      )}
                      <span className="time">
                        {new Date(s.startAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {s.locked && " · locked"}
                      </span>
                      {item?.title ?? "Session"}
                      <span className="time">{course?.name}</span>
                    </div>
                  );
                })
              )}

              {totalMinutes > 0 && (
                <p className="muted" style={{ fontSize: "0.7rem", margin: "0.3rem 0 0" }}>
                  {totalMinutes} min
                </p>
              )}
            </div>
          );
        })}
      </div>

      {plan.unscheduledWorkItemIds.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h2>
            {quest ? (
              <>
                <span aria-hidden="true">Unclaimed quests</span>
                <span className="sr-only">Not fitted into this week</span>
              </>
            ) : (
              "Not fitted into this week"
            )}
          </h2>
          <p className="muted" style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>
            These items need a decision before they can be scheduled.
          </p>
          {groupUnscheduledByCourse(plan).map((group) => (
            <details key={group.key} open={group.items.length <= 5}>
              <summary style={{ cursor: "pointer", padding: "0.25rem 0" }}>
                {group.name} — {group.items.length}{" "}
                {group.items.length === 1 ? "item" : "items"}{" "}
                {quest ? (
                  <span
                    style={{
                      background: "#8c2f28",
                      color: "#f2ead6",
                      borderRadius: 999,
                      padding: "0.05rem 0.6rem",
                      fontSize: "0.72rem",
                    }}
                  >
                    {group.items.length} unclaimed
                  </span>
                ) : (
                  null
                )}
              </summary>
              <ul className="alternatives" style={{ margin: "0.25rem 0 0.5rem" }}>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Groups the unscheduled work items by course so the list reads as a handful of
 * course headers instead of one undifferentiated dump. Items whose course is not
 * in the plan payload fall into an "Other" bucket rather than being dropped.
 */
function groupUnscheduledByCourse(plan: PlanResponse): {
  key: string;
  name: string;
  items: { id: string; title: string }[];
}[] {
  const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const groups = new Map<string, { key: string; name: string; items: { id: string; title: string }[] }>();

  for (const id of plan.unscheduledWorkItemIds) {
    const item = itemsById.get(id);
    const course = item ? coursesById.get(item.courseId) : undefined;
    const key = course?.id ?? "other";
    // Course names sometimes already carry the code ("General Biology I (BIO 240)");
    // appending it again produced "(BIO 240) (BIO 240)" in group headers.
    const name = course
      ? course.code && !course.name.includes(course.code)
        ? `${course.name} (${course.code})`
        : course.name
      : "Other";
    const group = groups.get(key) ?? { key, name, items: [] };
    group.items.push({ id, title: item?.title ?? id });
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
