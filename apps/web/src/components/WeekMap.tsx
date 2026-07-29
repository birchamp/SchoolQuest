import { colorTokenFor, type CourseColorToken, type ThemeName } from "@schoolquest/domain";
import { explainBlockKind, explainDayLoad, label, plainDayLoad } from "@schoolquest/theme-language";
import type { EncounterGroupView, PlanResponse, SessionBriefView } from "../lib/types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The week, laid out as the beats of one prepared session.
 *
 * This used to render one tile per scheduled block, which is why a review called it
 * "spreadsheet-in-costume": three blocks of the same lab report produced three identical
 * tiles, and Sunday showed "Final Portfolio" five times. It now renders the *beats* the
 * planning engine derives — one per piece of work per day, carrying how many blocks it
 * holds and what kind of work it is (see docs/07-session-prep-design.md).
 *
 * Each day also carries its load, from minutes weighted by cognitive demand, so the shape
 * of the week is legible before any single tile is read. A day where something major is due
 * is marked whether or not the plan booked time for it — an exam you have scheduled nothing
 * for is still the day's event.
 *
 * Course colour is always paired with the course name; colour is never the only signal.
 */

/** Matches the tinctures in Questline.tsx and CourseManager.tsx — one colour per course. */
const TINCTURES: Record<CourseColorToken, string> = {
  azure: "#2f4a6d",
  vermilion: "#8c2f28",
  verdant: "#3f6c45",
  amber: "#6b4a2a",
  violet: "#5a3b6b",
  sable: "#241a10",
};

