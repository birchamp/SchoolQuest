import { useMemo, useState } from "react";
import type { Course, ThemeName } from "@schoolquest/domain";
import {
  buildTerrain,
  DEFAULT_EFFORT_MINUTES,
  type BeaconState,
  type TerrainMarker,
} from "@schoolquest/planning-engine";
import { courseChipFill } from "../lib/course-colour";
import type { PlanResponse } from "../lib/types";

/**
 * The term as ground you can see across.
 *
 * Every other view of the future is a list sorted by date, and a list is read one line at a
 * time — the one thing these students cannot reliably do. Time blindness is not helped by
 * better sorting; it is helped by making time a *distance*, so "that is weeks away" and "that
 * is nearly here" become things the eye reports rather than things the reader computes.
 *
 * Depth is time, lateral position is which course, height is how big the work is, and each
 * beacon's light says whether the plan has made room for it. Two independent channels:
 * **brightness is proximity** (what is on my plate), **hue is whether time is booked** (what
 * needs me). That separation is the point — a paper six weeks out with nothing booked burns
 * on the horizon, which is exactly what a date-sorted list buries at position forty.
 *
 * ## Why SVG and not WebGL
 *
 * A published page here runs under a CSP that blocks every external host, so a 3D library
 * from a CDN is not an option and bundling one is a large dependency for a single view.
 * A hand-rolled perspective projection over SVG gives full control of the one thing that
 * actually matters — that every label stays measurable by the contrast checker — and it
 * degrades honestly: with animation off it is a still picture that says the same thing.
 *
 * ## The rules this shares with every other surface here
 *
 * Colour is never the only signal. Every beacon has a shape as well as a hue, every state
 * ships its word, and the whole landscape has a plain list underneath it carrying the same
 * facts in the same order. Nothing pulses under reduced motion. And nothing here counts or
 * remembers failures: a beacon goes calm the moment time is booked for it.
 */

/**
 * Beacon colours.
 *
 * Both palettes are chosen against the ground the landscape actually paints — a near-black
 * sky in both themes, because a terrain view has its own ground and inherits neither card.
 * Every one of these is above 4.5:1 on that ground, measured, and the label beneath each
 * beacon uses the same value rather than a dimmed version of it.
 */
const BEACON: Record<BeaconState, { fill: string; ink: string; word: string; shape: "flame" | "ring" | "dot" }> = {
  overdue: { fill: "#ff6b4a", ink: "#ffb9a6", word: "Past its date", shape: "flame" },
  needs_time: { fill: "#ff8f3f", ink: "#ffc79a", word: "Needs time booked", shape: "flame" },
  partly_covered: { fill: "#e5c04a", ink: "#f0d998", word: "Partly covered", shape: "ring" },
  covered: { fill: "#5fbf8f", ink: "#a8dcc4", word: "Time booked", shape: "ring" },
  waiting: { fill: "#7f93b8", ink: "#b3c1d8", word: "Not yet", shape: "dot" },
  done: { fill: "#6b6f7a", ink: "#a3a7b2", word: "Finished", shape: "dot" },
};

/** Reading order for the legend and the list: what needs attention first. */
const STATE_ORDER: BeaconState[] = [
  "overdue",
  "needs_time",
  "partly_covered",
  "covered",
  "waiting",
  "done",
];

const VIEW_W = 1000;
const VIEW_H = 560;
/** Where the ground meets the sky. Everything above this is distance. */
const HORIZON_Y = 132;
const FOOT_Y = VIEW_H - 26;

/**
 * The perspective projection.
 *
 * `depth` 0 is at the viewer's feet and 1 is the horizon. Scale falls off with depth so far
 * markers are small and lateral spread narrows toward the vanishing line — the two cues that
 * make a flat picture read as ground rather than as a scatter plot.
 */
function project(depth: number, lateral: number, rise: number) {
  const t = Math.max(0, Math.min(1, depth));
  // Squared falloff: linear looked like a ramp, not a plane.
  const scale = Math.max(0.16, Math.pow(1 - t, 1.35));
  const groundY = FOOT_Y - t * (FOOT_Y - HORIZON_Y);
  const x = VIEW_W / 2 + lateral * (VIEW_W * 0.46) * (0.25 + scale * 0.75);
  // Height lifts the beacon off the ground, foreshortened like everything else.
  const y = groundY - rise * 54 * scale;
  return { x, y, groundY, scale };
}

