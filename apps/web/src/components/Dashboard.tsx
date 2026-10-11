import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Course, GradeResult, PassFail, WorkItem } from "@schoolquest/domain";
import {
  courseGauges,
  type CourseGauges,
  type CourseSetupFacts,
  type Gauge,
  type GaugeKey,
  type GaugeLevel,
  type GaugeTarget,
} from "@schoolquest/planning-engine";
import { explainHealth, label } from "@schoolquest/theme-language";
import { api } from "../lib/api";
import { courseChipFill, courseInitials } from "../lib/course-colour";
import { noPercentReading, parseScoreEntry, workAwaitingResult } from "../lib/record-results";
import { PassFailButtons, recordPassFail } from "./PassFailButtons";
import type { CourseHealthView, HealthLevel, TermHealthView } from "../lib/types";
import { appNow } from "../lib/clock";
import { useTheme } from "../lib/theme-context";
import { track } from "../lib/usage";

/**
 * Which class needs me?
 *
 * The one question the app could not answer. The week map shows time, the arc shows
 * landmarks, the roster shows completion and the grade page shows standing — each answers
 * its own question well, and a student holding five courses had to assemble "where am I
 * weakest right now" out of four screens. Assembling things out of four screens is the exact
 * deficit this product exists to compensate for, so the board does the assembling.
 *
 * This card used to be two (issue #37): a sentence-per-class board and a separate panel of
 * dials per class. Both read `plan.health`, both answered the same question, and the Stats
 * tab asked it twice. They are one card now. The sentence board is the base, because the
 * sentence is the instruction and it already carried the theme work and the result entry;
 * the dials came across from the gauge board (`courseGauges`,
 * packages/planning-engine/src/course-gauges.ts), condensed to three small ones per row,
 * along with the "go fix it" doors and the setup facts only the gauges knew.
 *
 * Everything here is arranged around being read in about five seconds:
 *
 *  - Worst first, always. The ordering *is* the prioritisation, and it is the whole point.
 *    The list is read top-down and abandoned partway, so the order is the recommendation.
 *  - One sentence per course, not a row of metrics. The sentence is already the instruction;
 *    a number is a riddle the student has to solve before it becomes one.
 *  - The remaining concerns collapse behind a disclosure rather than stacking, so a course
 *    with four problems still occupies one line at rest.
 *  - Colour never carries the verdict alone. Every level ships its word, and the word is
 *    what a screen reader gets — on the verdict and on every dial.
 *  - The click is half the feature. Seeing that Biology is the problem still leaves the
 *    question of where to go about it, so every dial that names a problem is a door to where
 *    it is fixed, and the row's one ranked next step is a button beside the sentence.
 *
 * The grade is never shown without the basis it rests on. A percentage drawn from three
 * quizzes and one drawn from half the course look identical in a big number, and treating
 * them as the same thing is the most misleading thing a student dashboard can do.
 *
 * The verdict is the worst of the engine's own level and the three dials, never an average.
 * A class with no syllabus is not "steady" because nothing in an empty record is overdue,
 * and a word that disagreed with the dial beside it would leave the student to work out
 * which half to believe. The engine's level is folded in because it sees concerns the dials
 * do not model.
 */

/** Parchment-safe values, measured (see SessionBrief.tsx for where each figure comes from). */
const QUEST_INK_DIM = "#5b4930";
const QUEST_WAX = "#8c2f28";
/**
 * The amber used elsewhere on parchment (#8a6f1f) measures 3.28:1 here — under AA. This is
 * darkened until it clears: 4.98:1 on the darkest parchment stop, against 5.62:1 for the wax
 * red beside it and 5.88:1 for the dim ink.
 */
const QUEST_GOLD_DIM = "#6f5200";

/**
 * Verdict colours, per ground.
 *
 * `--at-risk` and `--watch` are tuned for the dark page, not for the parchment a quest card
 * paints under them. Using them here measured 1.99:1 and 1.11:1 — the second is invisible,
 * and it is the identical failure the ledger already records for the Main Quest rationale at
 * 1.06:1. A theme that repaints the ground has to repaint every token that means "text on
 * the ground", every time, and the only way to know it did is to measure.
 *
 * The quest values are the ones already proven on this parchment elsewhere in the app: the
 * wax red used for card headings, and the dim ink used for every secondary line.
 */
