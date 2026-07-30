import type { ReactNode } from "react";
import { type Course, type ThemeName } from "@schoolquest/domain";
import { courseTincture } from "../lib/course-colour";
import type {
  CourseProgressView,
  CourseStandingView,
  ProjectProgressView,
  ProjectsSummaryView,
  TermProgressView,
} from "../lib/types";

/**
 * Where the term stands, and whether the long work is going to land.
 *
 * The data comes from `computeProjectProgress` / `summarizeProjects`
 * (packages/planning-engine/src/project-progress.ts), the term progress roll-up, and the
 * per-course standing. The question this screen answers is the one in that engine's own
 * header comment — *"am I actually going to make it"* — which is why it is not a trophy
 * cabinet. A screen that makes a student feel good while a paper quietly dies has failed,
 * so every figure below is either something they can act on or something that tells them
 * they do not need to.
 *
 * Five rules drive the branches in this file:
 *
 * 1. **The two rows that need action are found first.** In the real five-course semester
 *    exactly two of seven projects want anything from the student today: one whose deadline
 *    is 237 days past (a stale 2025 date read off a syllabus) and one with four hours booked
 *    against a date nobody has ever set. Both actions are the same action — check the date —
 *    so they are lifted into their own group above the rest instead of being marked in place
 *    and left to be found. The other five are then free to read as what they are: future
 *    work, in date order.
 * 2. **"Not started" is a state, not a verdict.** Every row in the test semester is
 *    `not_started`, because in week one that is simply correct (the engine says so in as many
 *    words). So no row carries a "not started" badge, nothing is coloured as a failure, and no
 *    row or course is ever given an empty track — seven bars at 0% are a picture of failure
 *    drawn over work that is merely in the future. Where there is no progress the row states
 *    the three figures that are actually useful, as tokens rather than prose: nothing logged,
 *    how much is ahead, how much is booked. The one 0% bar that does appear is the term meter
 *    at the top, which is the requested headline and states the scale the rest is measured on.
 * 3. **An assumed effort figure is never presented as the student's own.** See
 *    `allAssumed` in the projects card.
 * 4. **Nothing is invented and nothing is flattered.** Percentages are floored, so 99.6%
 *    never reads as 100%. A null estimated grade is printed as "no graded results yet" and
 *    never as a number. A zero that carries no information is not printed at all.
 * 5. **Nothing counts down.** No streaks, no decay, no idle-day penalty (docs/02-prd.md §3).
 *    Every figure here either rises or is a distance.
 *
 * Quest chrome is presentation only. Every count, minute and date reads identically once the
 * flavour is stripped, and the plain shell is a calm readout carrying no metaphor at all.
 */

/**
 * Quest palette, duplicated from the `--q-*` custom properties in styles.css as literals.
 * Only ever applied when `theme === "quest"`; hard-coding keeps the file readable in
 * isolation, the way Today.tsx, Questline.tsx and CampaignArc.tsx already do.
 */
const Q = {
  ink: "#2a1f14",
  parchment: "#efe3c8",
  leather: "#16100b",
  gold: "#c9a227",
  goldBright: "#e8c95a",
  goldDim: "#8a6f1f",
  wax: "#8c2f28",
  /** Dim ink for text over a *tinted* patch of parchment; see the note in CampaignArc.tsx. */
  inkDim: "#5b4930",
  /** Cream that clears 4.5:1 on a filled wax chip. */
  chipCream: "#f2ead6",
  /** Dark ink for text on gold leaf; the shipped chip pairing. */
  onGold: "#3a2b00",
} as const;

/** "95" -> "1h 35m". Matches Today.tsx and CampaignArc.tsx, so minutes read the same everywhere. */
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
 * Locale-formatted, but never rounded up into a friendlier number. Copied from Questline.tsx:
 * point totals can be fractional, and a raw "87.50000000000001" on screen reads as a fault in
 * the arithmetic rather than in the formatting.
 */