/**
 * The height of the land at a point, so a beacon can stand on the ground rather than float
 * at the flat plane the ground used to be. Bilinear between the field's samples — nearest
 * neighbour made markers hop as they moved between cells.
 */
function sampleHeight(
  field: { rows: number[][]; depths: number[]; laterals: number[] },
  depth: number,
  lateral: number,
): number {
  const rows = field.rows;
  if (rows.length === 0) return 0;
  // Depths run from 1 (back) down to 0 (front).
  const rowSpan = field.depths.length - 1;
  const rowPos = Math.max(0, Math.min(rowSpan, (1 - depth) * rowSpan));
  const colSpan = field.laterals.length - 1;
  const colPos = Math.max(0, Math.min(colSpan, ((lateral + 1) / 2) * colSpan));

  const r0 = Math.floor(rowPos);
  const r1 = Math.min(rowSpan, r0 + 1);
  const c0 = Math.floor(colPos);
  const c1 = Math.min(colSpan, c0 + 1);
  const fr = rowPos - r0;
  const fc = colPos - c0;

  const top = rows[r0]![c0]! * (1 - fc) + rows[r0]![c1]! * fc;
  const bottom = rows[r1]![c0]! * (1 - fc) + rows[r1]![c1]! * fc;
  return top * (1 - fr) + bottom * fr;
}

/** Must match the lift used when the relief is drawn, or beacons sit off the ground. */
function reliefLift(scale: number): number {
  return 90 * (0.28 + scale * 0.72);
}

function formatDue(iso: string | null, daysAway: number | null): string {
  if (!iso || daysAway === null) return "no date known";
  const when = new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (daysAway < 0) return `${when} · ${Math.abs(daysAway)}d ago`;
  if (daysAway === 0) return `${when} · today`;
  return `${when} · in ${daysAway}d`;
}

