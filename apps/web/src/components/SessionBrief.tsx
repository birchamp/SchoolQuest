import type { Course, ThemeName } from "@schoolquest/domain";
import { explainBlockKind, explainDayLoad, plainDayLoad } from "@schoolquest/theme-language";
import type { DayShapeView, FallbackView, SessionBriefView } from "../lib/types";

/**
 * The week as prepared session notes (packages/planning-engine/src/session-brief.ts,
 * docs/07-session-prep-design.md).
 *
 * The review that produced this design called the old week view "spreadsheet-in-costume":
 * a seven-column agenda grid with fantasy nouns pasted on. Renaming a calendar does not
 * reshape it. So this card is not the grid — it is the three things a Dungeon Master
 * actually writes down before play, each of which maps onto a documented deficit of the
 * student this app is for:
 *
 * 1. The spine — the one thing the week turns on. Prioritisation is the core deficit, and
 *    one named focus beats a ranked list of nine.
 * 2. The shape — how the week paces, from minutes weighted by cognitive demand. This is
 *    what stops a day of three high-demand blocks that will simply not happen.
 * 3. The contingencies — "if the party skips the tavern…". Recovery after a lost day is the
 *    documented failure mode, and generic advice is worse than nothing here.
 *
 * Deliberately *not* rendered: `brief.encounters` (the week grid owns those) and
 * `brief.milestones` (the term arc owns those). Both are still read below, but only as a
 * name lookup — a fallback names work items by id and the ids have to resolve to something.
 *
 * Three rules constrain every branch:
 *
 * - Quest chrome is presentation only. Plain is a calm planner readout with no metaphor in
 *   it at all; if the card is not useful in plain clothes then the metaphor was carrying
 *   meaning, which is the failure this design exists to avoid.
 * - Every themed word ships its plain equivalent in `.sr-only` (the `Themed` helper, same
 *   pattern as Questline.tsx), and every date, count and load reads identically with the
 *   flavour stripped out.
 * - Nothing is invented. `spine.dueAt` is often null and then no date is printed; a title
 *   that cannot be resolved becomes a course name or is left out of the sentence, never
 *   guessed; and no figure is rounded into looking better than it is.
 */

/**
 * Quest palette, duplicated from the `--q-*` custom properties in styles.css as literals.
 * These are only ever applied when `theme === "quest"`; hard-coding them keeps the
 * component readable in isolation, as Questline.tsx and Today.tsx already do.
 *
 * The two "dim" entries are measured, not chosen by eye: #5b4930 sits at 5.9:1 on the
 * darkest stop of the parchment tiles below, and #cbb98c at 9.7:1 on the leather banner.
 * Gold is absent on purpose — #c9a227 measures 1.6:1 on parchment, so it may only ever
 * fill a shape or mark a decoration, never carry a word.
 */
const Q = {
  ink: "#2a1f14",
  parchment: "#efe3c8",
  parchmentDeep: "#e4d4b0",
  leather: "#16100b",
  goldDim: "#8a6f1f",
  wax: "#8c2f28",
  inkDim: "#5b4930",
  parchmentDim: "#cbb98c",
} as const;

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "95" -> "1h 35m". The compact form, for the seven narrow day tiles. */
function formatEffort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * "95" -> "1 hour 35 minutes". Used in every full sentence, because "1h 35m" inside prose
 * is announced as "1 h 35 m" and these sentences are the part of the card a student is
 * most likely to be hearing rather than reading.
 */