function num(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Floors rather than rounds, matching Questline.tsx: 99.6% must not read as "100%" while
 * work remains. Understating by less than a point is the only direction this may be wrong in.
 */
function percentOf(fraction: number): number {
  return Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
}

/** Same flooring rule for a figure the engine already expressed as 0..100. */
function floorPercent(value: number): number {
  return Math.floor(Math.min(100, Math.max(0, value)));
}

/**
 * Work type, printed plainly under every theme. Deliberately not themed: `workType` is
 * domain data, and renaming a paper buys atmosphere at the cost of the one word on the row a
 * student is scanning for.
 */
function workTypeLabel(workType: string): string {
  const words = workType.split("_");
  const first = words[0] ?? workType;
  return [first.slice(0, 1).toUpperCase() + first.slice(1), ...words.slice(1)].join(" ");
}

/**
 * The due date, formatted from the date part in UTC — the same treatment as CampaignArc.tsx
 * and for the same reason: `daysAway` was computed from `dueAt.slice(0, 10)`, so formatting
 * those ten characters keeps the printed date and the printed distance from contradicting
 * each other. The year is always shown, because the test semester carries a stale 2025 date
 * beside 2026 work and an omitted year would hide exactly the fault the row is flagging.
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

/** Course code appended only when the name does not already carry it (see WeekMap). */
function courseLabel(course: Course | undefined, courseId: string): string {
  if (!course) return `Course ${courseId.slice(0, 6)}`;
  return course.code && !course.name.includes(course.code)
    ? `${course.name} (${course.code})`
    : course.name;
}

/**
 * Sigil lettering, matched to Questline.tsx / CampaignArc.tsx so the screens agree. Digits
 * are skipped on purpose: "BIO 240" as a two-character mark reads as "B2", which looks like
 * a typo rather than a course.
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
 * Themed wording on screen, plain wording for assistive tech. Copied from Questline.tsx:
 * screen-reader output must never depend on the visual theme (docs/02-prd.md §5), and the
 * metaphor therefore never carries meaning.
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

/** The course mark. Tincture in quest, a neutral chip carrying the code in plain. */
function Sigil({
  course,
  courseId,
  quest,
}: {
  course: Course | undefined;
  courseId: string;
  quest: boolean;
}) {
  const tincture = courseTincture(courseId, course?.colorToken, true);
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
        // lettering at 3.56:1 on the two screens this is copied from.
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
 * A progress track. Reuses `.capacity-bar` for the shipped geometry (no stylesheet edits)
 * and overrides inline for the quest theme's inlaid-groove look. The meter carries the whole
 * statement in plain language, which is why the numerals beside it are aria-hidden.
 *
 * Never rendered at zero — see rule 2 in the file header.
 */
function Track({
  percent,
  ariaLabel,
  quest,
  emphasis,
}: {
  percent: number;
  ariaLabel: string;
  quest: boolean;
  emphasis?: boolean;
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
              height: emphasis ? 14 : 10,
              borderRadius: 4,
              margin: "0.45rem 0 0.3rem",
              background: "linear-gradient(180deg, #100b06, #291e12)",
              border: `1px solid ${Q.goldDim}`,
              boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.65)",
            }
          : { height: emphasis ? 10 : 8, borderRadius: 5, margin: "0.45rem 0 0.3rem" }
      }
    >
      <span
        style={
          quest
            ? {
                width: `${percent}%`,
                background: "linear-gradient(180deg, #f2dc8a, #c9a227 50%, #8a6f1f)",
                boxShadow: "0 0 9px rgba(201, 162, 39, 0.5)",
              }
            : { width: `${percent}%`, background: emphasis ? "var(--accent)" : undefined }
        }
      />
      {quest && (
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

/**
 * One labelled figure in a summary band.
 *
 * Unlike the equivalents in Questline.tsx and CampaignArc.tsx these tiles are *not* wrapped
 * in a blanket `aria-hidden`: there are more of them here than one meter label could carry
 * without turning into a paragraph, so each is announced on its own and the two that the
 * meter already states are the ones hidden. `spokenValue` exists because "8h 30m" is not
 * speech.
 */
function Stat({
  caption,
  captionPlain,
  value,
  spokenValue,
  detail,
  quest,
}: {
  caption: string;
  captionPlain?: string;
  value: string;
  spokenValue?: string;
  detail?: string;
  quest: boolean;
}) {
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
        <Themed visible={caption} plain={captionPlain ?? caption} />
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
        <Themed visible={value} plain={spokenValue ?? value} />
      </div>
      {detail && (
        <div
          style={{
            fontSize: "0.76rem",
            color: quest ? "#cbb98c" : "var(--text-dim)",
            marginTop: "0.1rem",
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

/** Micro-caps divider, matched to CampaignArc.tsx so the two cards read as one system. */
function Rule({
  children,
  quest,
  tone,
  as = "div",
}: {
  children: ReactNode;
  quest: boolean;
  tone?: "attention";
  as?: "div" | "h3";
}) {
  const Tag = as;
  return (
    <Tag
      style={{
        margin: "0.9rem 0 0.35rem",
        paddingBottom: "0.28rem",
        fontSize: "0.66rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        color: quest ? (tone === "attention" ? Q.wax : Q.inkDim) : "var(--text-dim)",
        borderBottom: quest ? "1px solid rgba(138, 111, 31, 0.38)" : "1px solid var(--border)",
      }}
    >
      {children}
    </Tag>
  );
}

/** The leather-and-gold banner used at the top of the term card; mirrors Questline.tsx. */
function Banner({ children, quest }: { children: ReactNode; quest: boolean }) {
  return (
    <div
      style={
        quest
          ? {
              position: "relative",
              margin: "0 0 0.6rem",
              padding: "0.8rem 1rem 0.9rem",
              borderRadius: 5,
              color: Q.parchment,
              background: `linear-gradient(180deg, #2c2013, ${Q.leather})`,
              border: `1px solid ${Q.goldDim}`,
              boxShadow: "inset 0 1px 0 rgba(232, 201, 90, 0.18), 0 2px 10px rgba(0, 0, 0, 0.45)",
            }
          : {
              margin: "0 0 0.6rem",
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
            style={{
              position: "absolute",
              bottom: 4,
              right: 7,
              color: Q.goldDim,
              fontSize: "0.6rem",
            }}
          >
            ❖
          </span>
        </>
      )}
      {children}
    </div>
  );
}

/** A footnote line. Said once for a whole card, never repeated down the rows. */
function Note({ children, quest }: { children: ReactNode; quest: boolean }) {
  return (
    <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.8rem" }}>
      <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
        {"◇ "}
      </span>
      {children}
    </p>
  );
}

/**
 * The pace chip: minutes per week needed from here to land on time.
 *
 * This is the figure the whole projects card exists for — the engine's header calls it the
 * one comparison a student cannot do in their head. Two cases refuse to state a rate:
 *
 * - **No deadline.** There is nothing to divide by, and inventing a horizon would be exactly
 *   the fabrication rule 4 forbids.
 * - **Past due, or due today.** `neededPerWeek` returns the whole remainder for these,
 *   because all of it is needed now rather than spread over anything. Printing "240m/wk" for
 *   a deadline eight months gone would dress a data fault up as a study plan, so the chip
 *   states the open work instead and the group heading above it names the real action.
 */
function PaceChip({
  project: p,
  quest,
}: {
  project: ProjectProgressView;
  quest: boolean;
}) {
  const undated = p.daysAway === null;
  const urgent = p.daysAway !== null && p.daysAway <= 0;
  const attention = undated || urgent;

  const visible = undated
    ? quest
      ? "no date — no pace"
      : "no date — no weekly pace"
    : urgent
      ? `${formatEffort(p.remainingMinutes)} still open`
      : `${formatEffort(p.neededPerWeekMinutes ?? 0)}/wk`;
  const plain = undated
    ? "no due date on record, so no weekly pace can be worked out"
    : urgent
      ? `${spellEffort(p.remainingMinutes)} of work still open`
      : `${spellEffort(p.neededPerWeekMinutes ?? 0)} a week from here to finish on time`;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "0.35rem",
        padding: "0.12rem 0.5rem",
        borderRadius: quest ? 4 : 999,
        fontSize: "0.82rem",
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        // Attention rows get the wax seal, ordinary pacing gets gold leaf. Colour is never
        // the only signal: the glyph differs, and so do the words.
        ...(attention
          ? quest
            ? { background: Q.wax, border: "1px solid rgba(0, 0, 0, 0.35)", color: Q.chipCream }
            : { background: "transparent", border: "1px solid var(--border)", color: "var(--text)" }
          : quest
            ? {
                background: `linear-gradient(180deg, ${Q.goldBright}, ${Q.gold})`,
                border: "1px solid #6d5718",
                color: Q.onGold,
              }
            : {
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }),
      }}
    >
      <span aria-hidden="true" style={{ opacity: 0.85 }}>
        {attention ? "◈" : "◆"}
      </span>
      <Themed visible={visible} plain={plain} />
    </span>
  );
}

/**
 * The health sentence, printed only for the states that ask something of the student.
 *
 * `not_started` and `on_track` deliberately produce nothing. Every row in the real semester
 * is `not_started`, and a badge saying so on all seven would be a wall of small failures
 * where the truth is "this is future work" — the engine's own comment calls `not_started` in
 * week one "a true statement, not a criticism". The effort line below each row already says
 * that nothing has been logged, which is the same fact without the verdict.
 */
function HealthNote({
  project: p,
  quest,
}: {
  project: ProjectProgressView;
  quest: boolean;
}) {
  if (p.health === "finished") {
    return (
      <p style={{ margin: "0.35rem 0 0", fontSize: "0.86rem", color: quest ? Q.ink : "var(--text)" }}>
        <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
          {"◆ "}
        </span>
        <Themed visible={quest ? "Done and behind you." : "Finished."} plain="Finished." />
      </p>
    );
  }

  // Arithmetic, not opinion, so it is stated plainly and the options are named. The engine
  // measures this against real weekly capacity, so "even using every study minute" is
  // literally what was computed.
  const text =
    p.health === "will_not_fit"
      ? "This will not fit before its deadline even using every study minute of the week. The date, the scope, or something else in the week has to give — better to choose now than to find out later."
      : p.health === "crowding"
        ? "Landing this on time would take more than half of all your weekly study time from here. Still possible, and worth knowing before it is the only option left."
        : p.health === "stalled" && p.daysSinceProgress !== null
          ? `No completed session on this for ${p.daysSinceProgress} days, with the deadline still ahead. A statement of where attention has gone, not a mark against you.`
          : null;
  if (!text) return null;

  return (
    <p
      style={{
        margin: "0.35rem 0 0",
        fontSize: "0.86rem",
        fontWeight: 600,
        color: quest ? Q.ink : "var(--text)",
      }}
    >
      <span aria-hidden="true" style={{ color: quest ? Q.wax : "var(--text-dim)" }}>
        {"◈ "}
      </span>
      {text}
    </p>
  );
}

/**
 * One project.
 *
 * `markAssumed` is only ever true when the list is *mixed* — see `allAssumed` in the card
 * body for why a caveat true of every row is stated once instead of seven times.
 */
function ProjectRow({
  project: p,
  course,
  quest,
  markAssumed,
  first,
}: {
  project: ProjectProgressView;
  course: Course | undefined;
  quest: boolean;
  markAssumed: boolean;
  first: boolean;
}) {
  const name = courseLabel(course, p.courseId);
  const started = p.investedMinutes > 0 || p.completionFraction > 0;
  const done = p.health === "finished";
  const percent = percentOf(p.completionFraction);
  const overdue = p.daysAway !== null && p.daysAway < 0;

  const distanceVisible =
    p.daysAway === null
      ? "no date"
      : p.daysAway < 0
        ? `${-p.daysAway}d ago`
        : p.daysAway === 0
          ? "today"
          : `${p.daysAway}d`;
  const distancePlain =
    p.daysAway === null
      ? "no due date on record"
      : p.daysAway < 0
        ? `past due by ${-p.daysAway} ${-p.daysAway === 1 ? "day" : "days"}`
        : p.daysAway === 0
          ? "due today"
          : `due in ${p.daysAway} ${p.daysAway === 1 ? "day" : "days"}`;

  const stagesDone = p.stages.filter((s) => s.done).length;

  return (
    <li
      style={{
        padding: "0.7rem 0",
        borderTop: first
          ? "none"
          : quest
            ? "1px solid rgba(138, 111, 31, 0.22)"
            : "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Sigil course={course} courseId={p.courseId} quest={quest} />
        <span
          style={{
            flex: "1 1 12rem",
            minWidth: 0,
            fontWeight: 600,
            fontSize: "0.98rem",
            color: quest ? Q.ink : "var(--text)",
          }}
        >
          {p.title}
        </span>
        <span
          style={{
            fontWeight: 700,
            fontSize: "1.05rem",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            textAlign: "right",
            color: quest ? (overdue || p.daysAway === null ? Q.wax : Q.ink) : "var(--text)",
          }}
        >
          <Themed visible={distanceVisible} plain={distancePlain} />
        </span>
      </div>

      {/* Course, type and date hang under the title, clear of the sigil gutter — the same
          indent Questline and CampaignArc use. */}
      <div style={{ marginLeft: 38 }}>
        <p
          className="muted"
          style={{ margin: "0.15rem 0 0.3rem", fontSize: "0.82rem", fontVariantNumeric: "tabular-nums" }}
        >
          {name}
          {" · "}
          {workTypeLabel(p.workType)}
          {" · "}
          {p.dueAt ? formatDue(p.dueAt) : "no due date"}
          {markAssumed && (
            <>
              {" "}
              <span aria-hidden="true">◇</span>
              <span className="sr-only">
                , the effort figure on this row is an assumed default, not a stated estimate
              </span>
            </>
          )}
        </p>

        {/* Progress, but only where there is progress. An empty track is not information;
            it is a picture of failure drawn over a project that is merely in the future. */}
        {started && (
          <>
            <Track
              quest={quest}
              percent={percent}
              ariaLabel={`${p.title}: ${percent} percent done by effort, ${spellEffort(
                p.investedMinutes,
              )} logged of ${spellEffort(p.estimatedMinutes)}, ${spellEffort(
                p.remainingMinutes,
              )} remaining`}
            />
            <p
              aria-hidden="true"
              style={{
                margin: 0,
                fontSize: "0.82rem",
                fontVariantNumeric: "tabular-nums",
                color: quest ? Q.inkDim : "var(--text-dim)",
              }}
            >
              {`${percent}% · ${formatEffort(p.investedMinutes)} done of ${formatEffort(
                p.estimatedMinutes,
              )} · ${formatEffort(p.remainingMinutes)} left`}
            </p>
          </>
        )}

        {/* Pace, work ahead and time booked, on one line of tokens rather than a sentence.
            An earlier draft wrote "Nothing logged against it yet — the whole 4h is still
            ahead." on every row, which on the real semester printed the same sentence seven
            times: true, and wallpaper. As three short figures it reads as a column of data,
            which is what it is. A finished project gets none of it — a weekly pace for work
            that is done is arithmetic with nothing to say. */}
        {!done && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.5rem",
              flexWrap: "wrap",
              marginTop: "0.35rem",
            }}
          >
            <PaceChip project={p} quest={quest} />
            <span
              style={{
                fontSize: "0.82rem",
                fontVariantNumeric: "tabular-nums",
                color: quest ? Q.inkDim : "var(--text-dim)",
              }}
            >
              {started ? (
                <Themed
                  visible={
                    p.bookedMinutes > 0
                      ? `${formatEffort(p.bookedMinutes)} booked so far`
                      : "nothing booked yet"
                  }
                  plain={
                    p.bookedMinutes > 0
                      ? `${spellEffort(p.bookedMinutes)} booked so far`
                      : "no time on the calendar for it yet"
                  }
                />
              ) : (
                <Themed
                  visible={`nothing logged yet · ${formatEffort(p.remainingMinutes)} ahead · ${
                    p.bookedMinutes > 0 ? `${formatEffort(p.bookedMinutes)} booked` : "nothing booked yet"
                  }`}
                  plain={`nothing logged against this yet, ${spellEffort(
                    p.remainingMinutes,
                  )} of work ahead, ${
                    p.bookedMinutes > 0
                      ? `${spellEffort(p.bookedMinutes)} booked so far`
                      : "and no time on the calendar for it yet"
                  }`}
                />
              )}
            </span>
          </div>
        )}

        <HealthNote project={p} quest={quest} />

        {/* Milestones, when a project has been broken into them. Nothing is printed when the
            list is empty: "0 stages" is not a fact about the work, only about the data, and
            no project in the real semester has been broken down yet. */}
        {p.stages.length > 0 && (
          <div style={{ marginTop: "0.4rem" }}>
            <p
              className="muted"
              style={{
                margin: "0 0 0.15rem",
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}
            >
              <Themed
                visible={`${stagesDone} of ${p.stages.length} ${quest ? "stages cleared" : "milestones done"}`}
                plain={`${stagesDone} of ${p.stages.length} milestones done`}
              />
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {p.stages.map((stage) => (
                <li
                  key={stage.workItemId}
                  style={{
                    fontSize: "0.82rem",
                    padding: "0.1rem 0",
                    color: quest ? Q.ink : "var(--text)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ color: quest ? (stage.done ? Q.goldDim : Q.inkDim) : "var(--text-dim)" }}
                  >
                    {stage.done ? "◆ " : "◇ "}
                  </span>
                  <span className="sr-only">{stage.done ? "Done: " : "Still open: "}</span>
                  {stage.title}
                  {stage.dueAt && (
                    <span style={{ color: quest ? Q.inkDim : "var(--text-dim)" }}>
                      {` · ${formatDue(stage.dueAt)}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

export function Stats({
  projects,
  progress,
  courses,
  standings,
  theme,
}: {
  projects: { rows: ProjectProgressView[]; summary: ProjectsSummaryView };
  progress: TermProgressView | undefined;
  courses: Course[];
  standings: Record<string, CourseStandingView>;
  theme: ThemeName;
}): JSX.Element {
  const quest = theme === "quest";
  const coursesById = new Map(courses.map((c) => [c.id, c]));
  const rows = projects.rows;
  const summary = projects.summary;

  // `label()` carries no key for these cards. The mission shell must not inherit the quest
  // metaphor any more than the plain one does, and the plain shell carries none at all.
  const termHeading = quest
    ? "The campaign so far"
    : theme === "mission"
      ? "Semester status"
      : "Semester at a glance";
  const projectsHeading = quest
    ? "The long roads"
    : theme === "mission"
      ? "Sustained operations"
      : "Big projects";
  const coursesHeading = quest
    ? "Standing on each questline"
    : theme === "mission"
      ? "Standing by theater"
      : "Where each course stands";

  const termPercent = progress ? percentOf(progress.completionFraction) : 0;
  // The engine decides when points are representative; this defers to that decision rather
  // than to whether any point value exists. In the test semester one item of 56 carried
  // points, and trusting that produced "100 / 100 banked" beside "0 of 56 tasks".
  const termHasPoints = progress?.basis === "points";
  const termEmpty = !progress || progress.itemsTotal === 0;
  const taskCounted = progress ? progress.basis === "items" : false;

  const termAriaLabel = progress
    ? [
        `Term progress: ${termPercent} percent of term work complete`,
        termHasPoints ? `${num(progress.pointsDone)} of ${num(progress.pointsTotal)} points` : null,
        `${progress.itemsDone} of ${progress.itemsTotal} required tasks finished`,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  /**
   * The two rows that want something today, and the reason this screen is arranged the way
   * it is: a passed deadline and a missing date are the same problem — a date nobody has
   * checked — and both are fixed in the same place. Everything else on the card is work that
   * is simply ahead of the student, and it reads better once these are out of it.
   */
  const needsDate = rows.filter((p) => p.health === "past_due" || p.daysAway === null);
  const ahead = rows.filter((p) => !needsDate.includes(p));

  // A claim worth making only when the data earns it, and phrased to exclude the rows that
  // were never measured for it: `past_due` outranks every other reading in the engine, so a
  // past-due row has no capacity verdict attached to it at all.
  const datedAhead = rows.filter((p) => p.daysAway !== null && p.daysAway > 0);
  const allDatedFit =
    datedAhead.length > 0 && summary.projectsWillNotFit === 0 && summary.projectsCrowding === 0;

  /**
   * Assumed effort — the first judgement call, and the same shape as CampaignArc's inferred
   * dates.
   *
   * `effortIsAssumed` is true on all seven rows of the real semester, because no syllabus
   * ever says how long a paper takes and a per-type default stood in. Marking every row put
   * one identical caveat on screen seven times, where it stops being information and becomes
   * wallpaper — a mark that never varies carries no signal. So the caveat is scoped to
   * whatever is actually true: when it applies to everything it is stated once, in the line
   * that introduces the list and governs every row beneath it; when only some rows are
   * assumed, those rows carry a `◇` and the footnote explains the mark. Either way, no
   * assumed figure is ever presented as the student's own estimate.
   */
  const assumedCount = rows.filter((p) => p.effortIsAssumed).length;
  const allAssumed = rows.length > 0 && assumedCount === rows.length;
  const markAssumed = assumedCount > 0 && !allAssumed;

  /**
   * Whether any course has a grade at all. Most have none this early — `estimatedPercent` is
   * null until something is actually graded — and repeating that on every row says nothing
   * five times. When it is universally true it is stated once, in the card's footnote.
   */
  const anyGraded = courses.some((c) => standings[c.id]?.estimatedPercent != null);

  return (
    <>
      {/* ================= 1. The term ================= */}
      <section className="card" aria-labelledby="stats-term-heading">
        <h2 id="stats-term-heading">
          {quest && <span aria-hidden="true">{"⚜ "}</span>}
          <Themed visible={termHeading} plain="Semester at a glance" />
        </h2>

        {/* Flavour is quest-only and says nothing the numbers do not (cf. WeekMap). It is
            hidden from assistive tech rather than given a plain twin, because the plain
            theme has no such line: a twin would invent a sentence the plain reader never
            sees, and the invariant is that stripping the flavour leaves the two themes
            saying exactly the same thing. */}
        {quest && (
          <p className="muted" aria-hidden="true" style={{ fontStyle: "italic", margin: "0 0 0.75rem" }}>
            Ground covered, time at the desk, and the roads still to walk. The ledger keeps
            no score against you — it only says where things stand.
          </p>
        )}

        <Banner quest={quest}>
          {termEmpty ? (
            <p style={{ margin: 0, fontSize: "0.92rem", color: quest ? "#d9c79b" : "var(--text-dim)" }}>
              <Themed
                visible={
                  quest
                    ? "Nothing charted for the term yet, so there is no completion to report."
                    : "No work items have been added to your courses yet, so there is no term completion to report."
                }
                plain="No work items have been added to your courses yet, so there is no term completion to report."
              />
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "1.25rem",
                flexWrap: "wrap",
              }}
            >
              {/* The meter below carries this in plain language; announcing both would read
                  the whole banner twice. */}
              <div aria-hidden="true">
                <div
                  style={{
                    fontSize: "2.15rem",
                    lineHeight: 1,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: quest ? Q.goldBright : "var(--text)",
                    textShadow: quest ? "0 1px 0 rgba(0, 0, 0, 0.85)" : undefined,
                  }}
                >
                  {termPercent}%
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
                  {quest ? "of the campaign complete" : "of term work complete"}
                </div>
              </div>

              <div style={{ display: "flex", gap: "1.4rem", flexWrap: "wrap" }}>
                {/* Restated by the meter, so hidden rather than announced twice. */}
                <div aria-hidden="true">
                  <Stat
                    quest={quest}
                    caption={quest ? "Tasks cleared" : "Tasks complete"}
                    value={`${progress.itemsDone} / ${progress.itemsTotal}`}
                  />
                </div>
                {termHasPoints && (
                  <div aria-hidden="true">
                    <Stat
                      quest={quest}
                      caption={quest ? "Points banked" : "Points complete"}
                      value={`${num(progress.pointsDone)} / ${num(progress.pointsTotal)}`}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {!termEmpty && <Track quest={quest} emphasis percent={termPercent} ariaLabel={termAriaLabel} />}

          {/* ---- The counts. Only what is true and worth acting on gets a tile: a zero that
                  carries no information is noise dressed as data, and "0 finished" beside
                  seven future projects is a scolding rather than a statistic. ---- */}
          <div
            style={{
              display: "flex",
              gap: "1.4rem",
              flexWrap: "wrap",
              marginTop: termEmpty ? "0.6rem" : "0.75rem",
            }}
          >
            {/* Effort only ever rises, and it is the one figure that exists for every
                student from their first finished block. Suppressed at zero and replaced by
                the sentence below, because a "0m" tile on day one says nothing true that the
                sentence does not say more kindly. */}
            {summary.sessionsCompleted > 0 && (
              <Stat
                quest={quest}
                caption={quest ? "Time at the desk" : "Focused time logged"}
                captionPlain="Focused time logged"
                value={formatEffort(summary.investedMinutes)}
                spokenValue={spellEffort(summary.investedMinutes)}
                detail={`${summary.sessionsCompleted} ${
                  summary.sessionsCompleted === 1 ? "session" : "sessions"
                } finished`}
              />
            )}
            {summary.bookedMinutes > 0 && (
              <Stat
                quest={quest}
                caption="Time booked ahead"
                value={formatEffort(summary.bookedMinutes)}
                spokenValue={spellEffort(summary.bookedMinutes)}
                detail="on these projects"
              />
            )}
            {summary.projectsTotal > 0 && (
              <Stat
                quest={quest}
                caption={quest ? "Long roads tracked" : "Big projects tracked"}
                captionPlain="Big projects tracked"
                value={`${summary.projectsTotal}`}
                detail={
                  summary.projectsFinished > 0 ? `${summary.projectsFinished} finished` : undefined
                }
              />
            )}
            {needsDate.length > 0 && (
              <Stat
                quest={quest}
                caption={quest ? "Dates to settle" : "Dates to check"}
                captionPlain="Dates to check"
                value={`${needsDate.length}`}
                detail="listed first below"
              />
            )}
            {summary.projectsWillNotFit > 0 && (
              <Stat
                quest={quest}
                caption="Will not fit in time"
                value={`${summary.projectsWillNotFit}`}
                detail="even at full weekly capacity"
              />
            )}
            {summary.projectsCrowding > 0 && (
              <Stat
                quest={quest}
                caption="Crowding the week"
                value={`${summary.projectsCrowding}`}
                detail="over half your weekly study time"
              />
            )}
            {summary.projectsStalled > 0 && (
              <Stat
                quest={quest}
                caption={quest ? "Gone quiet" : "No recent progress"}
                captionPlain="No recent progress"
                value={`${summary.projectsStalled}`}
                detail="ten days or more"
              />
            )}
          </div>
        </Banner>

        {/* The good news, when the arithmetic supports it. This is the answer to "am I going
            to make it" for everything that is not in the first group below, and it is a
            measured claim: the engine flags a project the moment it needs over half the
            week, so silence from it means what this sentence says. */}
        {allDatedFit && (
          <p style={{ margin: "0.6rem 0 0", fontSize: "0.88rem", color: quest ? Q.ink : "var(--text)" }}>
            <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
              {"◆ "}
            </span>
            <Themed
              visible={
                quest
                  ? "Of the roads with a date still ahead of you, none needs more than half your weekly study time. They fit, at the pace shown below."
                  : "Of the projects with a date still ahead, none needs more than half of your weekly study time. They fit, at the pace shown below."
              }
              plain="Of the projects with a date still ahead, none needs more than half of your weekly study time. They fit, at the pace shown below."
            />
          </p>
        )}

        {summary.sessionsCompleted === 0 && (
          <Note quest={quest}>
            <Themed
              visible={
                quest
                  ? "No time at the desk logged yet. It appears here from your first finished session, and it only ever climbs."
                  : "No study sessions finished yet. Focused time appears here from the first one you complete, and it only ever rises."
              }
              plain="No study sessions finished yet. Focused time appears here from the first one you complete, and it only ever rises."
            />
          </Note>
        )}

        {taskCounted && (
          <Note quest={quest}>
            Counted by task: these syllabi state grading weights rather than per-assignment
            point values, so term progress is measured in work finished.
          </Note>
        )}
      </section>

      {/* ================= 2. The projects ================= */}
      <section className="card" aria-labelledby="stats-projects-heading">
        <h2 id="stats-projects-heading">
          {quest && <span aria-hidden="true">{"⚜ "}</span>}
          <Themed visible={projectsHeading} plain="Big projects" />
        </h2>

        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            <Themed
              visible={
                quest
                  ? "No long roads yet. Anything large enough to need more than one sitting appears here as soon as a syllabus names it."
                  : "No big projects yet. Anything large enough to need more than one sitting appears here as soon as a course lists it."
              }
              plain="No big projects yet. Anything large enough to need more than one sitting appears here as soon as a course lists it."
            />
          </p>
        ) : (
          <>
            {/* Quest-only flavour, hidden from assistive tech for the reason given on the
                term card's equivalent line. */}
            {quest && (
              <p className="muted" aria-hidden="true" style={{ fontStyle: "italic", margin: "0 0 0.6rem" }}>
                A long road is not lost by being forgotten. It is lost by never being measured
                against the weeks that are left.
              </p>
            )}

            {/* Said once, and only when it is true of everything. */}
            {allAssumed && (
              <p className="muted" style={{ margin: "0 0 0.4rem", fontSize: "0.82rem" }}>
                <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
                  {"◇ "}
                </span>
                Every effort figure below is an assumed default for its type of work — no
                syllabus states how long something takes. They are the same assumptions the
                plan schedules against, not estimates you gave.
              </p>
            )}

            {/* ---- Group 1: the rows where the action is to check a date. ---- */}
            {needsDate.length > 0 && (
              <>
                <Rule as="h3" quest={quest} tone="attention">
                  <Themed
                    visible={quest ? "Dates to settle first" : "Check the date on these first"}
                    plain="Check the date on these first"
                  />
                  <span aria-hidden="true">{` · ${needsDate.length}`}</span>
                  <span className="sr-only">
                    {`, ${needsDate.length} ${needsDate.length === 1 ? "project" : "projects"}`}
                  </span>
                </Rule>
                <p className="muted" style={{ margin: "0.35rem 0 0.1rem", fontSize: "0.82rem" }}>
                  <Themed
                    visible={
                      quest
                        ? "A deadline already behind you with the work still open, or work with no date at all. In both cases the date itself is the likeliest fault — read off a syllabus for an older term, or never stated anywhere — so the move is to check it, not to rush the work."
                        : "A deadline that has already passed with the work still open, or work with no date at all. In both cases the date itself is the likeliest fault — inferred from a syllabus stating an older term, or never stated anywhere — so the first step is to check the date, not to rush the work."
                    }
                    plain="A deadline that has already passed with the work still open, or work with no date at all. In both cases the date itself is the likeliest fault — inferred from a syllabus stating an older term, or never stated anywhere — so the first step is to check the date, not to rush the work."
                  />
                </p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {needsDate.map((p, index) => (
                    <ProjectRow
                      key={p.workItemId}
                      project={p}
                      course={coursesById.get(p.courseId)}
                      quest={quest}
                      markAssumed={markAssumed && p.effortIsAssumed}
                      first={index === 0}
                    />
                  ))}
                </ul>
              </>
            )}

            {/* ---- Group 2: everything else, in the order the engine returned it. ---- */}
            {ahead.length > 0 && (
              <>
                <Rule as="h3" quest={quest}>
                  <Themed
                    visible={quest ? "The road ahead" : "Ahead of you, in date order"}
                    plain="Ahead of you, in date order"
                  />
                  <span aria-hidden="true">{` · ${ahead.length}`}</span>
                  <span className="sr-only">
                    {`, ${ahead.length} ${ahead.length === 1 ? "project" : "projects"}`}
                  </span>
                </Rule>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {ahead.map((p, index) => (
                    <ProjectRow
                      key={p.workItemId}
                      project={p}
                      course={coursesById.get(p.courseId)}
                      quest={quest}
                      markAssumed={markAssumed && p.effortIsAssumed}
                      first={index === 0}
                    />
                  ))}
                </ul>
              </>
            )}

            {markAssumed && (
              <Note quest={quest}>
                {assumedCount === 1
                  ? "One effort figure above is an assumed default for its type of work rather than a stated estimate, and is marked."
                  : `${assumedCount} of the effort figures above are assumed defaults for their type of work rather than stated estimates, and are marked.`}
              </Note>
            )}

            {/* The caveat that keeps the booked column from reading as a warning. Straight
                from the engine's own reasoning: long work is paced, so the plan only ever
                holds the next stretch of blocks. */}
            <Note quest={quest}>
              Long work is paced, so only the next stretch is ever on the calendar. A small
              booked figure beside a large remaining one is normal — the weekly pace is the
              number that says whether it will land.
            </Note>

            <Note quest={quest}>
              <Themed
                visible={
                  quest
                    ? "Nothing here counts down against you. A day count is a distance, and work not yet begun is simply work that is still ahead."
                    : "Nothing here counts down against you. A day count is a distance, and work not yet started is simply work that is still ahead."
                }
                plain="Nothing here counts down against you. A day count is a distance, and work not yet started is simply work that is still ahead."
              />
            </Note>
          </>
        )}
      </section>

      {/* ================= 3. The courses ================= */}
      {courses.length > 0 && (
        <section className="card" aria-labelledby="stats-courses-heading">
          <h2 id="stats-courses-heading">
            {quest && <span aria-hidden="true">{"⚜ "}</span>}
            <Themed visible={coursesHeading} plain="Where each course stands" />
          </h2>

          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {courses.map((course, index) => {
              const cp: CourseProgressView | undefined = progress?.courses.find(
                (c) => c.courseId === course.id,
              );
              const standing: CourseStandingView | undefined = standings[course.id];
              const name = courseLabel(course, course.id);
              const percent = cp ? percentOf(cp.completionFraction) : 0;
              const started = cp ? cp.completionFraction > 0 : false;
              // Points are printed only where the engine judged them representative; on an
              // item-counted course no points figure may appear at all, not even "0 of 0".
              const points = cp?.basis === "points";

              return (
                <li
                  key={course.id}
                  style={{
                    padding: "0.7rem 0",
                    borderTop:
                      index === 0
                        ? "none"
                        : quest
                          ? "1px solid rgba(138, 111, 31, 0.22)"
                          : "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <Sigil course={course} courseId={course.id} quest={quest} />
                    <span
                      style={{
                        flex: "1 1 auto",
                        minWidth: 0,
                        fontWeight: 600,
                        fontSize: "0.98rem",
                        color: quest ? Q.ink : "var(--text)",
                      }}
                    >
                      {name}
                    </span>
                  </div>

                  <div style={{ marginLeft: 38 }}>
                    {!cp || cp.itemsTotal === 0 ? (
                      <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.84rem" }}>
                        <Themed
                          visible={quest ? "Nothing charted in this one yet." : "No work items in this course yet."}
                          plain="No work items in this course yet."
                        />
                      </p>
                    ) : (
                      <>
                        {/* Same rule as the project rows: the bar appears once there is
                            something in it, and the words carry the figure either way. */}
                        {started && (
                          <Track
                            quest={quest}
                            percent={percent}
                            ariaLabel={`${name}: ${percent} percent complete, ${cp.itemsDone} of ${cp.itemsTotal} required tasks finished`}
                          />
                        )}
                        <p
                          style={{
                            margin: "0.2rem 0 0",
                            fontSize: "0.84rem",
                            fontVariantNumeric: "tabular-nums",
                            color: quest ? Q.inkDim : "var(--text-dim)",
                          }}
                        >
                          {started ? (
                            <span aria-hidden="true">{`${percent}% · `}</span>
                          ) : null}
                          {`${cp.itemsDone} of ${cp.itemsTotal} tasks done`}
                          {points && ` · ${num(cp.pointsDone)} of ${num(cp.pointsTotal)} points`}
                        </p>
                      </>
                    )}

                    {/* The grade line. `estimatedPercent` is null for a course with no graded
                        results, which is most of them at the start of a term — and a missing
                        grade is printed as missing. There is no figure to soften, round or
                        stand in for.

                        When *no* course has a grade yet the line is suppressed entirely and
                        said once in the footnote instead: five identical "no graded results
                        yet" rows are the same wallpaper the assumed-effort caveat avoids. */}
                    {standing && standing.estimatedPercent !== null ? (
                      <p
                        style={{
                          margin: "0.25rem 0 0",
                          fontSize: "0.84rem",
                          color: quest ? Q.ink : "var(--text)",
                        }}
                      >
                        <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
                          {"◆ "}
                        </span>
                        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {`${floorPercent(standing.estimatedPercent)}%`}
                        </span>
                        {` on graded work so far — ${confidencePhrase(standing.confidence)}.`}
                        {standing.remainingWeightFraction > 0 &&
                          ` ${floorPercent(standing.remainingWeightFraction * 100)}% of the grade is still ahead.`}
                      </p>
                    ) : (
                      anyGraded && (
                        <p
                          className="muted"
                          style={{ margin: "0.25rem 0 0", fontSize: "0.84rem" }}
                        >
                          <span aria-hidden="true">{"◇ "}</span>
                          No graded results in this course yet, so there is no grade to
                          estimate.
                        </p>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <Note quest={quest}>
            {anyGraded
              ? "A grade estimate covers graded work only. Anything still pending is counted as unknown, never as a zero."
              : "No course has a graded result recorded yet, so no grade is estimated for any of them. When one arrives it will cover graded work only — anything still pending counts as unknown, never as a zero."}
          </Note>
        </section>
      )}
    </>
  );
}

/**
 * How a grade estimate was arrived at, in words rather than a jargon token.
 *
 * The engine's confidence values describe how the number was built, and that provenance is
 * the difference between a figure a student can rely on and one they should not act on. It
 * travels with the number rather than being tucked into a footnote.
 */
function confidencePhrase(confidence: string): string {
  switch (confidence) {
    case "confirmed":
      return "weighted by the course's own grading categories";
    case "high_inference":
      return "weighted by grading categories that may not add up to the whole grade";
    case "low_inference":
      return "a flat points ratio, because this course states no usable category weights";
    default:
      return "how this was worked out is not recorded, so treat it as a rough reading";
  }
}