export function TerrainMap({
  plan,
  theme,
  reducedMotion,
  selectedCourseId,
}: {
  plan: PlanResponse;
  theme: ThemeName;
  reducedMotion: boolean;
  selectedCourseId?: string | null;
}) {
  const [focused, setFocused] = useState<TerrainMarker | null>(null);
  const coursesById = new Map(plan.courses.map((c) => [c.id, c]));

  // Booked minutes across the whole term, not just this week: a paper's beacon must know
  // about the three hours held for it a fortnight out.
  const booked: Record<string, number> = {};
  for (const s of plan.sessions) {
    booked[s.workItemId] =
      (booked[s.workItemId] ?? 0) +
      Math.max(0, Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000));
  }

  const terrain = buildTerrain({
    workItems: plan.workItems,
    bookedByItem: booked,
    courseIds: plan.courses.map((c) => c.id),
    now: new Date().toISOString(),
    defaultEffortMinutes: DEFAULT_EFFORT_MINUTES,
  });

  /**
   * Only a handful of markers are named on the picture.
   *
   * Labelling everything legible put four copies of "Research paper — full draft" on top of
   * each other and made the middle distance unreadable. The picture's job is to show *where
   * the pressure is*; the names of everything belong in the list underneath, which is one
   * click away and already sorted the same way. The ones that keep their names are the ones
   * a student would ask about first.
   */
  const URGENCY: Record<BeaconState, number> = {
    overdue: 0,
    needs_time: 1,
    partly_covered: 2,
    covered: 3,
    waiting: 4,
    done: 5,
  };
  // Urgency picks the candidates; space decides which of them actually get named. Sorting by
  // urgency alone named nine overdue markers that all sit at the viewer's feet, so all nine
  // labels landed in one band and overlapped into mush. A label that cannot be read is worse
  // than no label, because it also hides the ones that could be.
  const named = new Set<string>();
  const placed: { x: number; y: number }[] = [];
  for (const m of [...terrain.markers].sort(
    (a, b) => URGENCY[a.state] - URGENCY[b.state] || (a.daysAway ?? 0) - (b.daysAway ?? 0),
  )) {
    if (named.size >= 9) break;
    const { x, y } = project(m.depth, m.lateral, m.rise);
    if (placed.some((p) => Math.abs(p.x - x) < 240 && Math.abs(p.y - y) < 26)) continue;
    named.add(m.workItemId);
    placed.push({ x, y });
  }

  const lit = terrain.counts.overdue + terrain.counts.needs_time;
  const attention = [...terrain.markers]
    .filter((m) => m.state === "overdue" || m.state === "needs_time" || m.state === "partly_covered")
    .sort((a, b) => (a.daysAway ?? 0) - (b.daysAway ?? 0));

  return (
    <section className="card" aria-labelledby="terrain-heading">
      <h2 id="terrain-heading">
        <span aria-hidden="true">{theme === "quest" ? "The road ahead" : "The term ahead"}</span>
        <span className="sr-only">The term ahead</span>
      </h2>

      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
        Your whole term, laid out as ground. Near is soon, far is weeks away, and taller means
        bigger. A beacon burns when nothing has been set aside for the work yet — however far
        off it is.
      </p>

      <div className="terrain-frame">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={
            lit === 0
              ? `${terrain.markers.length} pieces of work ahead, none of them waiting on time from you.`
              : `${terrain.markers.length} pieces of work ahead. ${lit} need time booked.`
          }
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <defs>
            <radialGradient id="terrain-sky" cx="50%" cy="72%" r="78%">
              <stop offset="0%" stopColor="#2b3550" />
              <stop offset="55%" stopColor="#161c2c" />
              <stop offset="100%" stopColor="#0b0e18" />
            </radialGradient>
            <linearGradient id="terrain-ground" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1b2233" />
              <stop offset="100%" stopColor="#0d111b" />
            </linearGradient>
            <radialGradient id="terrain-fire" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffd9a0" stopOpacity="0.85" />
              <stop offset="45%" stopColor="#ff9a4d" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ff7a2f" stopOpacity="0" />
            </radialGradient>
            {STATE_ORDER.map((state) => (
              <radialGradient key={state} id={`halo-${state}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={BEACON[state].fill} stopOpacity="0.75" />
                <stop offset="60%" stopColor={BEACON[state].fill} stopOpacity="0.18" />
                <stop offset="100%" stopColor={BEACON[state].fill} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>

          <rect width={VIEW_W} height={HORIZON_Y} fill="url(#terrain-sky)" />
          <rect y={HORIZON_Y} width={VIEW_W} height={VIEW_H - HORIZON_Y} fill="url(#terrain-ground)" />

          {/* The land, raised by the work that falls on it. */}
          <Relief field={terrain.field} />

          {/* Week gridlines receding to the vanishing point — the scale that turns a pretty
              picture into a readable one. Without them "far" has no unit. */}
          <WeekLines horizonDays={terrain.horizonDays} />

          {/* The fire the student is standing at: now. */}
          <ellipse cx={VIEW_W / 2} cy={FOOT_Y - 4} rx={190} ry={54} fill="url(#terrain-fire)" />
          <g aria-hidden="true">
            <ellipse cx={VIEW_W / 2} cy={FOOT_Y - 2} rx={16} ry={5} fill="#3a2415" />
            <path
              d={`M${VIEW_W / 2} ${FOOT_Y - 26} q9 10 4 18 q-4 6 -4 6 q0 0 -4 -6 q-5 -8 4 -18 z`}
              fill="#ffb347"
              className={reducedMotion ? undefined : "terrain-flicker"}
            />
          </g>
          <text
            x={VIEW_W / 2}
            y={FOOT_Y + 18}
            textAnchor="middle"
            fill="#cbd3e4"
            fontSize={13}
            fontWeight={600}
          >
            Today
          </text>

          {/* What is past the drawn ground, stated rather than crammed in. */}
          {terrain.beyond.length > 0 && (
            <text
              x={VIEW_W / 2}
              y={HORIZON_Y - 14}
              textAnchor="middle"
              fill="#8f9ab5"
              fontSize={12}
            >
              {terrain.beyond.length} more beyond {Math.round(terrain.horizonDays / 7)} weeks
            </text>
          )}

          {/* Markers, far first so near ones sit on top. */}
          {terrain.markers.map((m) => (
            <Beacon
              key={m.workItemId}
              marker={m}
              surface={sampleHeight(terrain.field, m.depth, m.lateral)}
              course={coursesById.get(m.courseId)}
              named={named.has(m.workItemId)}
              reducedMotion={reducedMotion}
              receded={Boolean(selectedCourseId) && m.courseId !== selectedCourseId}
              onFocus={() => setFocused(m)}
            />
          ))}
        </svg>
      </div>

      {/* The legend is the key to the hues, and it states counts so the picture can be
          checked against a number. */}
      <ul className="terrain-legend">
        {STATE_ORDER.filter((s) => terrain.counts[s] > 0).map((state) => (
          <li key={state}>
            <span aria-hidden="true" className="terrain-swatch" style={{ background: BEACON[state].fill }} />
            {BEACON[state].word} · {terrain.counts[state]}
          </li>
        ))}
      </ul>

      {focused && (
        <p className="terrain-focus" role="status">
          <strong>{focused.title}</strong>{" "}
          <span className="muted">
            {coursesById.get(focused.courseId)?.code ?? coursesById.get(focused.courseId)?.name} ·{" "}
            {formatDue(focused.dueAt, focused.daysAway)}
          </span>
          <br />
          {focused.detail}
        </p>
      )}

      {/* The same facts as a list, in the same order. The picture is the fast path, not the
          only path — and a landscape nobody can read with a screen reader is decoration. */}
      <details style={{ marginTop: "0.6rem" }}>
        <summary style={{ cursor: "pointer", padding: "0.25rem 0" }}>
          {attention.length > 0
            ? `${attention.length} ${attention.length === 1 ? "thing is" : "things are"} lit — read them as a list`
            : "Nothing is lit. Read the whole term as a list"}
        </summary>
        <ul className="alternatives" style={{ marginTop: "0.3rem" }}>
          {(attention.length > 0 ? attention : terrain.markers.slice(0, 20)).map((m) => (
            <li key={m.workItemId} style={{ display: "block", padding: "0.4rem 0" }}>
              <span
                aria-hidden="true"
                className="terrain-swatch"
                style={{ background: BEACON[m.state].fill }}
              />
              <strong>{m.title}</strong>{" "}
              <span className="muted">
                {coursesById.get(m.courseId)?.code ?? ""} · {formatDue(m.dueAt, m.daysAway)}
              </span>
              <span className="muted" style={{ display: "block", fontSize: "0.84rem" }}>
                {m.detail}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {terrain.beyond.length > 0 && (
        <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.84rem" }}>
          {terrain.beyond.length} more{" "}
          {terrain.beyond.length === 1 ? "piece of work is" : "pieces of work are"} further out
          than {Math.round(terrain.horizonDays / 7)} weeks. They are counted in the legend and
          listed in full under the table view — the ground stops where the next two months do,
          because a picture that fits a whole term leaves no room to read the part you can act
          on.
        </p>
      )}

      {terrain.undated.length > 0 && (
        <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.84rem" }}>
          {terrain.undated.length} more{" "}
          {terrain.undated.length === 1 ? "piece of work has" : "pieces of work have"} no date
          known, so nothing can place them in time. They are listed under Setup.
        </p>
      )}
    </section>
  );
}

/** Canvas pixels between samples along a ridgeline. Small enough that the land reads smooth. */
const RELIEF_STEP = 6;
/** Roughly how much of each row survives in front of the row behind it, in canvas pixels. */
const ROW_SLIVER = 30;

/**
 * The relief, drawn back to front.
 *
 * Two earlier attempts are worth recording, because both failed in instructive ways.
 *
 * The first drew each row as one ridgeline filled flat down to the bottom of the canvas.
 * Every near row's fill then covered the whole of every row behind it, so all that survived
 * of the land was the thin stroke along each crest — twenty-six near-identical tints differ
 * by about one step per channel — and it read as contour lines ruled across a flat floor,
 * which is exactly what it was.
 *
 * The second replaced the strips with a slope-shaded quad mesh. That produced real mass but
 * SVG has no Gouraud shading, so every quad was flat: at any resolution cheap enough to
 * render, the landscape looked built out of blocks. It was also too pale, and washed out the
 * beacons it exists to sit beneath.
 *
 * What works is strips again, but with each one filled by a vertical gradient anchored to
 * its own crest: bright along the ridge, falling into shadow down the flank. That is how a
 * raised-relief map reads — the eye takes a lit edge above a dark face as a rise — and it
 * costs one path and one gradient per row, stays smooth because the crest is a dense
 * polyline rather than a grid, and keeps the ground dark so the beacons stay the brightest
 * things in the picture.
 *
 * Rows span the whole frame, not the perspective half-width. Drawing them only as wide as
 * the marker lanes turned the landscape into a stepped ziggurat with hard vertical edges,
 * because each row was wider than the one behind it and every step showed. Ground extends
 * past the edge of a picture; only the *content* converges. So each row walks x across the
 * full canvas and converts back to a lateral position through the same projection the
 * markers use — which keeps the hill under a beacon the hill the beacon is standing on.
 */
function Relief({ field }: { field: { rows: number[][]; depths: number[]; laterals: number[] } }) {
  const bands = useMemo(
    () =>
      field.depths.map((depth, i) => {
        const { groundY, scale } = project(depth, 0, 0);
        const half = VIEW_W * 0.46 * (0.25 + scale * 0.75);
        const lift = reliefLift(scale);

        const points: string[] = [];
        let crestY = Number.POSITIVE_INFINITY;
        let sum = 0;
        let n = 0;
        for (let x = 0; x <= VIEW_W; x += RELIEF_STEP) {
          const lateral = Math.max(-1, Math.min(1, (x - VIEW_W / 2) / half));
          const h = sampleHeight(field, depth, lateral);
          const y = groundY - h * lift;
          if (y < crestY) crestY = y;
          sum += h;
          n += 1;
          points.push(`${x} ${y.toFixed(1)}`);
        }

        // Aerial perspective, and a brighter rim on ground that is actually raised — a ridge
        // catches light, flat ground does not.
        const near = 1 - depth;
        const relief = n > 0 ? sum / n : 0;
        const lit = 0.34 + near * 0.3 + Math.min(0.36, relief * 0.7);
        return {
          id: `sq-relief-${i}`,
          depth,
          path: `M0 ${VIEW_H} L${points.join(" L")} L${VIEW_W} ${VIEW_H} Z`,
          crest: `M${points.join(" L")}`,
          crestY,
          // The flank has to reach shadow within the sliver of itself that stays visible —
          // only the strip between this crest and the next row's crest is ever seen, about
          // fifteen pixels. A gradient run over the full height of the ridge spends all of
          // it in the light stop, and the whole landscape comes out one flat brightness.
          shadowY: crestY + ROW_SLIVER + lift * 0.16,
          lit,
        };
      }),
    [field],
  );

  return (
    <g aria-hidden="true">
      <defs>
        {bands.map((b) => (
          <linearGradient
            key={b.id}
            id={b.id}
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={b.crestY}
            x2={0}
            y2={b.shadowY}
          >
            <stop offset="0" stopColor={`rgb(${Math.round(46 + b.lit * 78)}, ${Math.round(58 + b.lit * 88)}, ${Math.round(84 + b.lit * 108)})`} />
            <stop offset="1" stopColor={`rgb(${Math.round(11 + b.depth * 14)}, ${Math.round(15 + b.depth * 18)}, ${Math.round(24 + b.depth * 28)})`} />
          </linearGradient>
        ))}
      </defs>
      {bands.map((b) => (
        <g key={b.id}>
          <path d={b.path} fill={`url(#${b.id})`} />
          {/* The lit crest itself. Half a pixel of light is what separates one ridge from the
              ridge behind it once the gradients have gone dark. */}
          <path
            d={b.crest}
            fill="none"
            stroke={`rgba(176, 198, 240, ${(0.1 + (1 - b.depth) * 0.2).toFixed(2)})`}
            strokeWidth={1}
          />
        </g>
      ))}
    </g>
  );
}

/** Week markers receding toward the horizon, so distance has a unit. */
function WeekLines({ horizonDays }: { horizonDays: number }) {
  const step = horizonDays > 70 ? 28 : horizonDays > 35 ? 14 : 7;
  const lines: { days: number; depth: number }[] = [];
  for (let d = step; d < horizonDays; d += step) {
    lines.push({ days: d, depth: Math.pow(d / horizonDays, 0.6) });
  }
  return (
    <g aria-hidden="true">
      {lines.map(({ days, depth }) => {
        const { groundY, scale } = project(depth, 0, 0);
        const half = VIEW_W * 0.46 * (0.25 + scale * 0.75);
        return (
          <g key={days}>
            <line
              x1={VIEW_W / 2 - half}
              y1={groundY}
              x2={VIEW_W / 2 + half}
              y2={groundY}
              stroke="#4a5570"
              strokeWidth={1}
              strokeDasharray="3 7"
              opacity={0.55}
            />
            <text x={VIEW_W / 2 + half + 8} y={groundY + 4} fill="#9aa6c0" fontSize={11}>
              {days >= 28 ? `${Math.round(days / 7)}w` : `${days}d`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Beacon({
  marker,
  course,
  surface,
  named,
  reducedMotion,
  receded,
  onFocus,
}: {
  marker: TerrainMarker;
  course: Course | undefined;
  /** Height of the land under it, 0..1. */
  surface: number;
  named: boolean;
  reducedMotion: boolean;
  receded: boolean;
  onFocus: () => void;
}) {
  const raw = project(marker.depth, marker.lateral, marker.rise);
  const { x, scale } = raw;
  // Stand on the land, not on the plane it used to be.
  const groundY = raw.groundY - surface * reliefLift(scale);
  const y = raw.y - surface * reliefLift(scale);
  const look = BEACON[marker.state];
  const size = Math.max(3.2, 8 * scale + marker.rise * 5 * scale);
  const halo = size * (3.2 + marker.glow * 3.4);
  // The named states are the ones worth burning for; everything else sits quiet whatever
  // its distance, so the lit markers are never competing with forty calm ones.
  const burning = marker.state === "overdue" || marker.state === "needs_time";
  const label = named;
  // Course code beside the title: five courses can carry the same assignment name, and four
  // copies of "Research paper" stacked on each other name nothing at all.
  const code = course?.code ?? course?.name ?? "";

  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={`${marker.title}. ${look.word}. ${marker.detail}`}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      opacity={receded ? 0.32 : 1}
      style={{ cursor: "pointer" }}
    >
      {/* The stake it stands on, so a raised beacon reads as height rather than as float. */}
      {marker.rise > 0.2 && (
        <line x1={x} y1={groundY} x2={x} y2={y} stroke={look.fill} strokeWidth={0.8} opacity={0.4} />
      )}
      <circle
        cx={x}
        cy={y}
        r={halo}
        fill={`url(#halo-${marker.state})`}
        opacity={0.35 + marker.glow * 0.65}
        className={reducedMotion || !burning ? undefined : "terrain-pulse"}
      />
      {look.shape === "flame" ? (
        <path
          d={`M${x} ${y - size * 1.7} q${size} ${size * 1.1} ${size * 0.45} ${size * 1.9} q-${size * 0.45} ${size * 0.7} -${size * 0.45} ${size * 0.7} q0 0 -${size * 0.45} -${size * 0.7} q-${size * 0.55} -${size * 0.8} ${size * 0.45} -${size * 1.9} z`}
          fill={look.fill}
        />
      ) : look.shape === "ring" ? (
        <circle cx={x} cy={y} r={size} fill="none" stroke={look.fill} strokeWidth={Math.max(1.4, size * 0.42)} />
      ) : (
        <circle cx={x} cy={y} r={size * 0.72} fill={look.fill} />
      )}
      {/* The course's own colour, as a chip on the ground beneath — so a lit beacon says
          which class it belongs to without needing the label. */}
      {course && scale > 0.4 && (
        <rect
          x={x - 3}
          y={groundY - 1.5}
          width={6}
          height={3}
          rx={1}
          fill={courseChipFill(course.id, course.colorToken)}
          opacity={0.9}
        />
      )}
      {label && (
        <text
          // Labels near the frame edge anchor inward, or they run off it — the rightmost
          // one lost its course code entirely.
          x={x}
          y={y - size * 2.1 - 4}
          textAnchor={x < VIEW_W * 0.18 ? "start" : x > VIEW_W * 0.82 ? "end" : "middle"}
          fill={look.ink}
          fontSize={Math.max(10, 13 * scale)}
          fontWeight={burning ? 700 : 500}
        >
          {marker.title.length > 22 ? `${marker.title.slice(0, 21)}…` : marker.title}
          {code && <tspan opacity={1}> · {code}</tspan>}
        </text>
      )}
    </g>
  );
}