function levelColour(level: string, quest: boolean): string {
  if (!quest) {
    return level === "at_risk"
      ? "var(--at-risk)"
      : level === "needs_attention"
        ? "var(--watch)"
        : "var(--text-dim)";
  }
  return level === "at_risk"
    ? QUEST_WAX
    : level === "needs_attention"
      ? QUEST_GOLD_DIM
      : QUEST_INK_DIM;
}

/**
 * Dial colours. These are the card-scoped tokens, which the quest card re-points to ink
 * measured at or above 4.5:1 on every parchment tone (styles.css, the `.card` block under
 * the quest theme) — the dial's own number is text and is held to the same bar.
 */
const GAUGE_COLOUR: Record<GaugeLevel, string> = {
  bad: "var(--at-risk)",
  watch: "var(--watch)",
  good: "var(--safe)",
  unknown: "var(--text-dim)",
};

/** Colour never carries a verdict alone -- every dial level ships its word. */
const GAUGE_WORD: Record<GaugeLevel, string> = {
  bad: "needs a decision",
  watch: "worth a look",
  good: "fine",
  unknown: "not measured yet",
};

const GAUGE_TITLE: Record<GaugeKey, string> = {
  setup: "Set up",
  grade: "Grade",
  planning: "Planned",
  overall: "Overall",
};

const HEALTH_RANK: Record<HealthLevel, number> = { at_risk: 2, needs_attention: 1, steady: 0 };

/** What the readiness endpoint returns: the Setup facts the health engine does not hold. */
interface Readiness {
  calendarEntries: number;
  courses: {
    id: string;
    syllabusCount: number;
    hasMeetingTimes: boolean;
    gradingKnown: boolean;
    workItemCount: number;
  }[];
}

/**
 * The verdict a row carries: the engine's level, raised by the dials when they see worse.
 *
 * An "unknown" or "good" dial never lowers anything -- the engine's own concerns stand.
 */