function spokenEffort(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (rest > 0 || hours === 0) parts.push(`${rest} ${rest === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/** Locale-formatted, never rounded into a friendlier number. */
function num(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Date-only strings are UTC calendar days; parsing them locally shifts the weekday. */
function weekdayOf(date: string): string {
  return DAY_LONG[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? date;
}

/**
 * A due date is an instant, so it is read in the student's own zone — the same treatment
 * every other screen gives `startAt`. The weekday alone is ambiguous once a deadline is
 * more than a week out, so the calendar date rides along with it.
 */
function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Course code appended only when the name does not already carry it (see WeekMap). */
function courseLabel(course: Course | undefined): string | null {
  if (!course) return null;
  return course.code && !course.name.includes(course.code)
    ? `${course.name} (${course.code})`
    : course.name;
}

/**
 * Themed wording on screen, plain wording for assistive tech. Screen-reader output must
 * never depend on the visual theme (docs/02-prd.md §5 Accessibility). When the two agree —
 * which is most of this card, and by design — nothing is duplicated.
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

/** Section rule inside the card. `.card h2` is the card's own title, so these are h3s. */
function SubHead({
  quest,
  visible,
  plain,
}: {
  quest: boolean;
  visible: string;
  plain: string;
}) {
  return (
    <h3
      style={{
        margin: "1.1rem 0 0.5rem",
        fontSize: "0.66rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        color: quest ? Q.wax : "var(--text-dim)",
        borderBottom: quest
          ? "1px solid rgba(138, 111, 31, 0.38)"
          : "1px solid var(--border)",
        paddingBottom: "0.3rem",
      }}
    >
      <Themed visible={visible} plain={plain} />
    </h3>
  );
}

/** The three-way theme split, written once so no sentence below has to repeat it. */
function pick<T>(theme: ThemeName, quest: T, mission: T, plain: T): T {
  return theme === "quest" ? quest : theme === "mission" ? mission : plain;
}

/**
 * Names for the work items a contingency is about, and course names for the spine.
 *
 * `Fallback` carries ids rather than titles so the client can name them without re-deriving
 * anything, and the props hold `courses` rather than work items. The titles come from the
 * brief's own payload instead: both id-carrying codes are built from the same encounter
 * groups this brief already contains, so every id in a fallback is an id `brief.encounters`
 * can name. `workItemTitles` overrides that for a caller who trims those groups out of the
 * response, and an id that still resolves to nothing is left out of the sentence rather than
 * described with a guess.
 *
 * The encounter and milestone lists are read here and rendered nowhere: the week grid owns
 * the first and the term arc owns the second.
 */
function buildNaming(
  brief: SessionBriefView,
  courses: Course[],
  workItemTitles: Map<string, string> | undefined,
) {
  const coursesById = new Map(courses.map((c) => [c.id, c]));
  const titleById = new Map<string, string>();

  for (const group of brief.encounters) titleById.set(group.workItemId, group.title);
  for (const m of brief.milestones) titleById.set(m.workItemId, m.title);
  for (const m of brief.undatedMilestones) titleById.set(m.workItemId, m.title);
  if (brief.spine) titleById.set(brief.spine.workItemId, brief.spine.title);
  for (const [id, title] of workItemTitles ?? []) titleById.set(id, title);

  return {
    course: (courseId: string) => courseLabel(coursesById.get(courseId)),
    /** Ids that resolve to nothing are dropped, so the list never holds a placeholder. */
    names: (ids: string[]): string[] =>
      ids.map((id) => titleById.get(id)).filter((n): n is string => n !== undefined && n !== ""),
  };
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
}

type Naming = ReturnType<typeof buildNaming>;

/**
 * One "if the party…" line, composed from the code and its own figures.
 *
 * Every one of these is about recovery. None of them may read as a reprimand: a lost day is
 * a fact to plan around, and the whole reason a DM writes contingencies down is that the
 * plan going sideways is normal rather than a failure (docs/02-prd.md §3).
 */
function fallbackSentence(
  fallback: FallbackView,
  theme: ThemeName,
  naming: Naming,
): { visible: string; plain: string } | null {
  switch (fallback.code) {
    case "SHORT_WINDOW": {
      const name = joinNames(naming.names(fallback.workItemIds)) || null;
      const when = fallback.date ? ` on ${weekdayOf(fallback.date)}` : "";
      // The engine picked the shortest block still ahead, so the window has a real answer
      // rather than a suggestion to go and find more time.
      const opening =
        fallback.minutes === null
          ? "If you only get a short window"
          : `If you only get ${spokenEffort(fallback.minutes)}`;
      const tail = pick(
        theme,
        "the shortest stretch still ahead of you",
        "the shortest block still ahead",
        "the shortest block still ahead",
      );
      const plainTail = "the shortest block still ahead";
      return name
        ? {
            visible: `${opening}: ${name}${when} is exactly that long — ${tail}.`,
            plain: `${opening}: ${name}${when} is exactly that long — ${plainTail}.`,
          }
        : {
            visible: `${opening}: there is a block exactly that long${when} — ${tail}.`,
            plain: `${opening}: there is a block exactly that long${when} — ${plainTail}.`,
          };
    }

    case "CRUX_DAY_LOST": {
      if (!fallback.date) return null;
      const when = weekdayOf(fallback.date);
      const names = naming.names(fallback.workItemIds);
      // A name that could not be resolved is dropped rather than guessed, so the count that
      // drives the grammar is the count of names actually printed — not the count of ids.
      const plural = names.length > 1;
      const subject = plural ? joinNames(names) : (names[0] ?? "the work scheduled that day");
      const verb = plural ? "have" : "has";
      const them = plural ? "them" : "it";
      // Precisely what breaks, and what to do about it. The engine's test is that every
      // block still held for these items sits on that day or later while their deadlines
      // land right behind it — so there is nowhere left to put the work, and the answer is
      // to move something earlier rather than to plan a longer day.
      const detail = `every block still held for ${them} sits on that day or after it, and the deadlines follow close behind`;
      const plain = `If ${when} does not happen: ${subject} ${verb} no later slot to fall back on — ${detail}. Moving one earlier is the recovery, not a longer ${when}.`;
      return {
        visible: pick(
          theme,
          `If ${when} is lost: ${subject} ${verb} nothing behind ${them} to fall back on — ${detail}. Moving one earlier is the recovery; a longer ${when} is not.`,
          `If ${when} is lost: ${subject} ${verb} no later window — ${detail}. Moving one earlier is the recovery, not a longer ${when}.`,
          plain,
        ),
        plain,
      };
    }

    case "SLACK_REMAINING": {
      const amount = fallback.minutes === null ? null : spokenEffort(fallback.minutes);
      const plain = amount
        ? `${amount} of your study time this week is still unscheduled. That is the room you have to move things into if a day goes differently.`
        : "Some of your study time this week is still unscheduled — that is the room you have to move things into.";
      return {
        visible: pick(
          theme,
          amount
            ? `Reserves: ${amount} of the week is still unspoken for — that is the room you have to move things into if a day goes differently.`
            : "Reserves: some of the week is still unspoken for — that is the room you have to move things into.",
          plain,
          plain,
        ),
        plain,
      };
    }

    case "NO_SLACK": {
      // An honest "none" is the useful answer. It is also the one line most at risk of
      // sounding like a telling-off, so it says what a new commitment costs and stops.
      const plain =
        "Every available hour this week is already scheduled. Anything new displaces something already planned rather than adding to it — so it is a swap, not an extra.";
      return {
        visible: pick(
          theme,
          "No reserves left: every available hour is committed. Anything new takes the place of something else rather than adding to it — a swap, not an extra.",
          plain,
          plain,
        ),
        plain,
      };
    }

    default:
      // An unknown code means the engine grew a contingency this component has not learned.
      // Dropping it is honest; inventing a sentence for it is not.
      return null;
  }
}

/** One day of the seven-across strip. */
function DayTile({
  day,
  isCrux,
  fillPercent,
  highestWeighted,
  quest,
  theme,
}: {
  day: DayShapeView;
  isCrux: boolean;
  fillPercent: number;
  highestWeighted: number;
  quest: boolean;
  theme: ThemeName;
}) {
  const dayNumber = Number(day.date.slice(8, 10));
  const weekdayShort = DAY_SHORT[day.dayOfWeek] ?? "";
  const assessment = day.carriesAssessment;

  return (
    <li
      style={{
        position: "relative",
        minWidth: 0,
        padding: "0.35rem 0.3rem 0.4rem",
        borderRadius: quest ? 3 : 7,
        overflowWrap: "break-word",
        color: quest ? Q.ink : "var(--text)",
        // The crux tile is lifted and ringed; the tile carrying something due is bordered in
        // wax (quest) or accent (plain) with a heavy top edge. Both also carry a word, so
        // colour is never the only signal.
        background: quest
          ? isCrux
            ? "linear-gradient(180deg, #fdf6e4, #f0e2c0)"
            : `linear-gradient(180deg, #f4ecd6, ${Q.parchmentDeep})`
          : isCrux
            ? "var(--surface)"
            : "var(--surface-2)",
        border: assessment
          ? `1px solid ${quest ? Q.wax : "var(--accent)"}`
          : `1px solid ${quest ? "#9b7c3c" : "var(--border)"}`,
        borderTopWidth: assessment ? 3 : 1,
        boxShadow: isCrux
          ? quest
            ? "0 0 0 1px rgba(201, 162, 39, 0.9)"
            : "inset 0 0 0 1px var(--accent-dim)"
          : undefined,
      }}
    >
      <div
        style={{
          fontSize: "0.58rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: quest ? Q.wax : "var(--text-dim)",
        }}
      >
        {weekdayShort} {dayNumber}
      </div>

      {/* The pacing signal. Height compares this day's weighted hours with the busiest day
          of the horizon — a relative reading, which the footnote states outright, since a
          fixed scale would need a threshold the engine keeps to itself. The meter carries
          the exact figure so it is available without crowding a 3rem column. */}
      <div
        role="meter"
        aria-valuenow={day.weightedHours}
        aria-valuemin={0}
        aria-valuemax={highestWeighted}
        aria-label={`${DAY_LONG[day.dayOfWeek]} ${dayNumber}: ${num(
          day.weightedHours,
        )} weighted hours, against ${num(highestWeighted)} on this week's busiest day`}
        style={{
          position: "relative",
          height: 30,
          margin: "0.3rem 0",
          borderRadius: 2,
          overflow: "hidden",
          // The empty part of a track is drawn as nothing but a faint outline. Filling it —
          // dark slab or light groove — made a clear day and a light day look alike, because
          // the loudest object in both tiles was the empty space. Only the fill carries load.
          background: "transparent",
          border: `1px solid ${quest ? "rgba(138, 111, 31, 0.42)" : "var(--border)"}`,
        }}
      >
        {fillPercent > 0 && (
          <span
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: `${fillPercent}%`,
              background: quest
                ? assessment
                  ? `linear-gradient(180deg, #b04a3f, ${Q.wax})`
                  : "linear-gradient(180deg, #f2dc8a, #c9a227 55%, #8a6f1f)"
                : assessment
                  ? "var(--accent)"
                  : "var(--accent-dim)",
            }}
          />
        )}
      </div>

      <div
        style={{
          fontSize: "0.6rem",
          lineHeight: 1.25,
          fontWeight: 600,
          color: quest ? Q.ink : "var(--text)",
        }}
      >
        <Themed visible={explainDayLoad(day.load, theme)} plain={plainDayLoad(day.load)} />
      </div>

      {/* A clear day prints no figure: the load word already says the day is open, and
          "0m" reads as a measurement of nothing. */}
      {day.minutes > 0 && (
        <div
          style={{
            fontSize: "0.62rem",
            fontVariantNumeric: "tabular-nums",
            color: quest ? Q.inkDim : "var(--text-dim)",
          }}
        >
          {formatEffort(day.minutes)}
        </div>
      )}

      {assessment && (
        <div
          style={{
            marginTop: "0.2rem",
            fontSize: "0.58rem",
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: quest ? Q.wax : "var(--text)",
          }}
        >
          <span aria-hidden="true" style={{ color: quest ? Q.wax : "var(--accent)" }}>
            {"◆ "}
          </span>
          <Themed
            visible={pick(theme, "Set piece", "Key event", "Due")}
            plain="something major is due this day"
          />
        </div>
      )}

      {isCrux && (
        <div
          style={{
            marginTop: "0.2rem",
            fontSize: "0.58rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: quest ? Q.inkDim : "var(--text-dim)",
          }}
        >
          <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
            {"✦ "}
          </span>
          <Themed
            // Kept to short words on purpose: at a phone's column width a longer label has
            // to break mid-word, which reads as a rendering fault rather than as a marker.
            visible={pick(theme, "The crux", "Pivot day", "Pivotal day")}
            plain="the day this week hinges on"
          />
        </div>
      )}
    </li>
  );
}

