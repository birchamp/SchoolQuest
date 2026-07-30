import { type Course, type ThemeName } from "@schoolquest/domain";
import { explainBlockKind, explainDayLoad, label, plainDayLoad } from "@schoolquest/theme-language";
import type {
  EncounterGroupView,
  MealBreakView,
  PlanResponse,
  SessionBriefView,
} from "../lib/types";
import { courseTincture } from "../lib/course-colour";

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
 *
 * One optional lens sits on top of all of this: `selectedCourseId` isolates a single course
 * *on the shared surface* rather than giving each course a map of its own. Separate maps
 * would hide the only thing this view exists to show — that Wednesday is already full of
 * History before Chemistry asks for an hour — so the other courses recede rather than
 * disappear. See `recede` below for what "recede" is allowed to touch, and what it is not.
 */

/**
 * The single colour lookup for this file. Every use site goes through here so the palette
 * (which today has fewer tokens than a nine-course student has courses) can be swapped in
 * one place rather than hunted for at each call.
 */
function tinctureFor(courseId: string, course: Course | undefined): string {
  return courseTincture(courseId, course?.colorToken, true);
}

/**
 * The recessed ink, for beats outside the lens.
 *
 * This is deliberately the value the tile's own `.time` line already uses — `--text-dim`,
 * which `.card` re-points to the parchment-safe #6b5636 under the quest theme. Two reasons,
 * and the second is the load-bearing one:
 *
 * 1. A receded tile flattens to a single tone instead of keeping a dark title over dim
 *    metadata, so it stops competing for attention as a *shape*, not just as a colour.
 * 2. Its contrast is already measured and passing on every ground this file paints on
 *    (5.22:1 on the quest beat tile, 6.00:1 plain light, 6.63:1 plain dark). Dimming with
 *    `opacity` would have been simpler to write and would have been a lie in the report:
 *    tools/e2e/contrast.mjs reads `color` and composites backgrounds, so element opacity is
 *    invisible to it and a dimmed-with-opacity tile would pass the check without the check
 *    ever having looked at the colour a reader actually sees.
 *
 * No transition accompanies it: the review scores a still frame, and a reduced-motion
 * reader must get the identical result.
 */