/** Load → the tile-strip tint. Paired with the load's name, never used alone. */
const LOAD_TINT: Record<string, string> = {
  heavy: "#8c2f28",
  steady: "#8a6f1f",
  light: "#3f6c45",
  clear: "transparent",
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function WeekMap({
  plan,
  theme,
  brief,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  brief?: SessionBriefView;
}) {
  const quest = theme === "quest";
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);
  const start = plan.horizonStart ?? plan.planVersion?.horizonStart ?? today;

  // Falling back to the raw sessions keeps this view working against a plan payload that
  // predates the brief, rather than rendering an empty week.
  const days = brief?.days ?? fallbackDays(start);
  const encountersByDate = groupByDate(brief?.encounters ?? fallbackEncounters(plan));

  return (
    <section className="card">
      <h2>{label("weekMap", theme)}</h2>
      {quest && (
        <p className="muted" style={{ fontStyle: "italic", margin: "0 0 0.75rem" }}>
          Seven days, laid out as they will be played. The load on each day counts effort,
          not just hours.
        </p>
      )}

      <div className="week">
        {days.map((day) => {
          const beats = (encountersByDate.get(day.date) ?? []).sort((a, b) =>
            a.startAt.localeCompare(b.startAt),
          );
          const isCrux = brief?.crux?.date === day.date;

          return (
            <div
              className={`day${day.date === today ? " is-today" : ""}`}
              key={day.date}
              data-load={day.load}
            >
              {/* The load strip: the day's weight before a single title is read. */}
              <span
                aria-hidden="true"
                style={{
                  display: "block",
                  height: 3,
                  margin: "-0.1rem -0.1rem 0.35rem",
                  borderRadius: 2,
                  background: LOAD_TINT[day.load],
                }}
              />

              <h3>
                {quest && day.date === today && <span aria-hidden="true">{"❖ "}</span>}
                {DAY_NAMES[day.dayOfWeek]} {Number(day.date.slice(8, 10))}
                {day.date === today && <span className="sr-only"> (today)</span>}
              </h3>

              <p
                className="muted"
                style={{ fontSize: "0.68rem", margin: "0 0 0.35rem", letterSpacing: "0.04em" }}
              >
                <span aria-hidden="true">{explainDayLoad(day.load, theme)}</span>
                <span className="sr-only">{plainDayLoad(day.load)} day</span>
                {day.minutes > 0 && (
                  <>
                    {" · "}
                    {formatMinutes(day.minutes)}
                  </>
                )}
              </p>

              {/* Something major is due today. Stated whether or not time is booked for it. */}
              {day.carriesAssessment && (
                <p className="day-flag">
                  <span aria-hidden="true">{quest ? "◈ Set piece due" : "◈ Major work due"}</span>
                  <span className="sr-only">Major work is due today</span>
                </p>
              )}

              {isCrux && !day.carriesAssessment && (
                <p className="day-flag day-flag-crux">
                  <span aria-hidden="true">{quest ? "The crux" : "Busiest day"}</span>
                  <span className="sr-only">The heaviest day of this week</span>
                </p>
              )}

              {beats.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
                  {quest ? "Clear road" : "Open"}
                </p>
              ) : (
                beats.map((beat) => {
                  const course = coursesById.get(beat.courseId);
                  const kind = explainBlockKind(beat.kind, theme);
                  const tincture = TINCTURES[colorTokenFor(beat.courseId, course?.colorToken)];
                  return (
                    <div className="block" key={`${beat.workItemId}-${beat.date}`}>
                      {/* `sustained` is the default — ordinary work. Labelling it made
                          "LONG MARCH" appear nine times in one week and drowned out the
                          beats that actually differ. The same reason the engine stopped
                          calling every prep block a set piece: if everything is named,
                          no name means anything. */}
                      {beat.kind !== "sustained" && (
                        <span className="beat-kind" style={{ color: tincture }}>
                          <span aria-hidden="true">{kind.name}</span>
                          <span className="sr-only">{kind.plainName}:</span>
                        </span>
                      )}
                      {beat.title}
                      <span className="time">
                        {new Date(beat.startAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {" · "}
                        {formatMinutes(beat.minutes)}
                        {/* The count that replaced three identical tiles. */}
                        {beat.blocks > 1 && ` · ${beat.blocks} blocks`}
                      </span>
                      <span className="time">{course?.name}</span>
                    </div>
                  );
                })
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
              {/* The count is stated once per theme, never twice: quest carries it on the
                  wax seal, plain spells it out in the summary line. */}
              <summary style={{ cursor: "pointer", padding: "0.25rem 0" }}>
                {group.name}
                {quest ? (
                  <>
                    {" "}
                    <span className="wax-seal">
                      <span aria-hidden="true">{group.items.length} unclaimed</span>
                      <span className="sr-only">
                        {group.items.length} {group.items.length === 1 ? "item" : "items"} not
                        scheduled
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    {" — "}
                    {group.items.length} {group.items.length === 1 ? "item" : "items"}
                  </>
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

function groupByDate(encounters: EncounterGroupView[]): Map<string, EncounterGroupView[]> {
  const byDate = new Map<string, EncounterGroupView[]>();
  for (const beat of encounters) {
    byDate.set(beat.date, [...(byDate.get(beat.date) ?? []), beat]);
  }
  return byDate;
}

/** Seven clear days, for a plan payload with no brief attached. */
function fallbackDays(start: string): SessionBriefView["days"] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    const iso = date.toISOString().slice(0, 10);
    return {
      date: iso,
      dayOfWeek: date.getUTCDay(),
      load: "clear" as const,
      minutes: 0,
      weightedHours: 0,
      encounters: 0,
      carriesAssessment: false,
    };
  });
}

/**
 * One beat per session, ungrouped and unclassified. Only reached when the server did not
 * send a brief; the grouping and kinds are the server's job precisely so this view cannot
 * disagree with the Session Brief above it.
 */
function fallbackEncounters(plan: PlanResponse): EncounterGroupView[] {
  const itemsById = new Map(plan.workItems.map((w) => [w.id, w]));
  return plan.sessions.map((s) => ({
    workItemId: s.workItemId,
    courseId: s.courseId,
    title: itemsById.get(s.workItemId)?.title ?? "Session",
    date: s.startAt.slice(0, 10),
    startAt: s.startAt,
    minutes: s.minutes,
    blocks: 1,
    kind: "sustained" as const,
    sessionIds: [s.id],
  }));
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