function effectiveLevel(health: CourseHealthView, gauges: CourseGauges | undefined): HealthLevel {
  const fromDials: HealthLevel =
    gauges?.gauges.overall.level === "bad"
      ? "at_risk"
      : gauges?.gauges.overall.level === "watch"
        ? "needs_attention"
        : "steady";
  return HEALTH_RANK[fromDials] > HEALTH_RANK[health.level] ? fromDials : health.level;
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "nothing";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "in 5 days" / "tomorrow" / "3 days ago". Never a bare signed number. */
function whenDue(days: number | null): string | null {
  if (days === null) return null;
  if (days < -1) return `${Math.abs(days)} days ago`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/*
 * An arc from eight o'clock round to four o'clock: 240 degrees, open at the bottom.
 *
 * A full ring reads as a pie chart -- a share of something -- and these are not shares, they
 * are positions on a scale. The gap is what makes it read as a dial with a floor and a ceiling.
 */
const SWEEP = 240;
const START = -120;
const DIAL_SIZE = 60;

function pointOn(cx: number, cy: number, r: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const from = pointOn(cx, cy, r, fromDeg);
  const to = pointOn(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${r} ${r} 0 ${large} 1 ${to.x} ${to.y}`;
}

/**
 * One small dial. Decorative to assistive tech: the button or wrapper around it carries the
 * whole statement in words, and announcing both would read every dial twice.
 */
function Dial({ gauge }: { gauge: Gauge }) {
  const size = DIAL_SIZE;
  const stroke = 6;
  const r = size / 2 - stroke;
  const c = size / 2;
  const colour = GAUGE_COLOUR[gauge.level];
  const filled = gauge.value === null ? 0 : gauge.value;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <path
        d={arcPath(c, c, r, START, START + SWEEP)}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {gauge.value !== null && (
        /*
          A floor on the drawn arc, not on the value.

          Read off the rendered board: a dial at zero drew nothing, so a class with no time
          booked -- amber, and one of the two states worth acting on -- was an empty grey ring,
          identical to a dial with nothing to measure. The one reading that most needs to be
          seen was the one that disappeared. A stub of arc keeps the colour on screen; the
          number underneath still says 0.
        */
        <path
          d={arcPath(c, c, r, START, START + Math.max(SWEEP * filled, 4))}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      )}
      <text
        x={c}
        y={c + 3}
        textAnchor="middle"
        /* Coloured by level, so the verdict survives a value too small to draw much arc. */
        fill={colour}
        style={{ fontSize: "0.8rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
      >
        {/* An empty dial, not a dial at zero. "Nothing recorded" and "nothing achieved" are
            different sentences, and a needle resting on the floor says the second one. */}
        {gauge.value === null ? "--" : `${Math.round(gauge.value * 100)}`}
      </text>
    </svg>
  );
}

/**
 * A dial with its caption, as a door when it has somewhere to send the student.
 *
 * Only a dial with an action is interactive: a green dial, or an empty one with nothing to
 * measure, is a fact, not a door. A dial that names a problem and cannot be clicked hands
 * the student a diagnosis and no next move, which is the whole complaint this answers.
 */
function SmallGauge({
  gauge,
  courseName,
  onNavigate,
}: {
  gauge: Gauge;
  courseName: string;
  onNavigate: (target: GaugeTarget) => void;
}) {
  const title = GAUGE_TITLE[gauge.key];
  const statement = `${courseName} ${title.toLowerCase()}: ${GAUGE_WORD[gauge.level]}. ${gauge.detail}`;
  const body: ReactNode = (
    <>
      <Dial gauge={gauge} />
      <div
        aria-hidden="true"
        style={{
          fontSize: "0.66rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginTop: "-0.35rem",
        }}
      >
        {title}
      </div>
    </>
  );

  if (!gauge.action) {
    return (
      <div role="img" aria-label={statement} title={gauge.detail} style={{ textAlign: "center", minWidth: "4.4rem" }}>
        {body}
      </div>
    );
  }
  const action = gauge.action;
  return (
    <button
      type="button"
      className="gauge-target"
      style={{ minWidth: "4.4rem" }}
      onClick={() => onNavigate(action.target)}
      title={action.label}
      aria-label={`${statement} ${action.label}.`}
    >
      {body}
    </button>
  );
}

export function Dashboard({
  termId,
  health,
  courses,
  workItems,
  grades,
  onChanged,
  onNavigate,
  refreshKey,
}: {
  termId: string;
  health: TermHealthView;
  courses: Course[];
  workItems: WorkItem[];
  /** Results already recorded, so the record-results list never offers to overwrite one. */
  grades: GradeResult[];
  onChanged: () => void;
  /** Where a "go fix it" click should land. The card chooses; the shell routes. */
  onNavigate: (target: GaugeTarget) => void;
  /** Bumped by every Setup save, so the setup dial never reports a fact already fixed. */
  refreshKey?: number;
}) {
  const theme = useTheme();
  const quest = theme === "quest";
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  const load = useCallback(async () => {
    try {
      setReadiness(await api.get<Readiness>(`/api/terms/${termId}/readiness`));
    } catch {
      // Without the setup facts the card still answers the question from the engine alone;
      // it only loses the dials.
      setReadiness(null);
    }
  }, [termId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const coursesById = new Map(courses.map((c) => [c.id, c]));
  const gradedIds = new Set(grades.map((g) => g.workItemId));

  if (health.courses.length === 0) return null;

  const gaugesById = new Map<string, CourseGauges>();
  if (readiness) {
    const setup: CourseSetupFacts[] = readiness.courses.map((course) => ({
      courseId: course.id,
      hasSyllabus: course.syllabusCount > 0,
      hasMeetingTimes: course.hasMeetingTimes,
      gradingKnown: course.gradingKnown,
      workItemCount: course.workItemCount,
    }));
    for (const row of courseGauges({
      health: health.courses,
      setup,
      calendarEntries: readiness.calendarEntries,
    })) {
      gaugesById.set(row.courseId, row);
    }
  }

  /**
   * Worst first. The engine already returns its courses worst first; the dials can only raise
   * a verdict, so the sort is stable and only ever lifts a row the engine could not see into.
   */
  const rows = health.courses
    .map((row) => {
      const gauges = gaugesById.get(row.courseId);
      return { row, gauges, level: effectiveLevel(row, gauges) };
    })
    .sort((a, b) => HEALTH_RANK[b.level] - HEALTH_RANK[a.level]);

  const needing = rows.filter((r) => r.level !== "steady").length;

  return (
    <section
      className="card"
      id="class-board"
      data-card="class-board"
      aria-labelledby="dashboard-heading"
    >
      <h2 id="dashboard-heading">
        <span aria-hidden="true">{label("dashboard", theme)}</span>
        <span className="sr-only">What needs you</span>
      </h2>

      {/* The headline is a count of what needs doing, never a score out of anything. */}
      <p className="muted" style={{ margin: "0 0 0.9rem" }}>
        {needing === 0
          ? `All ${rows.length} ${
              rows.length === 1 ? "course is" : "courses are"
            } holding steady. Nothing here needs you right now.`
          : `${needing} of ${rows.length} ${
              rows.length === 1 ? "course needs" : "courses need"
            } something from you${
              health.coursesUnplanned > 0
                ? `, and ${health.coursesUnplanned} ${
                    health.coursesUnplanned === 1 ? "has" : "have"
                  } no time booked this week`
                : ""
            }.`}
      </p>

      {rows.map(({ row, gauges, level }) => (
        <CourseRow
          key={row.courseId}
          row={row}
          level={level}
          gauges={gauges}
          course={coursesById.get(row.courseId)}
          workItems={workItems}
          gradedIds={gradedIds}
          quest={quest}
          onChanged={onChanged}
          onNavigate={onNavigate}
        />
      ))}

      {gaugesById.size > 0 && (
        <p className="muted" style={{ margin: "0.7rem 0 0", fontSize: "0.82rem" }}>
          A dial reading <strong>--</strong> has nothing to measure yet, which is not the same as
          zero. The verdict takes the worst dial, never the average — a class with one real
          problem is not two-thirds fine. Any dial that names a problem is a link to where you
          fix it.
        </p>
      )}
    </section>
  );
}

function CourseRow({
  row,
  level,
  gauges,
  course,
  workItems,
  gradedIds,
  quest,
  onChanged,
  onNavigate,
}: {
  row: CourseHealthView;
  level: HealthLevel;
  gauges: CourseGauges | undefined;
  course: Course | undefined;
  workItems: WorkItem[];
  gradedIds: ReadonlySet<string>;
  quest: boolean;
  onChanged: () => void;
  onNavigate: (target: GaugeTarget) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const verdict = explainHealth(level, theme);
  // A filled chip with white letters on it, so it needs the fill that is safe for them.
  const tincture = courseChipFill(row.courseId, course?.colorToken);
  const name = course
    ? course.code && !course.name.includes(course.code)
      ? `${course.name} (${course.code})`
      : course.name
    : row.courseId;
  const shortName = course?.code ?? course?.name ?? "Class";

  // When a dial raised the verdict above the engine's, the dial's sentence leads, so the words
  // agree with the colour and with the one next step offered (both of which follow the dial);
  // the engine's own concerns then all sit behind the disclosure (found in review on #41).
  const raisedByDials = HEALTH_RANK[level] > HEALTH_RANK[row.level];
  const top = raisedByDials ? undefined : row.concerns[0];
  const rest = raisedByDials ? row.concerns : row.concerns.slice(1);
  const due = whenDue(row.nextDueInDays);
  const overall = gauges?.gauges.overall;
  // The sentence is the instruction. The engine's worst concern says it best; when the
  // engine has none but a dial does (a missing syllabus is no concern to the health engine),
  // the dial's own sentence stands in rather than a "nothing needs you" that the verdict
  // beside it contradicts.
  const sentence =
    top?.detail ?? (overall && level !== "steady" ? overall.detail : null);
  const nextStep = gauges?.nextStep ?? null;

  return (
    <div
      className="gauge-row"
      style={{
        borderLeftColor: levelColour(level, quest),
        marginTop: "0.6rem",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: "1 1 20rem", minWidth: "15rem" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "1.6rem",
              height: "1.6rem",
              borderRadius: 5,
              background: tincture,
              color: "#fff",
              fontSize: "0.62rem",
              fontWeight: 700,
              letterSpacing: "0.02em",
              flex: "0 0 auto",
            }}
          >
            {courseInitials(row.courseId, course?.code ?? null, course?.name ?? "")}
          </span>

          <strong style={{ flex: "1 1 12rem" }}>{name}</strong>

          {/* The verdict word, never colour alone. */}
          <span
            data-verdict={level}
            style={{
              fontSize: "0.68rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
              color: levelColour(level, quest),
            }}
          >
            <span aria-hidden="true">{verdict.label}</span>
            <span className="sr-only">{verdict.plainLabel}</span>
          </span>
        </div>

        {/* The one sentence that says what to do about it. */}
        {sentence ? (
          <p style={{ margin: "0.35rem 0 0.2rem" }}>{sentence}</p>
        ) : (
          <p className="muted" style={{ margin: "0.35rem 0 0.2rem" }}>
            {verdict.hint}
          </p>
        )}

        {/* The facts a student checks next, on one line and in the order they are asked. */}
        <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.82rem" }}>
          {due && row.nextDueTitle ? (
            <>
              Next: {row.nextDueTitle} <span aria-hidden="true">·</span> {due}
            </>
          ) : (
            <>Nothing dated coming up</>
          )}
          {" · "}
          {/* An empty week is only a finding when there is work it should have held. A course
              with nothing left to do also books nothing, and marking that in the attention
              colour had the line contradicting the verdict beside it — the engine had already
              decided it was fine, and the styling argued back. */}
          {row.bookedMinutes === 0 && row.openItems > 0 ? (
            <span style={{ color: levelColour("needs_attention", quest), fontWeight: 600 }}>
              nothing booked this week
            </span>
          ) : row.bookedMinutes === 0 ? (
            <>nothing left to book</>
          ) : (
            <>
              {formatMinutes(row.bookedMinutes)} booked this week
              {row.blocks > 0 && ` across ${row.blocks} ${row.blocks === 1 ? "block" : "blocks"}`}
            </>
          )}
          {" · "}
          <GradeReading row={row} />
        </p>

        {nextStep && (
          <div className="button-row" style={{ marginTop: "0.45rem" }}>
            {/* One, not a list. A class with four problems still has one thing to do first,
                and offering four is how a student does none of them. */}
            <button
              type="button"
              className="action primary"
              onClick={() => onNavigate(nextStep.target)}
              aria-label={`${shortName}: ${nextStep.label}`}
            >
              {nextStep.label}
            </button>
          </div>
        )}

        {/* Anything beyond the first concern is real but not the headline. Collapsed so a
            course with four problems still reads as one line until asked. */}
        {rest.length > 0 && (
          <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
            <summary style={{ cursor: "pointer", fontSize: "0.82rem", padding: "0.25rem 0" }}>
              {rest.length} more {rest.length === 1 ? "thing" : "things"} about this course
            </summary>
            <ul className="alternatives" style={{ margin: "0.15rem 0 0.35rem" }}>
              {rest.map((concern) => (
                <li key={concern.code} style={{ display: "block", fontSize: "0.86rem" }}>
                  {concern.detail}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* The one concern the student can settle without leaving the page. Every other
            concern is answered by planning or by doing the work; this one is answered by
            typing a number the student already knows, and a board that names a problem it
            gives you no way to fix is worse than a board that stays quiet. */}
        {row.ungradedResults > 0 && (
          <RecordResults
            courseId={row.courseId}
            workItems={workItems}
            gradedIds={gradedIds}
            onChanged={onChanged}
          />
        )}
      </div>

      {gauges && (
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          <SmallGauge gauge={gauges.gauges.setup} courseName={shortName} onNavigate={onNavigate} />
          <SmallGauge gauge={gauges.gauges.grade} courseName={shortName} onNavigate={onNavigate} />
          <SmallGauge gauge={gauges.gauges.planning} courseName={shortName} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

/**
 * The standing, always beside what it rests on.
 *
 * `gradedWeightFraction` is zero whenever the graded work is not mapped to weighted
 * categories, which is most of the time — so "0% of the course graded" would be both true
 * and badly misleading beside a real percentage. The count is the honest basis in that case.
 */
function GradeReading({ row }: { row: CourseHealthView }) {
  if (row.gradePercent === null) {
    return <span>{noPercentReading(row.passFailCount)}</span>;
  }
  const basis =
    row.gradedWeightFraction > 0
      ? `${Math.round(row.gradedWeightFraction * 100)}% of the course graded`
      : `${row.gradedCount} ${row.gradedCount === 1 ? "result" : "results"} so far`;
  return (
    <span>
      {Math.round(row.gradePercent)}% <span aria-hidden="true">·</span>{" "}
      <span className="sr-only">based on </span>
      {basis}
    </span>
  );
}

/** Inline entry for work that is finished and has no result against it. */
function RecordResults({
  courseId,
  workItems,
  gradedIds,
  onChanged,
}: {
  courseId: string;
  workItems: WorkItem[];
  gradedIds: ReadonlySet<string>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, { earned: string; outOf: string }>>({});

  const pending = workAwaitingResult(workItems, courseId, gradedIds, Date.parse(appNow()));
  if (pending.length === 0) return null;

  async function save(item: WorkItem) {
    const score = parseScoreEntry(scores[item.id], item.pointsPossible);
    // Said, not swallowed: this used to return silently, so Save looked broken.
    if (!score) {
      setError("A score needs a number, and a total to be out of.");
      return;
    }

    setBusy(item.id);
    setError(null);
    try {
      await api.put(`/api/work-items/${item.id}/grade`, score);
      track("grade.record");
      setScores((s) => ({ ...s, [item.id]: { earned: "", outOf: "" } }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  async function savePassFail(item: WorkItem, passFail: PassFail) {
    setBusy(item.id);
    setError(null);
    try {
      await recordPassFail(item.id, passFail);
      setScores((s) => ({ ...s, [item.id]: { earned: "", outOf: "" } }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details style={{ marginTop: "0.35rem" }}>
      <summary style={{ cursor: "pointer", fontSize: "0.82rem", padding: "0.25rem 0" }}>
        Record what {pending.length === 1 ? "it" : "they"} scored
      </summary>
      {pending.map((item) => (
        <form
          key={item.id}
          onSubmit={(e) => {
            e.preventDefault();
            void save(item);
          }}
          style={{
            display: "flex",
            gap: "0.4rem",
            alignItems: "center",
            flexWrap: "wrap",
            padding: "0.3rem 0",
          }}
        >
          <span style={{ flex: "1 1 10rem", fontSize: "0.86rem" }}>{item.title}</span>
          <label>
            <span className="sr-only">Score for {item.title}</span>
            <input
              type="number"
              min={0}
              step="any"
              style={{ width: "5rem" }}
              placeholder="score"
              value={scores[item.id]?.earned ?? ""}
              onChange={(e) =>
                setScores((s) => ({
                  ...s,
                  [item.id]: { earned: e.target.value, outOf: s[item.id]?.outOf ?? "" },
                }))
              }
            />
          </label>
          <span aria-hidden="true" className="muted">
            out of
          </span>
          <label>
            <span className="sr-only">Total for {item.title}</span>
            <input
              type="number"
              min={1}
              step="any"
              style={{ width: "5rem" }}
              placeholder={item.pointsPossible !== null ? String(item.pointsPossible) : "total"}
              value={scores[item.id]?.outOf ?? ""}
              onChange={(e) =>
                setScores((s) => ({
                  ...s,
                  [item.id]: { earned: s[item.id]?.earned ?? "", outOf: e.target.value },
                }))
              }
            />
          </label>
          <button className="action" type="submit" disabled={busy === item.id}>
            Save
          </button>
          <span aria-hidden="true" className="muted">
            or
          </span>
          <PassFailButtons
            disabled={busy === item.id}
            onRecord={(passFail) => void savePassFail(item, passFail)}
          />
        </form>
      ))}
      {error && <p className="error">{error}</p>}
    </details>
  );
}