export function SessionBrief({
  brief,
  courses,
  theme,
  workItemTitles,
}: {
  brief: SessionBriefView;
  courses: Course[];
  theme: ThemeName;
  /**
   * Optional work-item titles by id, for the contingency sentences. Without it those
   * sentences use the titles the brief's own encounter groups carry, which covers every id a
   * fallback can hold; a sentence whose subject cannot be named is phrased without it.
   */
  workItemTitles?: Map<string, string>;
}): JSX.Element {
  const quest = theme === "quest";
  const naming = buildNaming(brief, courses, workItemTitles);

  const heading = pick(theme, "The session brief", "Weekly brief", "This week in brief");

  // Nothing scheduled. Said plainly, and the card stops: a shape strip of seven empty days
  // and a contingency for a week with no blocks in it would be furniture, not information.
  if (!brief.spine) {
    return (
      <section className="card" aria-labelledby="session-brief-heading">
        <h2 id="session-brief-heading">
          {quest && <span aria-hidden="true">{"⚜ "}</span>}
          <Themed visible={heading} plain="This week in brief" />
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          <Themed
            visible={pick(
              theme,
              "No blocks are laid down for this week, so there is nothing to brief yet.",
              "No blocks are scheduled this week, so there is nothing to brief yet.",
              "No study blocks are scheduled this week, so there is nothing to brief yet.",
            )}
            plain="No study blocks are scheduled this week, so there is nothing to brief yet."
          />
        </p>
      </section>
    );
  }

  const spine = brief.spine;
  const spineCourse = naming.course(spine.courseId);
  const highestWeighted = brief.days.reduce((max, d) => Math.max(max, d.weightedHours), 0);
  const contingencies = brief.fallbacks
    .map((fallback) => ({ fallback, sentence: fallbackSentence(fallback, theme, naming) }))
    .filter((entry): entry is { fallback: FallbackView; sentence: { visible: string; plain: string } } =>
      entry.sentence !== null,
    );

  const crux = brief.crux;
  const cruxReason = crux?.carriesAssessment
    ? "something major is due"
    : "it carries the heaviest weighted load of the week";
  const majorAssessment = explainBlockKind("major_assessment", theme);

  return (
    <section className="card" aria-labelledby="session-brief-heading">
      <h2 id="session-brief-heading">
        {quest && <span aria-hidden="true">{"⚜ "}</span>}
        <Themed visible={heading} plain="This week in brief" />
      </h2>

      {/* Flavour is quest-only and says nothing the data below does not (cf. WeekMap). */}
      {quest && (
        <p className="muted" style={{ fontStyle: "italic", margin: "0 0 0.75rem" }}>
          A session is prepped before it is played: what the week turns on, how it paces,
          and what to do if a day is lost.
        </p>
      )}

      {/* ---- 1. The spine: the one thing the week turns on, stated largest. ---- */}
      <div
        style={
          quest
            ? {
                position: "relative",
                padding: "0.85rem 1rem 0.9rem",
                borderRadius: 4,
                color: Q.parchment,
                background: `linear-gradient(180deg, #2c2013, ${Q.leather})`,
                border: `1px solid ${Q.goldDim}`,
                boxShadow:
                  "inset 0 1px 0 rgba(232, 201, 90, 0.18), 0 2px 10px rgba(0, 0, 0, 0.45)",
              }
            : {
                padding: "0.8rem 0.9rem 0.85rem",
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

        {/* The kicker is the only themed part of the banner. The title beneath it is data,
            printed as it stands, which is why it is not wrapped in flavour. */}
        <div
          style={{
            fontSize: "0.64rem",
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: quest ? Q.parchmentDim : "var(--text-dim)",
          }}
        >
          <Themed
            visible={pick(
              theme,
              "This week turns on",
              "Main effort this week",
              "The week's largest commitment",
            )}
            plain="The week's largest commitment"
          />
        </div>
        <p
          style={{
            margin: "0.2rem 0 0.35rem",
            fontSize: "1.35rem",
            lineHeight: 1.2,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: quest ? Q.parchment : "var(--text)",
            textShadow: quest ? "0 1px 0 rgba(0, 0, 0, 0.8)" : undefined,
          }}
        >
          {spine.title}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "0.88rem",
            color: quest ? Q.parchmentDim : "var(--text-dim)",
          }}
        >
          {spineCourse && <>{spineCourse} &middot; </>}
          {spokenEffort(spine.minutes)} across {spine.blocks}{" "}
          {spine.blocks === 1 ? "block" : "blocks"}
          {/* Printed only when the data has it. A due date is the field most often missing
              from a syllabus, and a plausible-looking guess here would be the single most
              damaging invention on the screen. */}
          {spine.dueAt !== null && <> &middot; due {formatDue(spine.dueAt)}</>}
        </p>
        {spine.dueAt === null && (
          <p
            style={{
              margin: "0.3rem 0 0",
              fontSize: "0.8rem",
              color: quest ? Q.parchmentDim : "var(--text-dim)",
            }}
          >
            No due date is on record for it.
          </p>
        )}
        <p
          style={{
            margin: "0.35rem 0 0",
            fontSize: "0.8rem",
            color: quest ? Q.parchmentDim : "var(--text-dim)",
          }}
        >
          <Themed
            visible={pick(
              theme,
              "More of the week is spent here than anywhere else.",
              "More scheduled time goes here than to anything else this week.",
              "More scheduled time goes here than to anything else this week.",
            )}
            plain="More scheduled time goes here than to anything else this week."
          />
        </p>
      </div>

      {/* ---- 2. The shape: the pacing of the week, one column per day. ---- */}
      <SubHead quest={quest} visible="The shape of the week" plain="The shape of the week" />
      {/* One row always, however narrow the screen: a week wrapped into six-plus-one is not
          a shape. The floor width is what keeps the longest load wording ("Steady march")
          on whole words — below it the column is narrower than the word, and a mid-word
          break reads as a rendering fault. Past that floor the strip scrolls sideways
          rather than shredding its own labels. */}
      <div style={{ overflowX: "auto", scrollbarWidth: "thin" }}>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            minWidth: "23rem",
            display: "grid",
            gridTemplateColumns: `repeat(${brief.days.length}, minmax(0, 1fr))`,
            gap: "0.3rem",
          }}
        >
          {brief.days.map((day) => (
            <DayTile
              key={day.date}
              day={day}
              theme={theme}
              quest={quest}
              isCrux={crux?.date === day.date}
              highestWeighted={highestWeighted}
              fillPercent={
                highestWeighted > 0 ? Math.round((day.weightedHours / highestWeighted) * 100) : 0
              }
            />
          ))}
        </ul>
      </div>

      {crux && (
        <p
          style={{
            margin: "0.6rem 0 0",
            fontSize: "0.9rem",
            color: quest ? Q.ink : "var(--text)",
          }}
        >
          <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
            {"✦ "}
          </span>
          <Themed
            visible={pick(
              theme,
              `${weekdayOf(crux.date)} is the crux — ${cruxReason}.`,
              `${weekdayOf(crux.date)} is the decisive day — ${cruxReason}.`,
              `${weekdayOf(crux.date)} is the day this week hinges on — ${cruxReason}.`,
            )}
            plain={`${weekdayOf(crux.date)} is the day this week hinges on — ${cruxReason}.`}
          />
        </p>
      )}

      {/* Both halves of the strip's basis, stated once. The second sentence matters: bar
          heights are relative to this week, so a quiet week's tallest bar is still a quiet
          day, and the load word beside it is the absolute reading. */}
      <p className="muted" style={{ margin: "0.45rem 0 0", fontSize: "0.8rem" }}>
        <span aria-hidden="true" style={{ color: quest ? Q.goldDim : "var(--text-dim)" }}>
          {"◇ "}
        </span>
        <Themed
          visible={`Load counts each day's minutes weighted by how demanding the work is, which is why a day holding a ${majorAssessment.name.toLowerCase()} is never ${explainDayLoad(
            "light",
            theme,
          ).toLowerCase()}. Bar heights compare the days with each other, not with a fixed scale.`}
          plain={`Load counts each day's minutes weighted by how demanding the work is, which is why a day holding a ${majorAssessment.plainName.toLowerCase()} is never ${plainDayLoad(
            "light",
          ).toLowerCase()}. Bar heights compare the days with each other, not with a fixed scale.`}
        />
      </p>

      {/* ---- 3. Contingencies: the DM's "if the party…" lines. ---- */}
      {contingencies.length > 0 && (
        <>
          <SubHead
            quest={quest}
            visible={pick(
              theme,
              "If the party strays",
              "Contingencies",
              "If the week does not go to plan",
            )}
            plain="If the week does not go to plan"
          />
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {contingencies.map(({ fallback, sentence }) => (
              <li
                key={fallback.code}
                style={{
                  margin: "0 0 0.5rem",
                  paddingLeft: "0.7rem",
                  fontSize: "0.92rem",
                  borderLeft: `2px solid ${quest ? Q.wax : "var(--accent-dim)"}`,
                  color: quest ? Q.ink : "var(--text)",
                }}
              >
                <Themed visible={sentence.visible} plain={sentence.plain} />
              </li>
            ))}
          </ul>
          <p className="muted" style={{ margin: "0.55rem 0 0", fontSize: "0.8rem" }}>
            <Themed
              visible={pick(
                theme,
                "Prep survives the week going sideways. A day that does not happen costs nothing here — it only changes what to do next.",
                "A day that does not happen costs nothing here. It only changes what to do next.",
                "A day that does not happen costs nothing here. It only changes what to do next.",
              )}
              plain="A day that does not happen costs nothing here. It only changes what to do next."
            />
          </p>
        </>
      )}
    </section>
  );
}
