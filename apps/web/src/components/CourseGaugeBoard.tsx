import { useCallback, useEffect, useState } from "react";
import type { Course } from "@schoolquest/domain";
import {
  courseGauges,
  type CourseSetupFacts,
  type Gauge,
  type GaugeLevel,
  type GaugeTarget,
} from "@schoolquest/planning-engine";

import { api } from "../lib/api";
import type { TermHealthView } from "../lib/types";

/**
 * One panel per class: four dials, and the one thing to do next.
 *
 * The answers already existed and were spread across four screens -- whether a class is set up
 * at all is on Setup, the standing is here, whether the week has time booked for it is on the
 * week, and what is overdue is on Today. Comparing five classes meant visiting all four and
 * holding the results in your head, which is the exact bill this product exists to pay.
 *
 * Nothing here is measured for the first time; `courseGauges` composes what those screens
 * already compute and says which is worst. The click is the point as much as the dial: a
 * student who can see that Biology is the problem still has to work out where to go about it,
 * so the panel takes them there.
 */

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

const LEVEL_COLOUR: Record<GaugeLevel, string> = {
  bad: "var(--at-risk)",
  watch: "var(--watch)",
  good: "var(--safe)",
  unknown: "var(--text-dim)",
};

/** Colour never carries a verdict alone -- every level ships its word. */
const LEVEL_WORD: Record<GaugeLevel, string> = {
  bad: "needs a decision",
  watch: "worth a look",
  good: "fine",
  unknown: "not measured yet",
};

const GAUGE_TITLE: Record<string, string> = {
  setup: "Set up",
  grade: "Grade",
  planning: "Planned",
  overall: "Overall",
};

/**
 * An arc from eight o'clock round to four o'clock: 240 degrees, open at the bottom.
 *
 * A full ring reads as a pie chart -- a share of something -- and these are not shares, they are
 * positions on a scale. The gap is what makes it read as a dial with a floor and a ceiling.
 */
const SWEEP = 240;
const START = -120;

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

function Dial({ gauge, size }: { gauge: Gauge; size: number }) {
  const stroke = size < 90 ? 6 : 9;
  const r = size / 2 - stroke;
  const c = size / 2;
  const colour = LEVEL_COLOUR[gauge.level];
  const filled = gauge.value === null ? 0 : gauge.value;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${GAUGE_TITLE[gauge.key]}: ${LEVEL_WORD[gauge.level]}. ${gauge.detail}`}
    >
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
        y={c + (size < 90 ? 3 : 5)}
        textAnchor="middle"
        /* Coloured by level, so the verdict survives a value too small to draw much arc. */
        fill={gauge.level === "unknown" ? "var(--text-dim)" : colour}
        style={{
          fontSize: size < 90 ? "0.85rem" : "1.25rem",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {/* An empty dial, not a dial at zero. "Nothing recorded" and "nothing achieved" are
            different sentences, and a needle resting on the floor says the second one. */}
        {gauge.value === null ? "--" : `${Math.round(gauge.value * 100)}`}
      </text>
    </svg>
  );
}

function SmallGauge({ gauge }: { gauge: Gauge }) {
  return (
    <div style={{ textAlign: "center", minWidth: "5.2rem" }}>
      <Dial gauge={gauge} size={72} />
      <div
        style={{
          fontSize: "0.7rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginTop: "-0.35rem",
        }}
      >
        {GAUGE_TITLE[gauge.key]}
      </div>
    </div>
  );
}

export function CourseGaugeBoard({
  termId,
  health,
  courses,
  onNavigate,
  refreshKey,
}: {
  termId: string;
  health: TermHealthView;
  courses: Course[];
  /** Where a "what to do next" click should land. The board chooses; the shell routes. */
  onNavigate: (target: GaugeTarget) => void;
  refreshKey?: number;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  const load = useCallback(async () => {
    try {
      setReadiness(await api.get<Readiness>(`/api/terms/${termId}/readiness`));
    } catch {
      setReadiness(null);
    }
  }, [termId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!readiness || health.courses.length === 0) return null;

  const setup: CourseSetupFacts[] = readiness.courses.map((course) => ({
    courseId: course.id,
    hasSyllabus: course.syllabusCount > 0,
    hasMeetingTimes: course.hasMeetingTimes,
    gradingKnown: course.gradingKnown,
    workItemCount: course.workItemCount,
  }));

  const rows = courseGauges({
    health: health.courses,
    setup,
    calendarEntries: readiness.calendarEntries,
  });

  const nameOf = (courseId: string) => {
    const course = courses.find((c) => c.id === courseId);
    return course?.code ?? course?.name ?? "Class";
  };

  /**
   * Worst first.
   *
   * The list is read top-down and abandoned partway, so the order is the recommendation. A
   * board sorted by course code makes the class in trouble a scrolling exercise.
   */
  const severity: Record<GaugeLevel, number> = { bad: 0, watch: 1, unknown: 2, good: 3 };
  const ordered = [...rows].sort(
    (a, b) => severity[a.gauges.overall.level] - severity[b.gauges.overall.level],
  );

  return (
    <section className="card" aria-label="How each class is doing">
      <h2>How each class is doing</h2>

      <div style={{ display: "grid", gap: "0.7rem" }}>
        {ordered.map((row) => {
          const overall = row.gauges.overall;
          return (
            <div
              key={row.courseId}
              style={{
                display: "flex",
                gap: "1rem",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "0.7rem",
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${LEVEL_COLOUR[overall.level]}`,
                borderRadius: "var(--radius)",
                background: "var(--surface-2)",
              }}
            >
              <div style={{ textAlign: "center", minWidth: "6.5rem" }}>
                <Dial gauge={overall} size={104} />
                <div style={{ fontWeight: 600, marginTop: "-0.3rem" }}>{nameOf(row.courseId)}</div>
              </div>

              <div style={{ flex: "1 1 20rem", minWidth: "16rem" }}>
                <p style={{ margin: "0 0 0.5rem" }}>
                  <span style={{ color: LEVEL_COLOUR[overall.level], fontWeight: 600 }}>
                    {LEVEL_WORD[overall.level]}
                  </span>
                  {overall.detail && <span className="muted"> — {overall.detail}</span>}
                </p>

                {row.nextStep && (
                  <div className="button-row">
                    {/* The click is half the feature. Seeing that Biology is the problem still
                        leaves the question of where to go about it. */}
                    <button className="action primary" onClick={() => onNavigate(row.nextStep!.target)}>
                      {row.nextStep.label}
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <SmallGauge gauge={row.gauges.setup} />
                <SmallGauge gauge={row.gauges.grade} />
                <SmallGauge gauge={row.gauges.planning} />
              </div>
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ margin: "0.7rem 0 0", fontSize: "0.85rem" }}>
        A dial reading <strong>--</strong> has nothing to measure yet, which is not the same as
        zero. The overall dial takes the worst of the three, never the average — a class with one
        real problem is not two-thirds fine.
      </p>
    </section>
  );
}
