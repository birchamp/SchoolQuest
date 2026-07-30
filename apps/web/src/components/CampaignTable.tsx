import type { ReactNode } from "react";
import { type Course, type ThemeName } from "@schoolquest/domain";
import { explainUpkeep, label, plainLabel } from "@schoolquest/theme-language";
import type { CourseLoadView, TermLoadView } from "../lib/types";
import { courseTincture as sharedTincture } from "../lib/course-colour";

/**
 * One pool of time, divided across every course
 * (packages/planning-engine/src/course-load.ts).
 *
 * The student is not a player working through one campaign — they are the person running
 * five at once, out of a single week that does not grow. Every other screen in this app
 * shows either one course's work or the week as an undifferentiated whole, and neither
 * shows **the division**. The division is the decision: a student who cannot see that
 * History already holds four of this week's twelve hours cannot make an informed choice
 * about Biology, and "spend more time on it" is not advice they can act on without knowing
 * what it costs.
 *
 * Five rules drive every branch below:
 *
 * 1. **The pool is stated first and never narrowed.** The shared total is the constraint the
 *    rows compete for, so it is the headline — and it keeps showing the whole week even when
 *    a course lens is active. See `onSelectCourse` in the body: a lens that also shrank the
 *    total would reintroduce exactly the blindness this card was built to fix.
 * 2. **The share bar is the argument.** Every row's track is measured against the same
 *    denominator — everything booked this week — so the five fills visibly sum to one week.
 *    That is the only way "his time will have to be split up across all classes" becomes
 *    something you can see rather than something you are told.
 * 3. **A share is a description, not a target.** A course at 14% is not failing and nothing
 *    here counts down (`docs/02-prd.md` §3). Upkeep is not a streak either: a course is
 *    current again the instant its overdue routine work is done, so it is drawn with the same
 *    weight whatever it says.
 * 4. **Nothing is invented.** Percentages are floored. A null next-due is printed as "no
 *    dated work ahead", never as a guessed date. A course with nothing booked keeps its row
 *    with a zero share, because a zero claim on the week is a fact about the plan.
 * 5. **Rows never reorder.** They stay in the engine's order rather than sorting by share —
 *    a table whose rows rearrange themselves every week is a table nobody can scan.
 *
 * Quest chrome is presentation only: every minute, count and date reads identically once the
 * flavour is stripped, and the plain shell is a calm readout carrying no metaphor at all.
 */

/**
 * Quest palette, duplicated from the `--q-*` custom properties in styles.css as literals.
 * Only ever applied when `theme === "quest"`; hard-coding keeps the file readable in
 * isolation, the way Today.tsx, Questline.tsx, CampaignArc.tsx and Stats.tsx already do.
 */
const Q = {
  ink: "#2a1f14",
  parchment: "#efe3c8",
  leather: "#16100b",
  gold: "#c9a227",
  goldBright: "#e8c95a",
  goldDim: "#8a6f1f",
  wax: "#8c2f28",
  /**
   * Dim ink for text on a *tinted* patch of parchment. The card's own `--text-dim`
   * (#6b5636) measures 4.45:1 once a selected row lays a 12% gold wash over the darker
   * parchment stop — under the floor. Every muted string inside this card therefore uses
   * this darker value rather than `.muted`, the same call CampaignArc.tsx documents.
   */
  inkDim: "#5b4930",
} as const;

/**
 * The single place this file asks what colour a course is.
 *
 * Every sigil, share bar and strip segment goes through here, so the two maps above are
 * referenced exactly once each and can be swapped for a shared module — or widened past six
 * tokens — without touching a use site. `colorTokenFor` is the only key: a course's colour
 * follows its identity, never its position in a list, so two screens that sort differently
 * cannot give one course two colours.
 */
function courseTincture(courseId: string, course: Course | undefined, quest: boolean): string {
  return sharedTincture(courseId, course?.colorToken, quest);
}

/**
 * The same colour as a bar fill.
 *
 * Lightening, not darkening: no lettering ever sits on a bar, and the heraldic tinctures are
 * chosen dark enough to carry cream text — sable at #241a10 would simply disappear into the
 * groove behind it. The opposite rule applies to the sigil, where cream lettering *does* sit
 * on the tincture and only a darkening overlay is safe.
 */
function courseFill(courseId: string, course: Course | undefined, quest: boolean): string {
  const tincture = courseTincture(courseId, course, quest);
  return quest
    ? `linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.06)), ${tincture}`
    : tincture;
}

