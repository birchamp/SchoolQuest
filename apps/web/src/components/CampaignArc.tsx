import type { ReactNode } from "react";
import { colorTokenFor, type Course, type CourseColorToken, type ThemeName } from "@schoolquest/domain";
import type { MilestoneView, UndatedMilestoneView } from "../lib/types";

/**
 * The term's major work as a timeline (docs/07-session-prep-design.md §3).
 *
 * The data comes from `buildMilestones` / `buildUndatedMilestones` in
 * packages/planning-engine/src/session-brief.ts. The field this card exists for is
 * `prepBlocks`: a calendar can already tell a student that an exam is on the 14th, and it
 * still leaves the question that actually predicts the outcome unanswered — has any of the
 * approach been laid down yet? "Midterm in 12 days, 1 block prepared" is a sentence a
 * student acts on; "Midterm on 15 Oct" is one they can read four times without moving.
 *
 * Four rules drive every branch below:
 *
 * 1. **`prepBlocks` is the headline, not a detail.** It is stated three times at three
 *    scales — as an aggregate at the top, as a filled or hollow node on the rail, and as a
 *    chip on every row — because it is the one number the whole feature is for.
 * 2. **Distance is banded, not scaled.** See `BANDS`.
 * 3. **An inferred date is never presented as a fact.** See the provenance note beside
 *    `allInferred` in the body.
 * 4. **Nothing here accuses anybody.** A zero is a fact and a prompt; an overdue row is a
 *    problem to solve, most likely a wrong date (docs/02-prd.md §3 rules out streaks,
 *    decay, and anything that reads as a scolding).
 *
 * Quest chrome is presentation only: every count, date and distance reads identically once
 * the flavour is stripped, and the plain shell is a calm planner readout carrying no
 * metaphor at all.
 */

/**
 * Quest palette, duplicated from the `--q-*` custom properties in styles.css as literals.
 * These are only ever applied when `theme === "quest"`; hard-coding them keeps the file
 * readable in isolation, the way Today.tsx and Questline.tsx already do.
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
   * Dim ink for text sitting on a *tinted* patch of parchment rather than bare parchment.
   * The card's own `--text-dim` (#6b5636) measures 4.77:1 on the darker parchment stop,
   * which is above the floor — but a 6% wax wash under it drops the same ink to 4.37:1.
   * Tinted regions therefore get this darker value instead of `var(--text-dim)`.
   */
  inkDim: "#5b4930",
  /** Cream that clears 4.5:1 on filled wax and forest chips. */
  chipCream: "#f2ead6",
  /** Dark ink for text on gold leaf; the shipped risk-chip pairing. */
  onGold: "#3a2b00",
} as const;

/**
 * Heraldic tinctures for course sigils — the same map as Questline.tsx, keyed the same
 * way, so a course keeps its colour across screens. Position in this list is deliberately
 * not used: two screens that sort differently would then give one course two colours.
 */
const HERALDRY: Record<CourseColorToken, string> = {
  azure: "#2f4a6d",
  vermilion: "#8c2f28",
  verdant: "#3f6c45",
  amber: "#6b4a2a",
  violet: "#5a3b6b",
  sable: "#241a10",
};

/**
 * Distance bands.
 *
 * The judgement call here is that the arc is **banded, not drawn to scale**. In the real
 * five-course semester the dated work runs from -237 days to +138 with nothing at all
 * inside the next month: a to-scale axis spends most of its width on an empty stretch of
 * last December and then crushes everything that matters into the far right. Worse, a
 * scaled axis asks the student to convert pixels back into time, which is precisely the
 * estimation this feature exists to compensate for. A band states the answer in words
 * ("within 30 days") and the exact numeral sits on the row for anyone who wants it.
 *
 * The open-ended band is sub-divided by calendar month once it grows past four rows; see
 * `byMonth`.
 *
 * Order is nearest-first within a band, which the incoming array already guarantees.
 */