const RECESSED_INK = "var(--text-dim)";

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
  selectedCourseId,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  brief?: SessionBriefView;
  /** Optional course lens; see the note at the top of the file. Absent or null = no lens. */
  selectedCourseId?: string | null;
}) {
  const quest = theme === "quest";
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);
  const start = plan.horizonStart ?? plan.planVersion?.horizonStart ?? today;

  // Falling back to the raw sessions keeps this view working against a plan payload that
  // predates the brief, rather than rendering an empty week.
  const days = brief?.days ?? fallbackDays(start);
  const beats = brief?.encounters ?? fallbackEncounters(plan);
  const encountersByDate = groupByDate(beats);
  const mealsByDate = groupMealsByDate(plan.meals ?? []);
  // Time the engine held on the student's behalf has to be visible somewhere, or it is
  // indistinguishable from time the engine lost. The note appears only when there is
  // something assumed to own up to.
  const heldAny = (plan.meals ?? []).some((m) => m.status === "reserved" || m.status === "squeezed");

  /**
   * The lens only switches on when it has something to say.
   *
   * A student carrying one course, or a week whose beats all happen to belong to the
   * selected course, would otherwise get a banner announcing an isolation that isolates
   * nothing — and, worse, a screen on which every single tile is receded because there is
   * no tile left to hold at full strength. An unknown id is treated the same way: naming a
   * course the plan does not carry would be a worse answer than showing the plain week.
   */
  const lensCourse = selectedCourseId ? coursesById.get(selectedCourseId) : undefined;
  const lens =
    lensCourse && beats.some((b) => b.courseId !== lensCourse.id) ? lensCourse : undefined;
  const lensName = lens ? courseLabel(lens) : "";

  return (
    <section
      className="card"
      // Named only while a lens is on, so a screen-reader user meets the highlighted course
      // as part of the region rather than having to find the sentence inside it. Without a
      // lens the section stays unnamed, exactly as it renders today.
      aria-labelledby={lens ? "week-map-heading week-map-lens" : undefined}
    >
      <h2 id="week-map-heading">{label("weekMap", theme)}</h2>
      {quest && (
        <p className="muted" style={{ fontStyle: "italic", margin: "0 0 0.75rem" }}>
          Seven days, laid out as they will be played. The load on each day counts effort,
          not just hours.
        </p>
      )}

      {/* The lens, stated plainly so the state is never something the reader has to infer
          from the styling. No `Themed` wrapper and no quest flavour: this is a sentence
          about the control, and the second half of it is a promise about the numbers that
          has to read the same under every theme. */}
      {lens && (
        <p
          id="week-map-lens"
          className="muted"
          style={{ margin: "0 0 0.6rem", fontSize: "0.82rem" }}
        >
          Showing {lensName} at full strength. Other courses are dimmed, not removed — the
          day loads, the busiest-day mark and every count below still cover the whole week.
        </p>
      )}

      {heldAny && (
        <p className="muted" style={{ margin: "0 0 0.6rem", fontSize: "0.82rem" }}>
          Time marked <span style={{ fontStyle: "italic" }}>held</span> is kept clear for
          meals. Nothing is booked over it. If you eat at a different hour, change it under
          Setup and the week will redraw around you.
        </p>
      )}

      <div className="week">
        {days.map((day) => {
          const dayBeats = (encountersByDate.get(day.date) ?? []).sort((a, b) =>
            a.startAt.localeCompare(b.startAt),
          );
          const dayMeals = mealsByDate.get(day.date) ?? [];
          const noGap = dayMeals.filter((m) => m.status === "no_gap");
          // Beats and held meal time are one sequence: the useful fact is that lunch sits
          // *between* two blocks, which a separate list underneath cannot show.
          const timeline = interleave(dayBeats, dayMeals);
          const isCrux = brief?.crux?.date === day.date;

          return (
            <div
              className={`day${day.date === today ? " is-today" : ""}`}
              key={day.date}
              data-load={day.load}
            >
              {/* Everything from here down to the beats is a property of the *whole week*
                  and so is deliberately untouched by the lens: the strip, the load word,
                  the minutes, the set-piece flag and the crux. A Wednesday carrying four
                  hours of History is a heavy Wednesday while you are looking at Chemistry,
                  and a lens that lightened it would be answering a different question than
                  the one the student asked. */}
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

              {/* A day with no room to eat. Said plainly rather than solved silently:
                  the planner cannot conjure a gap out of a solid morning of class, but a
                  student who can see it coming can bring something with them. */}
              {noGap.length > 0 && (
                <p className="day-flag day-flag-crux">
                  <span aria-hidden="true">
                    No gap · {noGap.map((m) => m.label.toLowerCase()).join(", ")}
                  </span>
                  <span className="sr-only">
                    No gap for {noGap.map((m) => m.label.toLowerCase()).join(" or ")} on this
                    day
                  </span>
                </p>
              )}

              {timeline.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
                  {quest ? "Clear road" : "Open"}
                </p>
              ) : (
                timeline.map((entry) => {
                  if (entry.type === "meal") {
                    const meal = entry.meal;
                    return (
                      <div className="block rest" key={`meal-${meal.date}-${meal.key}`}>
                        <span aria-hidden="true">
                          {meal.label}
                          {meal.status === "squeezed" ? " (short)" : ""}
                        </span>
                        <span className="sr-only">
                          {meal.minutes} minutes held for {meal.label.toLowerCase()}
                          {meal.status === "squeezed"
                            ? ", which is less than a full break"
                            : ""}
                        </span>
                        <span className="time">
                          {new Date(meal.start! * 60_000).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          {" · "}
                          {formatMinutes(meal.minutes)} held
                        </span>
                      </div>
                    );
                  }
                  const beat = entry.beat;
                  const course = coursesById.get(beat.courseId);
                  const kind = explainBlockKind(beat.kind, theme);
                  const tincture = tinctureFor(beat.courseId, course);
                  // Outside the lens the tile keeps every word it had and loses only its
                  // pull: one flat dim tone in place of dark-title-over-dim-metadata, and a
                  // neutral edge in place of the course's colour. Nothing is filtered out,
                  // because the point of the shared surface is that a full Wednesday still
                  // looks full while you are reading Chemistry.
                  const recede = lens !== undefined && beat.courseId !== lens.id;
                  return (
                    <div
                      className="block"
                      key={`${beat.workItemId}-${beat.date}`}
                      style={
                        recede
                          ? {
                              color: RECESSED_INK,
                              borderLeftColor: quest
                                ? "rgba(138, 111, 31, 0.4)"
                                : "var(--border)",
                            }
                          : undefined
                      }
                    >
                      {/* `sustained` is the default — ordinary work. Labelling it made
                          "LONG MARCH" appear nine times in one week and drowned out the
                          beats that actually differ. The same reason the engine stopped
                          calling every prep block a set piece: if everything is named,
                          no name means anything. */}
                      {beat.kind !== "sustained" && (
                        <span
                          className="beat-kind"
                          // The kind label is kept, not dropped: a receded midterm is still
                          // a midterm, and removing the word would make the lens delete
                          // information rather than rank it. Only the tincture goes.
                          style={{ color: recede ? RECESSED_INK : tincture }}
                        >
                          <span aria-hidden="true">{kind.name}</span>
                          <span className="sr-only">{kind.plainName}:</span>
                        </span>
                      )}
                      {beat.title}
                      <span className="time" style={recede ? { color: RECESSED_INK } : undefined}>
                        {new Date(beat.startAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {" · "}
                        {formatMinutes(beat.minutes)}
                        {/* The count that replaced three identical tiles. */}
                        {beat.blocks > 1 && ` · ${beat.blocks} blocks`}
                      </span>
                      <span className="time" style={recede ? { color: RECESSED_INK } : undefined}>
                        {course?.name}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {/* The unclaimed list is left outside the lens on purpose. It is already grouped by
          course, so isolating one adds nothing a reader cannot see; and every group header
          carries a count. Receding a count is the one thing that would make it ambiguous
          whether the number is the term's or the lens's, and an ambiguous number is worse
          than an unstyled one. */}
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

/**
 * Course names sometimes already carry the code ("General Biology I (BIO 240)"); appending
 * it again produced "(BIO 240) (BIO 240)" in group headers, and would do the same in the
 * lens line.
 */
function courseLabel(course: Course): string {
  return course.code && !course.name.includes(course.code)
    ? `${course.name} (${course.code})`
    : course.name;
}

function groupMealsByDate(meals: MealBreakView[]): Map<string, MealBreakView[]> {
  const byDate = new Map<string, MealBreakView[]>();
  for (const meal of meals) {
    // "planned" means the student's own commitment already covers it, which the week map has
    // no business restating — they wrote it down, they know it is there.
    if (meal.status === "planned") continue;
    byDate.set(meal.date, [...(byDate.get(meal.date) ?? []), meal]);
  }
  return byDate;
}

/** Beats and held meal time, in the order the day happens. */
type TimelineEntry =
  | { type: "beat"; startAt: string; beat: EncounterGroupView }
  | { type: "meal"; startAt: string; meal: MealBreakView };

function interleave(beats: EncounterGroupView[], meals: MealBreakView[]): TimelineEntry[] {
  const entries: TimelineEntry[] = beats.map((beat) => ({
    type: "beat",
    startAt: beat.startAt,
    beat,
  }));
  for (const meal of meals) {
    if (meal.start === null) continue; // "no_gap" has no time to place; it flags the day.
    entries.push({
      type: "meal",
      startAt: new Date(meal.start * 60_000).toISOString(),
      meal,
    });
  }
  return entries.sort((a, b) => a.startAt.localeCompare(b.startAt));
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
    const name = course ? courseLabel(course) : "Other";
    const group = groups.get(key) ?? { key, name, items: [] };
    group.items.push({ id, title: item?.title ?? id });
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