/** "95" -> "1h 35m". Matches Today.tsx and Stats.tsx, so minutes read the same everywhere. */
function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** The same figure spelled out, for screen readers: "1h 35m" is not speech. */
function spellEffort(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} minutes`;
}

/**
 * Floors rather than rounds, matching Questline.tsx and Stats.tsx. Here it also keeps the
 * card honest in the direction that matters: five floored shares sum to slightly under 100,
 * never to 103, so the table never claims more of the week than the week contains.
 */
function percentOf(fraction: number): number {
  return Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
}

/** Course code appended only when the name does not already carry it (see WeekMap). */
function courseLabel(course: Course | undefined, courseId: string): string {
  if (!course) return `Course ${courseId.slice(0, 6)}`;
  return course.code && !course.name.includes(course.code)
    ? `${course.name} (${course.code})`
    : course.name;
}

/**
 * Sigil lettering, matched to Questline.tsx / CampaignArc.tsx / Stats.tsx so the screens
 * agree. Digits are skipped on purpose: "BIO 240" as a two-character mark reads as "B2",
 * which looks like a typo rather than a course.
 */
function initialsFor(course: Course | undefined, courseId: string): string {
  const source = course?.code ?? course?.name ?? courseId;
  const words = source.match(/[A-Za-z]+/g) ?? [];
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  return (second ? first.slice(0, 1) + second.slice(0, 1) : first.slice(0, 3)).toUpperCase();
}

/**
 * The due date, formatted from the date part in UTC — the same treatment as CampaignArc.tsx
 * and Stats.tsx, so a date printed here cannot disagree with the same date printed there.
 * The year is kept because `nextDueAt` is only ever a date still ahead, and "ahead" in a
 * term that crosses a new year is not always this year.
 */
function formatDue(dueAt: string): string {
  return new Date(`${dueAt.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Themed wording on screen, plain wording for assistive tech. Copied from Questline.tsx:
 * screen-reader output must never depend on the visual theme (docs/02-prd.md §5), so the
 * metaphor never carries meaning.
 */
function Themed({ visible, plain }: { visible: string; plain: string }) {
  if (visible === plain) return <>{visible}</>;
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{plain}</span>
    </>
  );
}

/**
 * Three-way wording. `label()` covers the nouns this card needs but not its sentences, and
 * the mission shell must not inherit the quest metaphor any more than the plain one does.
 */
function say(theme: ThemeName, quest: string, mission: string, plain: string): string {
  return theme === "quest" ? quest : theme === "mission" ? mission : plain;
}

/** The course mark. Tincture in quest, a neutral chip in plain; matched to Stats.tsx. */
function Sigil({
  course,
  courseId,
  quest,
}: {
  course: Course | undefined;
  courseId: string;
  quest: boolean;
}) {
  const tincture = courseTincture(courseId, course, true);
  return (
    <span
      aria-hidden="true"
      style={{
        width: 30,
        height: 30,
        flex: "0 0 auto",
        display: "grid",
        placeItems: "center",
        borderRadius: quest ? 4 : 8,
        fontSize: "0.66rem",
        fontWeight: 700,
        letterSpacing: "0.03em",
        // Darkening only: a white sheen lifted verdant far enough to put the cream
        // lettering at 3.56:1 on the screens this is copied from.
        background: quest
          ? `linear-gradient(160deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.34)), ${tincture}`
          : "var(--surface-2)",
        border: quest ? `1px solid ${Q.goldDim}` : "1px solid var(--border)",
        color: quest ? "#f4ead2" : "var(--text-dim)",
        boxShadow: quest ? "inset 0 1px 0 rgba(255, 255, 255, 0.12)" : undefined,
      }}
    >
      {initialsFor(course, courseId)}
    </span>
  );
}

/**
 * One course's claim on the pool, drawn against the pool's own scale.
 *
 * Reuses `.capacity-bar` for the shipped geometry (no stylesheet edits) and overrides inline
 * for the quest theme's inlaid-groove look. The meter carries the whole statement in plain
 * language, which is why the numerals beside it are aria-hidden — announcing both reads
 * every row twice.
 *
 * Unlike the tracks in Stats.tsx this one *is* drawn at zero. There an empty bar was a
 * picture of failure over work that is merely in the future; here it is the fact the row
 * exists to state — this course has no claim on this week — and hiding the bar would hide
 * the one row a student most needs to notice while comparing five.
 */