const BANDS: {
  key: string;
  holds: (daysAway: number) => boolean;
  quest: string;
  plain: string;
}[] = [
  {
    key: "overdue",
    holds: (d) => d < 0,
    quest: "Already behind you — still open",
    plain: "Past due — still open",
  },
  { key: "week", holds: (d) => d <= 7, quest: "Within the week", plain: "Within 7 days" },
  { key: "month", holds: (d) => d <= 30, quest: "Within the month", plain: "Within 30 days" },
  {
    key: "term",
    holds: () => true,
    quest: "Further along the road",
    plain: "Later in the term",
  },
];

/** "95" -> "1h 35m". Matches Today.tsx, so the same minutes read the same on both screens. */
function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** The same figure spelled out, for screen readers: "1h 35m" is not speech. */
function spellEffort(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} minutes`;
}

/**
 * Work type, printed plainly under every theme.
 *
 * Deliberately not themed. `workType` is domain data, and renaming an exam to a "trial"
 * buys atmosphere at the cost of the one word on the row a student is scanning for. The
 * fallback keeps an unrecognised type readable rather than dropping it.
 */
function workTypeLabel(workType: string): string {
  const words = workType.split("_");
  const first = words[0] ?? workType;
  return [first.slice(0, 1).toUpperCase() + first.slice(1), ...words.slice(1)].join(" ");
}

/**
 * The due date, formatted from the date part in UTC.
 *
 * `new Date(dueAt).toLocaleDateString()` renders in the viewer's zone, which shifts a
 * late-evening deadline back a day — and the engine computed `daysAway` from
 * `dueAt.slice(0, 10)`. Formatting the same ten characters keeps the printed date and the
 * printed distance from contradicting each other. The year is always shown: the test
 * semester carries a stale 2025 date beside 2026 work, and an omitted year would make that
 * row look like an ordinary near-term deadline.
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
 * Sigil lettering, matched to Questline.tsx and CourseManager.tsx so the three screens
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
 * Themed wording on screen, plain wording for assistive tech. Copied from Questline.tsx:
 * screen-reader output must never depend on the visual theme (docs/02-prd.md §5).
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
function Sigil({ course, courseId, quest }: { course: Course | undefined; courseId: string; quest: boolean }) {
  const tincture = HERALDRY[colorTokenFor(courseId, course?.colorToken)];
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
        background: quest
          // Darkening only. A white sheen lifted verdant to rgb(94,132,99) and put the
          // cream lettering at 3.56:1 — the same defect the roster chip had, since this
          // copied it before that fix landed.
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
 * The prep readout: whether any of the approach exists yet.
 *
 * Two states, and they are told apart three ways over and above colour — a filled versus
 * hollow glyph, a solid versus dashed edge, and the words themselves. The zero state is
 * given full-contrast ink rather than muted grey on purpose: muting it would make the most
 * actionable fact on the row the quietest thing on it.
 */
function PrepChip({
  blocks,
  minutes,
  quest,
}: {
  blocks: number;
  minutes: number;
  quest: boolean;
}) {
  const prepared = blocks > 0;
  const blockWord = blocks === 1 ? "block" : "blocks";

  // Never rounded, never softened: the figures are the engine's, verbatim.
  const visible = prepared
    ? `${blocks} ${blockWord} ${quest ? "laid" : "scheduled"} · ${formatEffort(minutes)}`
    : quest
      ? "no ground prepared yet"
      : "no time set aside yet";
  const plain = prepared
    ? `${blocks} ${blockWord} of preparation already scheduled, ${spellEffort(minutes)}`
    : "no preparation time set aside for this yet";

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
        ...(prepared
          ? quest
            ? {
                background: `linear-gradient(180deg, ${Q.goldBright}, ${Q.gold})`,
                border: "1px solid #6d5718",
                color: Q.onGold,
              }
            : {
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }
          : quest
            ? {
                background: "transparent",
                border: `1px dashed ${Q.goldDim}`,
                color: Q.ink,
              }
            : {
                background: "transparent",
                border: "1px dashed var(--text-dim)",
                color: "var(--text)",
              }),
      }}
    >
      <span aria-hidden="true" style={{ opacity: 0.85 }}>
        {prepared ? "◆" : "◇"}
      </span>
      <Themed visible={visible} plain={plain} />
    </span>
  );
}

/** One labelled figure in the summary band. Label and value are always paired. */
function Stat({
  caption,
  value,
  detail,
  quest,
}: {
  caption: string;
  value: string;
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

/** Micro-caps divider, used for the two sub-sections and for each distance band. */
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
        color: quest
          ? tone === "attention"
            ? Q.wax
            : Q.inkDim
          : "var(--text-dim)",
        borderBottom: quest ? "1px solid rgba(138, 111, 31, 0.38)" : "1px solid var(--border)",
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * One dated row.
 *
 * `last` terminates the rail on the final node of its list rather than letting the line run
 * off into the next heading.
 */
function DatedRow({
  milestone: m,
  course,
  quest,
  markInferred,
  first,
  last,
}: {
  milestone: MilestoneView;
  course: Course | undefined;
  quest: boolean;
  markInferred: boolean;
  first: boolean;
  last: boolean;
}) {
  const name = courseLabel(course, m.courseId);
  const prepared = m.prepBlocks > 0;

  // Distance: the numeral is the scale, because the layout deliberately is not one.
  const distanceVisible =
    m.daysAway < 0 ? `${-m.daysAway}d ago` : m.daysAway === 0 ? "today" : `${m.daysAway}d`;
  const distancePlain =
    m.daysAway < 0
      ? `past due by ${-m.daysAway} ${-m.daysAway === 1 ? "day" : "days"}`
      : m.daysAway === 0
        ? "due today"
        : `in ${m.daysAway} ${m.daysAway === 1 ? "day" : "days"}`;

  return (
    <li
      style={{
        position: "relative",
        padding: "0.6rem 0 0.6rem 1.4rem",
        borderTop: first
          ? "none"
          : quest
            ? "1px solid rgba(138, 111, 31, 0.22)"
            : "1px solid var(--border)",
      }}
    >
      {/* The rail. Decorative, and it repeats the prep state as shape: scanning the hollow
          nodes shows where nothing has been laid down yet without reading a word. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 5,
          top: 0,
          height: last ? "1.25rem" : "100%",
          borderLeft: quest ? "1px solid rgba(138, 111, 31, 0.55)" : "1px solid var(--border)",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: "0.72rem",
          fontSize: "0.72rem",
          lineHeight: 1,
          color: prepared
            ? quest
              ? Q.goldDim
              : "var(--text-dim)"
            : quest
              ? Q.wax
              : "var(--accent)",
        }}
      >
        {prepared ? "◆" : "◇"}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Sigil course={course} courseId={m.courseId} quest={quest} />
        <span
          style={{
            flex: "1 1 12rem",
            minWidth: 0,
            fontWeight: 600,
            fontSize: "0.98rem",
            color: quest ? Q.ink : "var(--text)",
          }}
        >
          {m.title}
        </span>
        <span
          style={{
            fontWeight: 700,
            fontSize: "1.05rem",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            textAlign: "right",
            color: quest ? (m.daysAway < 0 ? Q.wax : Q.ink) : "var(--text)",
          }}
        >
          <Themed visible={distanceVisible} plain={distancePlain} />
        </span>
      </div>

      {/* Course, type and date hang under the title, clear of the sigil gutter — the same
          indent Questline uses for its bars. */}
      <div style={{ marginLeft: 38 }}>
        <p
          className="muted"
          style={{
            margin: "0.15rem 0 0.35rem",
            fontSize: "0.82rem",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {name}
          {" · "}
          {workTypeLabel(m.workType)}
          {" · "}
          {formatDue(m.dueAt)}
          {/* Only when the list is mixed; see the provenance note in the card body. */}
          {markInferred && (
            <>
              {" "}
              <span aria-hidden="true">◇</span>
              <span className="sr-only">
                , this date was inferred from a syllabus, not confirmed
              </span>
            </>
          )}
        </p>
        <PrepChip blocks={m.prepBlocks} minutes={m.prepMinutes} quest={quest} />
      </div>
    </li>
  );
}

/**
 * Consecutive runs of one calendar month, used to break up the open-ended band.
 *
 * The far band is unbounded by definition, and in the test semester it holds nine of the
 * ten dated rows — a flat list of nine is the clumping the banding was supposed to avoid,
 * one level down. Month runs fix it with a fact rather than a scale: the rows are already
 * date-ordered, so a run is contiguous, and "October 2026 · 4" says something true about
 * the shape of the term that no pixel distance conveys.
 */
function byMonth(rows: MilestoneView[]): { key: string; label: string; rows: MilestoneView[] }[] {
  const runs: { key: string; label: string; rows: MilestoneView[] }[] = [];
  for (const row of rows) {
    const key = row.dueAt.slice(0, 7);
    const tail = runs[runs.length - 1];
    if (tail && tail.key === key) {
      tail.rows.push(row);
      continue;
    }
    runs.push({
      key,
      // Formatted from the date part in UTC for the same reason `formatDue` is.
      label: new Date(`${row.dueAt.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      rows: [row],
    });
  }
  return runs;
}