function ShareBar({
  percent,
  ariaLabel,
  quest,
  fill,
  empty,
}: {
  percent: number;
  ariaLabel: string;
  quest: boolean;
  fill: string;
  empty: boolean;
}) {
  return (
    <div
      className="capacity-bar"
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      style={
        quest
          ? {
              position: "relative",
              // A course with no claim gets a hairline rather than a full groove. At full
              // height an unfilled track reads as a gauge that failed to load — and with
              // seven courses two or three quiet ones in a row read as a broken screen
              // rather than a quiet week. Flattened, it reads as what it is: a flat line.
              height: empty ? 3 : 10,
              borderRadius: empty ? 2 : 4,
              margin: "0.4rem 0 0.35rem",
              background: empty
                ? "rgba(90, 70, 34, 0.35)"
                : "linear-gradient(180deg, #100b06, #291e12)",
              border: empty ? "none" : `1px solid ${Q.goldDim}`,
              boxShadow: empty ? "none" : "inset 0 2px 4px rgba(0, 0, 0, 0.65)",
            }
          : {
              height: empty ? 3 : 8,
              borderRadius: empty ? 2 : 5,
              margin: "0.4rem 0 0.35rem",
            }
      }
    >
      <span style={{ width: `${percent}%`, background: fill }} />
      {/* Ten notches, so the track reads as a measured scale rather than a smear — and so
          every row can be compared against the same gradations by eye. */}
      {quest && !empty && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(90deg, rgba(15, 10, 5, 0.55) 0 1px, transparent 1px 10%)",
          }}
        />
      )}
    </div>
  );
}

/** One labelled figure in the pool banner. Label and value are always paired. */
function Stat({ caption, value, quest }: { caption: string; value: string; quest: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.63rem",
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: quest ? "#cbb98c" : "var(--text-dim)",
        }}
      >
        {caption}
      </div>
      <div
        style={{
          fontSize: "1.05rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: quest ? Q.parchment : "var(--text)",
          marginTop: "0.1rem",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** A footnote line. Said once for the whole card, never repeated down the rows. */
function Note({ children, quest }: { children: ReactNode; quest: boolean }) {
  return (
    <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: quest ? Q.inkDim : "var(--text-dim)" }}>
      <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
        {"◇ "}
      </span>
      {children}
    </p>
  );
}

export function CampaignTable({
  load,
  courses,
  theme,
  selectedCourseId,
  onSelectCourse,
}: {
  load: TermLoadView;
  courses: Course[];
  theme: ThemeName;
  selectedCourseId: string | null;
  onSelectCourse: (courseId: string | null) => void;
}): JSX.Element {
  const quest = theme === "quest";
  const coursesById = new Map(courses.map((c) => [c.id, c]));

  const rows = load.courses;
  const booked = load.bookedMinutes;
  const capacity = load.capacityMinutes;
  const unbooked = load.unbookedMinutes;
  // Guarded: a term with no stated capacity would otherwise divide by zero and print NaN%.
  const poolPercent = capacity > 0 ? percentOf(booked / capacity) : 0;

  /**
   * A student may carry one course or nine, and the card has to be true at both ends.
   *
   * One course is the case worth naming, because the card's whole argument disappears: there
   * is no division, and a lone bar at 100% would be a comparison drawn against nothing —
   * "this course has all of the time you gave this course". So the share bars and the
   * percentages come out, the row states its minutes outright, and a line above the list
   * says plainly that there is nothing yet to divide. Everything else — the pool, the
   * unspoken-for remainder, the deadline, the upkeep — is still worth reading, so the card
   * stays rather than collapsing into an empty state.
   *
   * At the other end nothing is fixed to a row count: rows are as tall as their content,
   * the tracks are full-width so a 6% share is still a visible fill rather than a sliver,
   * and the strip's segments are flex-weighted by minutes.
   */
  const single = rows.length === 1;

  const heading = label("courseTable", theme);
  const poolName = label("sharedTime", theme);
  const poolNamePlain = plainLabel("sharedTime");

  const selected = selectedCourseId === null ? null : rows.find((r) => r.courseId === selectedCourseId) ?? null;
  const selectedName = selected ? courseLabel(coursesById.get(selected.courseId), selected.courseId) : null;

  /**
   * The whole statement, in plain language, on the one element that carries the pool.
   * Everything painted in the banner beside it is aria-hidden, so this is the single
   * announcement rather than four overlapping ones.
   */
  const poolAriaLabel = [
    `${poolNamePlain} this week: ${spellEffort(booked)} booked`,
    capacity > 0 ? `of ${spellEffort(capacity)} available` : null,
    unbooked > 0 ? `${spellEffort(unbooked)} not yet spoken for` : "none of it still unspoken for",
    `divided across ${rows.length} ${rows.length === 1 ? "course" : "courses"}`,
  ]
    .filter(Boolean)
    .join(", ");

  if (rows.length === 0) {
    return (
      <section className="card" aria-labelledby="campaign-table-heading">
        <h2 id="campaign-table-heading">
          {quest && <span aria-hidden="true">{"⚜ "}</span>}
          <Themed visible={heading} plain={plainLabel("courseTable")} />
        </h2>
        <p style={{ margin: 0, color: quest ? Q.inkDim : "var(--text-dim)" }}>
          <Themed
            visible={say(
              theme,
              "No questlines yet. Add a course and its claim on the week will be drawn here.",
              "No theaters yet. Add a course and its claim on the week will appear here.",
              "No courses yet. Add a course and its share of your week will appear here.",
            )}
            plain="No courses yet. Add a course and its share of your week will appear here."
          />
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="campaign-table-heading">
      <h2 id="campaign-table-heading">
        {quest && <span aria-hidden="true">{"⚜ "}</span>}
        <Themed visible={heading} plain={plainLabel("courseTable")} />
      </h2>

      {/* Quest-only flavour. Hidden from assistive tech rather than given a plain twin,
          because the plain shell has no such line: a twin would invent a sentence the plain
          reader never sees, and the invariant is that stripping the flavour leaves the two
          themes saying exactly the same thing (cf. Stats.tsx). */}
      {quest && (
        <p aria-hidden="true" style={{ fontStyle: "italic", margin: "0 0 0.75rem", color: Q.inkDim }}>
          {/* The line has to stay true of the data it sits above: with one course there are
              no others to take hours from, and the flourish would be saying something the
              rows plainly contradict. */}
          {single
            ? "One questline at this table. The hours above are the whole of what the week has to give it."
            : "You are not a player at this table. You are running every one of these at once, out of one week that does not grow — so every hour given to one is an hour the others do not get."}
        </p>
      )}

      {/* ============ 1. The pool. First, whole, and never narrowed by the lens. ============ */}
      <div
        style={
          quest
            ? {
                position: "relative",
                margin: "0 0 0.75rem",
                padding: "0.8rem 1rem 0.9rem",
                borderRadius: 5,
                color: Q.parchment,
                background: `linear-gradient(180deg, #2c2013, ${Q.leather})`,
                border: `1px solid ${Q.goldDim}`,
                boxShadow: "inset 0 1px 0 rgba(232, 201, 90, 0.18), 0 2px 10px rgba(0, 0, 0, 0.45)",
              }
            : {
                margin: "0 0 0.75rem",
                padding: "0.75rem 0.9rem 0.85rem",
                borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }
        }
      >
        {quest && (
          <>
            <span
              aria-hidden="true"
              style={{ position: "absolute", top: 4, left: 7, color: Q.goldDim, fontSize: "0.6rem" }}
            >
              ❖
            </span>
            <span
              aria-hidden="true"
              style={{ position: "absolute", bottom: 4, right: 7, color: Q.goldDim, fontSize: "0.6rem" }}
            >
              ❖
            </span>
          </>
        )}

        {/* Restated in plain language by the meter below, so painted once and announced
            once. Inside an aria-hidden block the wording may differ freely by theme. */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "1.25rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.66rem",
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                color: quest ? "#cbb98c" : "var(--text-dim)",
              }}
            >
              {poolName}
            </div>
            <div
              style={{
                fontSize: "2.15rem",
                lineHeight: 1,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                marginTop: "0.2rem",
                color: quest ? Q.goldBright : "var(--text)",
                textShadow: quest ? "0 1px 0 rgba(0, 0, 0, 0.85)" : undefined,
              }}
            >
              {formatEffort(booked)}
            </div>
            <div
              style={{
                marginTop: "0.3rem",
                fontSize: "0.66rem",
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                color: quest ? "#cbb98c" : "var(--text-dim)",
              }}
            >
              {capacity > 0
                ? `booked of ${formatEffort(capacity)} this week`
                : "booked this week"}
            </div>
          </div>

          <div style={{ display: "flex", gap: "1.4rem", flexWrap: "wrap" }}>
            <Stat
              quest={quest}
              caption={say(theme, "Still unclaimed", "Uncommitted", "Still unspoken for")}
              value={formatEffort(unbooked)}
            />
            <Stat
              quest={quest}
              caption={say(theme, "Questlines at the table", "Theaters drawing on it", "Courses drawing on it")}
              value={`${rows.length}`}
            />
          </div>
        </div>

        {/*
          The division itself, drawn once: one bar the width of the whole week, cut into a
          segment per course plus the stretch nobody has claimed. This is the picture the
          card exists for — five claims on one strip of time, not five separate gauges — and
          the meter value on the container is the pool's own figure so assistive tech gets
          the same fact in one sentence.

          The segments are decoration: colour identifies a course, but every share they draw
          is written out in words on the rows below, so colour is never the only signal.
        */}
        <div
          className="capacity-bar"
          role="meter"
          aria-valuenow={poolPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={poolAriaLabel}
          style={
            quest
              ? {
                  display: "flex",
                  height: 16,
                  borderRadius: 4,
                  margin: "0.7rem 0 0.15rem",
                  background: "linear-gradient(180deg, #100b06, #291e12)",
                  border: `1px solid ${Q.goldDim}`,
                  boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.65)",
                }
              : {
                  display: "flex",
                  height: 14,
                  borderRadius: 5,
                  margin: "0.7rem 0 0.15rem",
                  // `.capacity-bar` paints itself `--surface-2`, which is also this
                  // banner's ground: a week with nothing booked yet drew a bar that was
                  // simply not there. An empty pool has to look like an empty pool.
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }
          }
        >
          {rows.map((row) => {
            const paint = courseFill(row.courseId, coursesById.get(row.courseId), quest);
            const isSelected = row.courseId === selectedCourseId;
            return (
              <span
                key={row.courseId}
                aria-hidden="true"
                style={{
                  flex: `${row.bookedMinutes} 0 0px`,
                  background: paint,
                  borderRight: row.bookedMinutes > 0 ? `1px solid ${quest ? "rgba(15, 10, 5, 0.7)" : "var(--surface-2)"}` : undefined,
                  // The lens marks its segment; it never dims the others. Dimming four
                  // fifths of the week to highlight one would be the same mistake as
                  // shrinking the total — the point of the strip is that all five are
                  // visible at once.
                  boxShadow: isSelected
                    ? `inset 0 0 0 2px ${quest ? Q.goldBright : "var(--text)"}`
                    : undefined,
                }}
              />
            );
          })}
          {/* The stretch nobody has claimed. Room, never debt — the engine cannot book past
              capacity, so this can only ever be a positive remainder. */}
          <span
            aria-hidden="true"
            style={{ flex: `${unbooked} 0 0px`, background: "transparent" }}
          />
        </div>

        {/* One line of provenance for the strip, so nobody has to decode the colours. */}
        <p
          aria-hidden="true"
          style={{
            margin: 0,
            fontSize: "0.76rem",
            fontVariantNumeric: "tabular-nums",
            color: quest ? "#cbb98c" : "var(--text-dim)",
          }}
        >
          {capacity > 0
            ? `${poolPercent}% of the week spoken for · ${formatEffort(unbooked)} left`
            : `${formatEffort(unbooked)} left`}
        </p>
      </div>

      {/* ============ 2. The lens. ============ */}
      {selected !== null && selectedName !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
            margin: "0 0 0.6rem",
            padding: "0.5rem 0.65rem",
            borderRadius: quest ? 4 : 8,
            background: quest ? "rgba(201, 162, 39, 0.12)" : "var(--surface-2)",
            border: quest ? `1px solid ${Q.goldDim}` : "1px solid var(--border)",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.86rem", color: quest ? Q.ink : "var(--text)" }}>
            <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
              {"◈ "}
            </span>
            {/* The invariant, said out loud. The lens narrows which course the rest of the
                app details; it does not narrow the week. If the total above shrank to match
                the selection, this card would be telling the same lie every per-course view
                already tells — that a course's time is a quantity of its own rather than a
                slice taken out of everyone else's. */}
            <Themed
              visible={say(
                theme,
                `Showing ${selectedName} alone. The table time above still counts the whole week — that is the point of it.`,
                `Showing ${selectedName} only. The available hours above still cover the whole week.`,
                `Showing ${selectedName} only. The study time above still covers your whole week, not just this course.`,
              )}
              plain={`Showing ${selectedName} only. The study time above still covers your whole week, not just this course.`}
            />
          </p>
          <button
            type="button"
            className="action"
            style={{ padding: "0.35rem 0.7rem", fontSize: "0.84rem", flex: "0 0 auto" }}
            onClick={() => onSelectCourse(null)}
          >
            <Themed
              visible={say(theme, "Show every questline", "Show all theaters", "Show all courses")}
              plain="Show all courses"
            />
          </button>
        </div>
      )}

      {/* ============ 3. The rows. ============ */}

      {/* One course: the division framing has nothing to work on, so it is retired rather
          than faked. Said above the list, where it governs the row beneath it. */}
      {single && (
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.86rem", color: quest ? Q.ink : "var(--text)" }}>
          <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
            {"◇ "}
          </span>
          <Themed
            visible={say(
              theme,
              "Only one questline sits at this table, so there is nothing yet to divide. Every hour booked above is its own — the shares appear as soon as a second course is competing for the week.",
              "One theater, so there is nothing to divide. Every hour committed above belongs to it; shares appear once a second theater is drawing on the same week.",
              "You have one course, so there is no division to show. Every hour booked above belongs to it — shares appear as soon as a second course is drawing on the same week.",
            )}
            plain="You have one course, so there is no division to show. Every hour booked above belongs to it — shares appear as soon as a second course is drawing on the same week."
          />
        </p>
      )}

      <div
        style={{
          fontSize: "0.66rem",
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: quest ? Q.inkDim : "var(--text-dim)",
          borderBottom: quest ? "1px solid rgba(138, 111, 31, 0.38)" : "1px solid var(--border)",
          paddingBottom: "0.3rem",
          marginBottom: "0.15rem",
        }}
      >
        <Themed
          visible={
            single
              ? say(theme, "The questline", "The theater", "Your course")
              : say(theme, "Each claim on it", "Each claim on it", "How it divides")
          }
          plain={single ? "Your course" : "How it divides"}
        />
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((row: CourseLoadView, index) => {
          const course = coursesById.get(row.courseId);
          const name = courseLabel(course, row.courseId);
          const percent = percentOf(row.shareOfBooked);
          const isSelected = row.courseId === selectedCourseId;
          const nothingBooked = row.bookedMinutes === 0;

          const upkeep = explainUpkeep(row.upkeep, theme);
          const upkeepPlain = explainUpkeep(row.upkeep, "plain");
          // Only the two states that ask something of the student get their hint spelled
          // out. In the real semester three courses read "current" and two "no recurring
          // work"; printing five hints that never vary is wallpaper, not information.
          const upkeepNeedsHint = row.upkeep === "slipping" || row.upkeep === "behind";

          const shareAria = nothingBooked
            ? `${name}: no study time booked this week, a zero share of the ${spellEffort(booked)} booked`
            : `${name}: ${percent} percent of the study time booked this week, ${spellEffort(
                row.bookedMinutes,
              )} of ${spellEffort(booked)}`;

          /**
           * Tokens rather than a sentence.
           *
           * Prose here would put the same three facts, in different numbers, on every row —
           * a paragraph nobody reads, and at seven courses a wall of them. A zero project
           * count is left out entirely: it says nothing the open count does not.
           *
           * A course with nothing booked leads with that instead of "no blocks", because a
           * run of quiet rows has to read as quiet rather than as a rendering fault. It is
           * a short token, not a paragraph — several courses can be quiet in one week, and
           * the reason it is not a fault is stated once in the footnote rather than
           * repeated down the list.
           */
          const blocksToken = nothingBooked
            ? say(theme, "quiet this week", "quiet this week", "nothing booked this week")
            : `${row.blocks} ${row.blocks === 1 ? "block" : "blocks"}`;
          const blocksTokenPlain = nothingBooked
            ? "nothing booked this week"
            : `${row.blocks} ${row.blocks === 1 ? "block" : "blocks"}`;
          const openToken = row.openItems === 0 ? "nothing open" : `${row.openItems} open`;
          const projectsToken =
            row.openProjects === 0
              ? null
              : say(
                  theme,
                  `${row.openProjects} major ${row.openProjects === 1 ? "quest" : "quests"}`,
                  `${row.openProjects} primary ${row.openProjects === 1 ? "objective" : "objectives"}`,
                  `${row.openProjects} big ${row.openProjects === 1 ? "project" : "projects"}`,
                );
          const projectsTokenPlain =
            row.openProjects === 0
              ? null
              : `${row.openProjects} big ${row.openProjects === 1 ? "project" : "projects"}`;

          const detail = [blocksToken, openToken, projectsToken].filter(Boolean).join(" · ");
          const detailPlain = [blocksTokenPlain, openToken, projectsTokenPlain]
            .filter(Boolean)
            .join(" · ");

          return (
            <li key={row.courseId}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectCourse(isSelected ? null : row.courseId)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                  cursor: "pointer",
                  padding: "0.7rem 0.6rem",
                  // The selected row is marked three ways over — a rule down its edge, a
                  // wash, and `aria-pressed` — because the lens changes what the rest of
                  // the screen means and a state that subtle is a state that gets lost.
                  borderTop:
                    index === 0
                      ? "1px solid transparent"
                      : quest
                        ? "1px solid rgba(138, 111, 31, 0.38)"
                        : "1px solid var(--border)",
                  borderRight: 0,
                  borderBottom: 0,
                  borderLeft: isSelected
                    ? `3px solid ${quest ? Q.gold : "var(--accent)"}`
                    : "3px solid transparent",
                  borderRadius: 0,
                  background: isSelected
                    ? quest
                      ? "rgba(201, 162, 39, 0.12)"
                      : "var(--surface-2)"
                    : "transparent",
                  color: quest ? Q.ink : "var(--text)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <Sigil course={course} courseId={row.courseId} quest={quest} />
                  <span
                    style={{
                      flex: "1 1 auto",
                      minWidth: 0,
                      fontWeight: isSelected ? 700 : 600,
                      fontSize: "0.98rem",
                      color: quest ? Q.ink : "var(--text)",
                    }}
                  >
                    {name}
                  </span>
                  {/* With more than one course the meter below states both of these in
                      plain language, so announcing them here too would read every row
                      twice. With one course there is no meter and no share, so the minutes
                      are the row's own statement and are announced. */}
                  {single ? (
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "0.95rem",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                        color: quest ? Q.ink : "var(--text)",
                      }}
                    >
                      <Themed
                        visible={formatEffort(row.bookedMinutes)}
                        plain={`${spellEffort(row.bookedMinutes)} booked this week`}
                      />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "0.5rem",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.84rem",
                          fontVariantNumeric: "tabular-nums",
                          color: quest ? Q.inkDim : "var(--text-dim)",
                        }}
                      >
                        {formatEffort(row.bookedMinutes)}
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "0.95rem",
                          fontVariantNumeric: "tabular-nums",
                          color: quest ? Q.wax : "var(--text)",
                          minWidth: "2.6rem",
                          textAlign: "right",
                        }}
                      >
                        {percent}%
                      </span>
                    </span>
                  )}
                </div>

                {/* Everything below hangs clear of the sigil gutter, the same indent
                    Questline, CampaignArc and Stats use. */}
                <div style={{ marginLeft: 38 }}>
                  {/* Every row's track spans the full width and is measured against the
                      same denominator, so the fills can be compared by eye and visibly sum
                      to one week. Suppressed at one course: a lone bar at 100% is a
                      comparison against nothing. */}
                  {!single && (
                    <ShareBar
                      quest={quest}
                      percent={percent}
                      ariaLabel={shareAria}
                      fill={courseFill(row.courseId, course, quest)}
                      empty={nothingBooked}
                    />
                  )}

                  {/* The counts and the upkeep chip share one line: at seven courses a
                      separate line each turned the card into a column of near-identical
                      paragraphs, and these are the two facts a student compares across
                      rows rather than reads in sequence.

                      Every upkeep status is drawn with exactly the same weight — same chip,
                      same colours — because "behind" here means two short posts are late,
                      and a course returns to current the moment they are done. Colour is
                      never the only signal and, more to the point, colour is never a
                      verdict: the glyph and the words are the whole difference. */}
                  <p
                    style={{
                      margin: single ? "0.25rem 0 0" : 0,
                      display: "flex",
                      alignItems: "baseline",
                      gap: "0.45rem",
                      flexWrap: "wrap",
                      fontSize: "0.82rem",
                      color: quest ? Q.ink : "var(--text)",
                    }}
                  >
                    <span
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        color: quest ? Q.inkDim : "var(--text-dim)",
                      }}
                    >
                      <Themed visible={detail} plain={detailPlain} />
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "baseline",
                        gap: "0.3rem",
                        padding: "0.08rem 0.45rem",
                        borderRadius: quest ? 4 : 999,
                        border: quest ? `1px solid ${Q.goldDim}` : "1px solid var(--border)",
                        background: quest ? "rgba(255, 250, 238, 0.5)" : "transparent",
                        color: quest ? Q.ink : "var(--text)",
                        fontSize: "0.78rem",
                      }}
                    >
                      <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
                        {row.upkeep === "current" ? "◆" : row.upkeep === "no_routine" ? "◇" : "◈"}
                      </span>
                      <Themed visible={upkeep.label} plain={upkeep.plainLabel} />
                    </span>
                    {upkeepNeedsHint && (
                      <span style={{ color: quest ? Q.inkDim : "var(--text-dim)" }}>
                        <Themed visible={upkeep.hint} plain={upkeepPlain.hint} />
                      </span>
                    )}
                  </p>

                  {/* What is actually coming. Null means unknown and is printed as unknown:
                      the engine returns the next dated item *ahead*, so an absence here is
                      "nothing dated is coming", never "there is nothing to do". */}
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: quest ? Q.ink : "var(--text)" }}>
                    {row.nextDueTitle !== null ? (
                      <>
                        <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
                          {"◆ "}
                        </span>
                        <span className="sr-only">Next dated work: </span>
                        <span aria-hidden="true">Next: </span>
                        {row.nextDueTitle}
                        {row.nextDueAt !== null && (
                          <span style={{ color: quest ? Q.inkDim : "var(--text-dim)" }}>
                            {` · ${formatDue(row.nextDueAt)}`}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
                          {"◇ "}
                        </span>
                        <span style={{ color: quest ? Q.inkDim : "var(--text-dim)" }}>
                          <Themed
                            visible={say(
                              theme,
                              "Nothing dated lies ahead on this questline.",
                              "No dated work ahead in this theater.",
                              "No dated work ahead in this course.",
                            )}
                            plain="No dated work ahead in this course."
                          />
                        </span>
                      </>
                    )}
                  </p>

                  {/* What activating the row does. Plain in every theme — a control has to
                      say what it does, and this is the one string on the row that is an
                      instruction rather than a fact. */}
                  <span className="sr-only">
                    {isSelected
                      ? " Selected. Activate to show all courses again."
                      : " Activate to show only this course."}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* ---- Said once for the whole card, never repeated down the rows. ---- */}

      {/* The denominator, stated plainly. Every share above is a share of what is *booked*,
          not of the whole week, and the difference is real: the unspoken-for remainder
          belongs to no course yet and is the only slack any of them can still be given.
          Nothing to say when there is one course and therefore no share. */}
      {!single && (
        <Note quest={quest}>
          <Themed
            visible={say(
              theme,
              `Every share is measured against the ${formatEffort(booked)} already booked, not against the whole week. The ${formatEffort(unbooked)} still unclaimed is spoken for by nobody yet.`,
              `Every share is measured against the ${formatEffort(booked)} already committed, not against the whole week. The ${formatEffort(unbooked)} uncommitted belongs to no theater yet.`,
              `Each share is measured against the ${formatEffort(booked)} already booked, not against the whole week. The ${formatEffort(unbooked)} still unspoken for belongs to no course yet.`,
            )}
            plain={`Each share is measured against the ${formatEffort(
              booked,
            )} already booked, not against the whole week. The ${formatEffort(
              unbooked,
            )} still unspoken for belongs to no course yet.`}
          />
        </Note>
      )}

      {load.coursesWithNothingBooked > 0 && (
        <Note quest={quest}>
          {load.coursesWithNothingBooked === 1
            ? "One course has nothing booked this week. That is a statement about this week's plan, not a mark against the course — sometimes giving a course no time is the correct call."
            : `${load.coursesWithNothingBooked} courses have nothing booked this week. That is a statement about this week's plan, not a mark against them — sometimes giving a course no time is the correct call.`}
        </Note>
      )}

      {/* The ethics of the card, said once. Rewritten rather than dropped for the
          one-course case: there is no share to defend, but the upkeep half still applies. */}
      <Note quest={quest}>
        <Themed
          visible={
            single
              ? say(
                  theme,
                  "Nothing here counts down, and upkeep is not a streak — a questline is current again the moment its late routine work is done.",
                  "Nothing here counts down, and standing tasks are not a streak — a theater is current again as soon as its late recurring work is done.",
                  "Nothing here counts down, and recurring work is not a streak — a course is current again the moment its overdue items are done.",
                )
              : say(
                  theme,
                  "A share describes this week's plan; it is not a quota to hit. A small share is not a failing questline, nothing here counts down, and upkeep is not a streak — a questline is current again the moment its late routine work is done.",
                  "A share describes this week's plan; it is not a quota. A small share is not a failing theater, nothing here counts down, and standing tasks are not a streak — a theater is current again as soon as its late recurring work is done.",
                  "A share describes this week's plan; it is not a target to miss. A small share does not mean a course is behind, nothing here counts down, and recurring work is not a streak — a course is current again the moment its overdue items are done.",
                )
          }
          plain={
            single
              ? "Nothing here counts down, and recurring work is not a streak — a course is current again the moment its overdue items are done."
              : "A share describes this week's plan; it is not a target to miss. A small share does not mean a course is behind, nothing here counts down, and recurring work is not a streak — a course is current again the moment its overdue items are done."
          }
        />
      </Note>
    </section>
  );
}