export function CampaignArc({
  milestones,
  undatedMilestones,
  courses,
  theme,
}: {
  milestones: MilestoneView[];
  undatedMilestones: UndatedMilestoneView[];
  courses: Course[];
  theme: ThemeName;
}): JSX.Element {
  const quest = theme === "quest";
  const coursesById = new Map(courses.map((c) => [c.id, c]));

  // `label()` has no key for this card, and the mission shell must not inherit the quest
  // metaphor any more than the plain one does (invariant: mission is treated as non-quest).
  const heading = quest
    ? "The campaign arc"
    : theme === "mission"
      ? "Primary objectives ahead"
      : "Major work ahead";

  const total = milestones.length + undatedMilestones.length;

  if (total === 0) {
    return (
      <section className="card" aria-labelledby="campaign-arc-heading">
        <h2 id="campaign-arc-heading">
          {quest && <span aria-hidden="true">{"⚜ "}</span>}
          {heading}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          <Themed
            visible={
              quest
                ? "No set pieces on the road yet. Exams, papers, presentations and group projects appear here as soon as a syllabus names one."
                : "No major work yet. Exams, papers, presentations and group projects appear here as soon as a course lists one."
            }
            plain="No major work yet. Exams, papers, presentations and group projects appear here as soon as a course lists one."
          />
        </p>
      </section>
    );
  }

  // The aggregates. Every one is a straight count over the rows on screen — nothing is
  // estimated, and nothing here can fall as the term goes on.
  const all = [...milestones, ...undatedMilestones];
  const unprepared = all.filter((m) => m.prepBlocks === 0).length;
  const prepBlocks = all.reduce((sum, m) => sum + m.prepBlocks, 0);
  const prepMinutes = all.reduce((sum, m) => sum + m.prepMinutes, 0);
  const overdue = milestones.filter((m) => m.daysAway < 0).length;

  /**
   * Date provenance — the second judgement call, and the reason `markRows` exists.
   *
   * `dueConfirmed` is false on all thirteen rows of the test semester, because every date
   * was inferred from a syllabus rather than stated as a deadline. Marking each row
   * individually put the same caveat on screen thirteen times, where it stops being
   * information and becomes wallpaper: a mark that never varies carries no signal.
   *
   * So the caveat is scoped to whatever is true. When every date is inferred it is stated
   * once, in the sub-heading that introduces the list, where it governs every row beneath
   * it. When only some are, those rows carry a `◇` and the footnote explains the mark.
   * Either way no date is ever printed as a confirmed fact.
   */
  const inferred = milestones.filter((m) => !m.dueConfirmed).length;
  const allInferred = milestones.length > 0 && inferred === milestones.length;
  const markRows = inferred > 0 && !allInferred;

  const datedHeading = quest ? "Set pieces with a date" : "Dated";
  const undatedHeading = quest ? "Set pieces with no date yet" : "Not dated yet";

  return (
    <section className="card" aria-labelledby="campaign-arc-heading">
      <h2 id="campaign-arc-heading">
        {quest && <span aria-hidden="true">{"⚜ "}</span>}
        {heading}
      </h2>

      {/* Flavour is quest-only and says nothing the numbers do not (cf. WeekMap). */}
      {quest && (
        <p className="muted" style={{ fontStyle: "italic", margin: "0 0 0.75rem" }}>
          Every campaign has its set pieces. They arrive whether or not the ground is
          prepared, so the useful question is how much of it already is.
        </p>
      )}

      {/* ---- Summary band: the aggregate, stated once, at the top. ----
          The band deliberately mirrors the term banner on the Course-progress card so the
          two read as one system, and it leads with the unprepared count because that is
          the figure a student can act on this afternoon. */}
      <div
        style={
          quest
            ? {
                position: "relative",
                margin: "0 0 0.5rem",
                padding: "0.8rem 1rem 0.9rem",
                borderRadius: 5,
                color: Q.parchment,
                background: `linear-gradient(180deg, #2c2013, ${Q.leather})`,
                border: `1px solid ${Q.goldDim}`,
                boxShadow:
                  "inset 0 1px 0 rgba(232, 201, 90, 0.18), 0 2px 10px rgba(0, 0, 0, 0.45)",
              }
            : {
                margin: "0 0 0.5rem",
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

        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <Stat
            quest={quest}
            caption={quest ? "No ground prepared" : "No time set aside"}
            value={`${unprepared} of ${total}`}
            detail={
              unprepared === 0
                ? quest
                  ? "every set piece has blocks laid"
                  : "every piece has blocks scheduled"
                : undefined
            }
          />
          <Stat
            quest={quest}
            caption={quest ? "Ground already prepared" : "Preparation scheduled"}
            value={
              prepBlocks === 0
                ? "none yet"
                : `${prepBlocks} ${prepBlocks === 1 ? "block" : "blocks"}`
            }
            detail={prepBlocks === 0 ? undefined : formatEffort(prepMinutes)}
          />
          {/* Only shown when it is true of the data, and phrased as a state of the list
              rather than as something the student did. */}
          {overdue > 0 && (
            <Stat
              quest={quest}
              caption={quest ? "Dates already behind you" : "Dates already past"}
              value={`${overdue}`}
              detail={quest ? "still open — check below" : "still open — see below"}
            />
          )}
          {undatedMilestones.length > 0 && (
            <Stat
              quest={quest}
              caption={quest ? "Awaiting a date" : "Missing a date"}
              value={`${undatedMilestones.length}`}
              detail={quest ? "needs confirming" : "needs confirming"}
            />
          )}
        </div>
      </div>

      {/* ---- Part 1: the dated arc, banded by distance. ---- */}
      {milestones.length > 0 && (
        <>
          <Rule as="h3" quest={quest}>
            <Themed visible={datedHeading} plain="Dated major work" />
            {allInferred && (
              <>
                {" · "}
                {/* Said here, once, rather than thirteen times down the rows. */}
                <span style={{ letterSpacing: "0.06em", textTransform: "none", fontWeight: 400 }}>
                  <Themed
                    visible="every date below is inferred, none confirmed"
                    plain="every date below was inferred from a syllabus, not confirmed"
                  />
                </span>
              </>
            )}
          </Rule>

          {BANDS.map((band, bandIndex) => {
            // A row belongs to the first band that holds it, so the tests can stay simple
            // one-sided comparisons and no row can land in two bands.
            const rows = milestones.filter(
              (m) =>
                band.holds(m.daysAway) &&
                !BANDS.slice(0, bandIndex).some((earlier) => earlier.holds(m.daysAway)),
            );
            if (rows.length === 0) return null;
            const attention = band.key === "overdue";

            return (
              <div key={band.key}>
                <Rule quest={quest} tone={attention ? "attention" : undefined}>
                  <Themed visible={quest ? band.quest : band.plain} plain={band.plain} />
                  <span aria-hidden="true">{` · ${rows.length}`}</span>
                  <span className="sr-only">
                    {`, ${rows.length} ${rows.length === 1 ? "item" : "items"}`}
                  </span>
                </Rule>

                {/* Past-due rows get one calm sentence explaining what they usually mean.
                    In the test semester the -237d row is a stale 2025 date the extractor
                    read off a syllabus — a data-quality problem, not a student failure, and
                    the copy names the likely fix rather than the shortfall. */}
                {attention && (
                  <p
                    className="muted"
                    style={{ margin: "0.35rem 0 0.1rem", fontSize: "0.82rem" }}
                  >
                    <Themed
                      visible={
                        quest
                          ? "These dates have passed and the work is still open. Most often the date itself is wrong — inferred from a syllabus that stated an older term — so the first move is to check it, not to rush."
                          : "These dates have passed and the work is still open. Most often the date itself is wrong — it was inferred from a syllabus that stated an older term — so the first step is to check the date, not to rush the work."
                      }
                      plain="These dates have passed and the work is still open. Most often the date itself is wrong — it was inferred from a syllabus that stated an older term — so the first step is to check the date, not to rush the work."
                    />
                  </p>
                )}

                {/* A month run only earns a sub-heading in the open-ended band, and only
                    when that band is long enough for a flat list to stop being scannable.
                    Bounded bands ("within 7 days") are short by construction. */}
                {band.key === "term" && rows.length > 4 ? (
                  byMonth(rows).map((run) => (
                    <div key={run.key}>
                      <div
                        style={{
                          margin: "0.5rem 0 0",
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          color: quest ? Q.inkDim : "var(--text-dim)",
                        }}
                      >
                        {run.label}
                        <span aria-hidden="true">{` · ${run.rows.length}`}</span>
                        <span className="sr-only">
                          {`, ${run.rows.length} ${run.rows.length === 1 ? "item" : "items"}`}
                        </span>
                      </div>
                      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {run.rows.map((m, index) => (
                          <DatedRow
                            key={m.workItemId}
                            milestone={m}
                            course={coursesById.get(m.courseId)}
                            quest={quest}
                            markInferred={markRows && !m.dueConfirmed}
                            first={index === 0}
                            last={index === run.rows.length - 1}
                          />
                        ))}
                      </ol>
                    </div>
                  ))
                ) : (
                  <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {rows.map((m, index) => (
                      <DatedRow
                        key={m.workItemId}
                        milestone={m}
                        course={coursesById.get(m.courseId)}
                        quest={quest}
                        markInferred={markRows && !m.dueConfirmed}
                        first={index === 0}
                        last={index === rows.length - 1}
                      />
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ---- Part 2: major work with no date. ----
          Kept as a section of its own rather than appended to the end of the arc. An
          undated exam is not a lesser exam; it is the same exam with one fact missing, and
          the missing fact is what the student can actually do something about today. */}
      {undatedMilestones.length > 0 && (
        <>
          <Rule as="h3" quest={quest} tone="attention">
            <Themed visible={undatedHeading} plain="Major work with no date yet" />
            <span aria-hidden="true">{` · ${undatedMilestones.length}`}</span>
            <span className="sr-only">
              {`, ${undatedMilestones.length} ${
                undatedMilestones.length === 1 ? "item" : "items"
              }`}
            </span>
          </Rule>

          <p className="muted" style={{ margin: "0.35rem 0 0.5rem", fontSize: "0.82rem" }}>
            <Themed
              visible={
                quest
                  ? "No syllabus stated a date for these, so they cannot be placed on the road above. Confirming a date is the single thing that moves one of them onto it."
                  : "No syllabus stated a date for these, so they cannot be placed on the timeline above. Confirming a date is the single thing that moves one of them onto it."
              }
              plain="No syllabus stated a date for these, so they cannot be placed on the timeline above. Confirming a date is the single thing that moves one of them onto it."
            />
          </p>

          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {undatedMilestones.map((m) => {
              const course = coursesById.get(m.courseId);
              const name = courseLabel(course, m.courseId);
              const prepared = m.prepBlocks > 0;

              return (
                <li
                  key={m.workItemId}
                  style={{
                    padding: "0.6rem 0 0.6rem 0.7rem",
                    marginBottom: "0.4rem",
                    borderLeft: quest
                      ? `3px dashed ${Q.wax}`
                      : "3px dashed var(--accent-dim)",
                    // A wash rather than a fill: it separates the block from the arc above
                    // without turning it into a warning banner. Kept at 6% so the dim ink
                    // below still measures over 5:1 on the darker parchment stop.
                    background: quest ? "rgba(140, 47, 40, 0.06)" : "var(--surface-2)",
                    borderRadius: quest ? 3 : 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      flexWrap: "wrap",
                      paddingLeft: "0.4rem",
                    }}
                  >
                    <Sigil course={course} courseId={m.courseId} quest={quest} />
                    <span
                      style={{
                        flex: "1 1 12rem",
                        minWidth: 0,
                        fontWeight: 600,
                        fontSize: "0.98rem",
                        color: quest ? Q.ink : "var(--text)",
                      }}
                    >
                      {m.title}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "0.82rem",
                        whiteSpace: "nowrap",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        padding: "0.12rem 0.5rem",
                        borderRadius: quest ? 4 : 999,
                        background: quest ? Q.wax : "transparent",
                        border: quest ? "1px solid rgba(0, 0, 0, 0.35)" : "1px solid var(--border)",
                        color: quest ? Q.chipCream : "var(--text)",
                      }}
                    >
                      <Themed visible="date unknown" plain="due date unknown" />
                    </span>
                  </div>

                  <div style={{ marginLeft: 38, paddingLeft: "0.4rem" }}>
                    <p
                      style={{
                        margin: "0.15rem 0 0.35rem",
                        fontSize: "0.82rem",
                        color: quest ? Q.inkDim : "var(--text-dim)",
                      }}
                    >
                      {name}
                      {" · "}
                      {workTypeLabel(m.workType)}
                    </p>

                    <PrepChip blocks={m.prepBlocks} minutes={m.prepMinutes} quest={quest} />

                    {/* The sharpest sentence on the card, and it is only ever printed when
                        the data earns it: time already booked against work nobody has
                        dated means the plan is placing that time on a guess. */}
                    <p
                      style={{
                        margin: "0.4rem 0 0",
                        fontSize: "0.86rem",
                        fontWeight: prepared ? 600 : 400,
                        color: quest ? Q.ink : "var(--text)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{ color: quest ? Q.wax : "var(--text-dim)" }}
                      >
                        {"◈ "}
                      </span>
                      {prepared ? (
                        <Themed
                          visible={
                            quest
                              ? `${formatEffort(m.prepMinutes)} of preparation is already aimed at this and no date is set, so the plan is guessing where it belongs. Confirm the date and that time gets aimed properly.`
                              : `${formatEffort(m.prepMinutes)} of preparation is already scheduled for this and no due date is set, so the plan is placing that time on a guess. Confirm the date to fix where it belongs.`
                          }
                          plain={`${spellEffort(
                            m.prepMinutes,
                          )} of preparation is already scheduled for this and no due date is set, so the plan is placing that time on a guess. Confirm the date to fix where it belongs.`}
                        />
                      ) : (
                        <Themed
                          visible="No date, and no time set aside yet. Confirm the date and this can be placed and prepared for."
                          plain="No date, and no preparation time set aside yet. Confirm the date and this can be placed and prepared for."
                        />
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ---- Footnotes: said once for the whole card, never per row. ---- */}
      {markRows && (
        <p className="muted" style={{ margin: "0.85rem 0 0", fontSize: "0.8rem" }}>
          <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
            {"◇ "}
          </span>
          {/* No `Themed` wrapper: this is a statement about the data, and there is no
              themed version of it to reconcile. */}
          {inferred === 1
            ? "One of these dates was inferred from a syllabus rather than confirmed, and is marked. Treat a marked date as a best reading, not a stated deadline."
            : `${inferred} of these dates were inferred from a syllabus rather than confirmed, and are marked. Treat a marked date as a best reading, not a stated deadline.`}
        </p>
      )}

      {milestones.length > 1 && (
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>
          <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
            {"◇ "}
          </span>
          {/* Identical under every theme, so no `Themed` wrapper: the layout makes a
              promise it does not keep — rows are evenly spaced and the gaps between the
              real dates are not — and that caveat is not a place for flavour. */}
          Ordered by date and grouped by distance. The spacing is not to scale — the day
          count on each row is the distance.
        </p>
      )}

      <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8rem" }}>
        <Themed
          visible={
            quest
              ? "Nothing here counts down against you. A day count is a distance, and a hollow mark is simply ground not yet prepared."
              : "Nothing here counts down against you. A day count is a distance, and an empty preparation figure is simply time not set aside yet."
          }
          plain="Nothing here counts down against you. A day count is a distance, and an empty preparation figure is simply time not set aside yet."
        />
      </p>
    </section>
  );
}
