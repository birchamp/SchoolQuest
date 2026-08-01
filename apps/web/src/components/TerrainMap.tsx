import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Course, ThemeName } from "@schoolquest/domain";
import {
  buildTerrain,
  DEFAULT_EFFORT_MINUTES,
  type BeaconState,
  type HeightField,
  type TerrainMarker,
} from "@schoolquest/planning-engine";
import { courseChipFill } from "../lib/course-colour";
import type { PlanResponse } from "../lib/types";

/**
 * The next four weeks as a raised-relief model of the term.
 *
 * Every other view of the future is a list sorted by date, and a list is read one line at a
 * time — the one thing these students cannot reliably do. Time blindness is not helped by
 * better sorting; it is helped by making time a *distance*, so "that is weeks away" and "that
 * is nearly here" become things the eye reports rather than things the reader computes.
 *
 * Time runs away from the near edge, lateral position is which course, height is how much work
 * is due around there, and each beacon's light says whether the plan has made room for it. Two
 * independent channels: **brightness is proximity** (what is on my plate), **hue is whether
 * time is booked** (what needs me). That separation is the point — a paper six weeks out with
 * nothing booked burns in the distance, which is exactly what a date-sorted list buries at
 * position forty.
 *
 * ## Why the camera moved
 *
 * The first version stood the student on the ground and looked toward a horizon. That camera
 * spends its pixels in inverse proportion to how much they matter: near days get the whole
 * lower half of the frame and everything past a fortnight piles into an illegible band at the
 * back. Seen from above as a tilted slab, distance is free — day 27 gets as much room as day 2
 * — so time can be linear, a week is always a quarter of the ground, and the scale can be
 * trusted between visits.
 *
 * ## Ground for four weeks, distance for the rest
 *
 * Only the four weeks the plan is actually about get modelled ground. Work further out gets a
 * faint mark in the distance above the far edge: it is real, it is placed in time, and it is
 * deliberately not drawn with a precision the plan does not have that far out. The exception
 * is the one that matters — distant work with no time booked still burns, because that is the
 * single case where something far away needs a decision today.
 *
 * ## Why a canvas for the ground and SVG for everything else
 *
 * A published page here runs under a CSP that blocks every external host, so a 3D library from
 * a CDN is not an option and bundling one is a large dependency for one view. Hillshading is
 * per-pixel work and SVG has no way to express it — a shaded polygon mesh at any resolution
 * cheap enough to draw looks built out of blocks. Canvas does exactly this job. Everything that
 * carries meaning — beacons, labels, the list underneath — stays SVG and DOM, so it stays
 * focusable, readable by a screen reader, and measurable by the contrast checker. The canvas is
 * `aria-hidden`: it is the shape of the workload, and every fact it shows is also stated.
 *
 * ## The rules this shares with every other surface here
 *
 * Colour is never the only signal. Every beacon has a shape as well as a hue, every state ships
 * its word, and the whole landscape has a plain list underneath carrying the same facts in the
 * same order. Nothing pulses under reduced motion. And nothing here counts or remembers
 * failures: a beacon goes calm the moment time is booked for it.
 */

/**
 * Beacon colours.
 *
 * Both palettes are chosen against the ground the landscape actually paints — a near-black sky
 * in both themes, because a terrain view has its own ground and inherits neither card. Every
 * one of these is above 4.5:1 on that ground, measured, and the label beneath each beacon uses
 * the same value rather than a dimmed version of it.
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
const VIEW_H = 580;

/**
 * The oblique projection: an axonometric slab, the way a physical relief model sits on a table.
 *
 * `u` is lateral (-1 left to 1 right, which course), `v` is time (0 at the near edge = today,
 * 1 at the far edge = four weeks out), `h` is height (0..1 of the workload relief). There is no
 * perspective divide, deliberately: parallel projection is what keeps a week the same size
 * wherever it falls, which is the entire reason for looking down instead of across.
 */
const ORIGIN = { x: 500, y: 462 };
const AXIS_U = { x: 408, y: 46 };
const AXIS_V = { x: -82, y: -238 };
/**
 * How far a full-height ridge lifts off the base plane.
 *
 * Generous on purpose. Tuned to the real semester rather than to a fixture: at half this the
 * busiest fortnight of a five-course term was a swell you had to be told about, which defeats
 * the one thing the view is for.
 */
const RISE = 168;
/** Thickness of the model's base, which is what makes it read as an object on a table. */
const SLAB_DEPTH = 30;

function plot(u: number, v: number, h: number) {
  return {
    x: ORIGIN.x + u * AXIS_U.x + v * AXIS_V.x,
    y: ORIGIN.y + u * AXIS_U.y + v * AXIS_V.y - h * RISE,
  };
}

/** Where the distance band sits: past the far edge, continuing the same axis into the sky. */
const DISTANCE_NEAR_V = 1.2;
const DISTANCE_FAR_V = 1.78;
/** The distance band is narrower than the slab, or its left end walks off the frame. */
const DISTANCE_SPREAD = 0.8;

function plotDistant(u: number, depth: number) {
  return plot(u * DISTANCE_SPREAD, DISTANCE_NEAR_V + depth * (DISTANCE_FAR_V - DISTANCE_NEAR_V), 0);
}

/**
 * Quintic ease, flat in slope at both ends.
 *
 * Used for every interpolation the surface is lit from. Anything with a discontinuous derivative
 * shows up as a crease once a light is put on it, and this shape is the standard fix — it is why
 * Perlin replaced his own cubic smoothstep with it.
 */
function ease(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * The height of the land at a point. Bilinear between the field's samples — nearest neighbour
 * made markers hop as they crossed a cell boundary.
 */
function sampleHeight(field: HeightField, depth: number, lateral: number): number {
  const rows = field.rows;
  if (rows.length === 0) return 0;
  // Depths run from 1 (far edge) down to 0 (near edge).
  const rowSpan = field.depths.length - 1;
  const rowPos = Math.max(0, Math.min(rowSpan, (1 - depth) * rowSpan));
  const colSpan = field.laterals.length - 1;
  const colPos = Math.max(0, Math.min(colSpan, ((lateral + 1) / 2) * colSpan));

  const r0 = Math.floor(rowPos);
  const r1 = Math.min(rowSpan, r0 + 1);
  const c0 = Math.floor(colPos);
  const c1 = Math.min(colSpan, c0 + 1);
  // Eased fractions, not raw ones. Plain bilinear is continuous in value but not in slope across
  // a cell boundary, and hillshading reads slope — so the field's own 26×49 grid printed itself
  // over the model as a lattice of flat facets with hard creases between them. Easing the
  // fractions costs two multiplies and makes the surface smooth enough to light.
  const fr = ease(rowPos - r0);
  const fc = ease(colPos - c0);

  const top = rows[r0]![c0]! * (1 - fc) + rows[r0]![c1]! * fc;
  const bottom = rows[r1]![c0]! * (1 - fc) + rows[r1]![c1]! * fc;
  return top * (1 - fr) + bottom * fr;
}

/**
 * Deterministic value noise. Hashed from the coordinates, so the same term draws the same
 * landscape every time — this codebase has no `Math.random` anywhere by design.
 */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  // Quintic, not cubic smoothstep: cubic leaves a slope discontinuity at every lattice
  // boundary, and hillshading is computed from slope, so each one showed up as a hard crease.
  const u = ease(xf);
  const v = ease(yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Fine ruggedness, so a hillside has the texture of a hillside rather than the smoothness of a
 * blancmange.
 *
 * The first version multiplied two sine waves, which is not noise at all: products of sines
 * tile, and the model came out under a regular criss-cross waffle that read as fabric rather
 * than rock. Stacked octaves of value noise at incommensurate frequencies have no visible
 * period, which is the whole difference between texture and pattern.
 *
 * Returns roughly -0.5..0.5.
 */
function ruggedness(u: number, v: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o += 1) {
    sum += valueNoise(u * freq, v * freq) * amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum - 0.47;
}

/**
 * The modelled surface at a point: the workload relief, roughened in proportion to itself.
 *
 * Scaling the roughness by the height under it is what keeps this honest — heavy ground breaks
 * up into rock while empty ground stays a smooth plain, so "rugged" is a second reading of
 * "loaded" rather than decoration laid over the top. It can never raise a plain into a hill.
 */
function surfaceAt(field: HeightField, u: number, v: number): number {
  const base = sampleHeight(field, v, u);
  // Landform-scale, not grain-scale: a handful of noise cells across the whole month. Higher
  // frequencies made the model look dusted rather than eroded, because the surface normal
  // ended up driven by the texture instead of by the workload underneath it.
  const rough = ruggedness(u * 3.1 + 11.2, v * 4.3 + 4.7);
  // Strong enough that a heavy fortnight breaks into peaks and saddles rather than swelling
  // as one smooth mound. Because it scales the workload rather than adding to it, dialling it
  // up makes loaded ground more mountainous and leaves empty ground exactly as flat.
  //
  // Tapered by the same curve that hazes the ground away, so the land settles into the
  // distance instead of being cut off by it. The haze is a screen-space gradient, and a peak
  // standing near the far edge rises straight through it — which left a hard lit corner
  // hanging in the sky, the exact edge the fade exists to get rid of. Understating a ridge at
  // week four costs nothing, because that ridge is on its way to invisible anyway.
  return Math.max(0, base * (1 + rough * 0.95) * groundOpacity(v));
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

  /**
   * Which classes are drawn. One layer each, any combination, all on to start.
   *
   * The reason this is a set of toggles rather than a one-class-at-a-time picker is the thing
   * the whole view exists for: **time is the shared resource.** If BIO's work lived on BIO's own
   * map, nothing would ever show that Wednesday is already full of HIS, and cross-course triage
   * is the actual problem. Layers keep one piece of ground and let you decide what stands on it.
   */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // Selecting a course elsewhere — a row in the campaign roster — solos that layer here, so the
  // two controls mean the same thing rather than fighting over the same picture.
  useEffect(() => {
    setHidden(
      selectedCourseId
        ? new Set(plan.courses.map((c) => c.id).filter((id) => id !== selectedCourseId))
        : new Set(),
    );
  }, [selectedCourseId, plan.courses]);

  const visible = (courseId: string) => !hidden.has(courseId);
  const shownItems = plan.workItems.filter((w) => visible(w.courseId));

  // Booked minutes across the whole term, not just this week: a paper's beacon must know about
  // the three hours held for it a fortnight out.
  const booked: Record<string, number> = {};
  for (const s of plan.sessions) {
    booked[s.workItemId] =
      (booked[s.workItemId] ?? 0) +
      Math.max(0, Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000));
  }

  const terrain = buildTerrain({
    workItems: shownItems,
    bookedByItem: booked,
    // Every course, always — lanes are assigned from this list, and passing only the visible
    // ones would slide the remaining classes sideways every time a layer was switched. A layer
    // toggle that moves the other layers is not a layer toggle.
    courseIds: plan.courses.map((c) => c.id),
    now: new Date().toISOString(),
    defaultEffortMinutes: DEFAULT_EFFORT_MINUTES,
  });

  /**
   * Only a handful of markers are named on the picture.
   *
   * Labelling everything legible put four copies of "Research paper — full draft" on top of
   * each other and made the middle distance unreadable. The picture's job is to show *where the
   * pressure is*; the names of everything belong in the list underneath, which is one click
   * away and already sorted the same way. The ones that keep their names are the ones a student
   * would ask about first.
   */
  const URGENCY: Record<BeaconState, number> = {
    overdue: 0,
    needs_time: 1,
    partly_covered: 2,
    covered: 3,
    waiting: 4,
    done: 5,
  };
  // Beacons and their labels are laid out once and drawn in two passes, because a label is
  // not part of the beacon it belongs to as far as painting order goes: with labels drawn
  // inside each beacon's group, a beacon rendered later painted its flame straight over an
  // earlier beacon's label. Measured against real pixels that came out at 1.7:1.
  const onGround = terrain.markers.map((m) => ({
    marker: m,
    at: plot(m.lateral, m.depth, surfaceAt(terrain.field, m.lateral, m.depth)),
    // A parallel projection does not shrink things with distance, so a far beacon stays as
    // legible as a near one. A little falloff keeps the depth cue without giving any of it back.
    scale: 0.82 + (1 - m.depth) * 0.18,
    haze: groundOpacity(m.depth),
  }));
  const inDistance = terrain.distant.map((m) => ({
    marker: m,
    at: plotDistant(m.lateral, m.depth),
    scale: 0.62,
    haze: 1,
  }));

  /** Where a marker's label actually lands, which is the only position worth testing. */
  const labelAt = (e: { marker: TerrainMarker; at: { x: number; y: number }; scale: number }) => {
    const { x, y, size } = beaconShape(e.marker, e.at, e.scale);
    return { x, y: y - size * 2.1 - 4 };
  };

  // Urgency picks the candidates; space decides which of them actually get named. Sorting by
  // urgency alone named nine overdue markers that all sit at the near edge, so all nine labels
  // landed in one band and overlapped into mush. A label that cannot be read is worse than no
  // label, because it also hides the ones that could be.
  //
  // The test runs on the *label* position, not the marker's spot on the flat ground. It used to
  // use the latter, which is a different point once the beacon is standing on a hill and holding
  // its label above its own head — so the check would clear two labels that then landed twenty
  // pixels apart and overlapped anyway.
  const named = new Set<string>();
  const placed: { x: number; y: number }[] = [];
  for (const e of [...onGround, ...inDistance].sort(
    (a, b) =>
      URGENCY[a.marker.state] - URGENCY[b.marker.state] ||
      (a.marker.daysAway ?? 0) - (b.marker.daysAway ?? 0),
  )) {
    if (named.size >= 8) break;
    const { x, y } = labelAt(e);
    if (placed.some((p) => Math.abs(p.x - x) < 230 && Math.abs(p.y - y) < 26)) continue;
    named.add(e.marker.workItemId);
    placed.push({ x, y });
  }

  const onMap = terrain.markers.length + terrain.distant.length;
  const lit = terrain.counts.overdue + terrain.counts.needs_time;
  const attention = [...terrain.markers, ...terrain.distant]
    .filter((m) => m.state === "overdue" || m.state === "needs_time" || m.state === "partly_covered")
    .sort((a, b) => (a.daysAway ?? 0) - (b.daysAway ?? 0));
  const weeks = Math.round(terrain.focusDays / 7);

  /**
   * One layer per class, each carrying that class's own severity.
   *
   * The severity is deliberately drawn from `plan.health` — the same course-health engine the
   * dashboard reads — and not from what happens to be on the map. A class can be in trouble for
   * reasons this picture cannot show: a grade below target, a marked assignment never recorded,
   * a grading scheme that does not add up. A class chip that only counted lit beacons would go
   * calm on exactly those cases.
   *
   * They keep their severity **while switched off**, which is the point of putting them here.
   * Turning HIS off has to stop HIS crowding the ground without also making you forget HIS is on
   * fire, or hiding a layer becomes a way to lose a class.
   */
  const healthByCourse = new Map((plan.health?.courses ?? []).map((c) => [c.courseId, c]));
  const layers = plan.courses.map((course) => {
    const mine = [...terrain.markers, ...terrain.distant].filter((m) => m.courseId === course.id);
    return {
      course,
      on: visible(course.id),
      level: healthByCourse.get(course.id)?.level ?? "steady",
      concern: healthByCourse.get(course.id)?.concerns[0]?.detail ?? null,
      lit: mine.filter((m) => m.state === "overdue" || m.state === "needs_time").length,
    };
  });
  const hiddenLayers = layers.filter((l) => !l.on);

  return (
    <section className="card" aria-labelledby="terrain-heading">
      <h2 id="terrain-heading">
        <span aria-hidden="true">{theme === "quest" ? "The road ahead" : "The term ahead"}</span>
        <span className="sr-only">The term ahead</span>
      </h2>

      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
        The next {weeks} weeks as ground: near is soon, far is the end of the month, and the
        land rises where the work piles up. Further out sits in the distance, dim because it can
        wait — unless nothing has been set aside for it, in which case it burns anyway.
      </p>

      <LayerBar
        layers={layers}
        theme={theme}
        onToggle={(courseId) =>
          setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(courseId)) next.delete(courseId);
            else next.add(courseId);
            return next;
          })
        }
        onOnly={(courseId) =>
          setHidden(new Set(plan.courses.map((c) => c.id).filter((id) => id !== courseId)))
        }
        onAll={() => setHidden(new Set())}
      />

      <div className="terrain-frame terrain-frame-model">
        <Relief field={terrain.field} />
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={
            lit === 0
              ? `${onMap} pieces of work ahead, none of them waiting on time from you.`
              : `${onMap} pieces of work ahead. ${lit} need time booked.`
          }
          style={{ width: "100%", height: "auto", display: "block", position: "relative" }}
        >
          <defs>
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

          {/* What is out past the ground: placed, but not modelled. */}
          <DistanceBand
            markers={terrain.distant}
            focusDays={terrain.focusDays}
            horizonDays={terrain.horizonDays}
            beyond={terrain.beyond.length}
          />

          {/* Week rules along the right edge of the slab, so distance has a unit. */}
          <WeekEdge focusDays={terrain.focusDays} field={terrain.field} />

          {/* The fire the student is standing at: now, just off the near edge. */}
          <Today reducedMotion={reducedMotion} />

          {/* Distant markers first, then the ground, so near work sits on top of far work. */}
          {[...inDistance, ...onGround].map(({ marker, at, scale, haze }) => (
            <Beacon
              key={marker.workItemId}
              marker={marker}
              at={at}
              scale={scale}
              haze={haze}
              course={coursesById.get(marker.courseId)}
              reducedMotion={reducedMotion}
              onFocus={() => setFocused(marker)}
            />
          ))}

          {/* Every label above every beacon, so nothing can be painted over a name. */}
          {[...inDistance, ...onGround]
            .filter(({ marker }) => named.has(marker.workItemId))
            .map(({ marker, at, scale }) => {
              const code = coursesById.get(marker.courseId)?.code ?? coursesById.get(marker.courseId)?.name ?? "";
              const { x, y, size, burning } = beaconShape(marker, at, scale);
              return (
                <PlatedLabel
                  key={marker.workItemId}
                  // Labels near the frame edge anchor inward, or they run off it — the
                  // rightmost one lost its course code entirely.
                  x={x}
                  y={y - size * 2.1 - 4}
                  anchor={x < VIEW_W * 0.18 ? "start" : x > VIEW_W * 0.82 ? "end" : "middle"}
                  fill={BEACON[marker.state].ink}
                  fontSize={Math.max(10, 13 * scale)}
                  fontWeight={burning ? 700 : 500}
                  text={`${marker.title.length > 22 ? `${marker.title.slice(0, 21)}…` : marker.title}${code ? ` · ${code}` : ""}`}
                />
              );
            })}
        </svg>
      </div>

      {hiddenLayers.length > 0 && (
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.84rem" }}>
          {hiddenLayers.length === 1 ? "One class is" : `${hiddenLayers.length} classes are`} switched
          off:{" "}
          {hiddenLayers.map((l) => l.course.code ?? l.course.name).join(", ")}. The ground and the
          counts below are only what is switched on.
        </p>
      )}

      {/* The legend is the key to the hues, and it states counts so the picture can be checked
          against a number. */}
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

      {/* The same facts as a list, in the same order. The picture is the fast path, not the only
          path — and a landscape nobody can read with a screen reader is decoration. */}
      <details style={{ marginTop: "0.6rem" }}>
        <summary style={{ cursor: "pointer", padding: "0.25rem 0" }}>
          {attention.length > 0
            ? `${attention.length} ${attention.length === 1 ? "thing is" : "things are"} lit — read them as a list`
            : "Nothing is lit. Read the whole term as a list"}
        </summary>
        <ul className="alternatives" style={{ marginTop: "0.3rem" }}>
          {(attention.length > 0 ? attention : [...terrain.markers, ...terrain.distant].slice(0, 20)).map((m) => (
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
          listed in full under the table view.
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

/** Quest's parchment values, measured on that card. See `Dashboard.tsx` for why they differ. */
const QUEST_INK_DIM = "#5b4930";
const QUEST_WAX = "#8c2f28";
const QUEST_GOLD_DIM = "#6f5200";

/**
 * The severity a class is carrying, in the same language the dashboard uses.
 *
 * Quest repaints the ground under this card, so it needs its own values — `--at-risk` on
 * parchment measured 1.99:1 the last time a component assumed otherwise. The rule this keeps
 * failing to be obvious: a theme that repaints the ground has to repaint every token that means
 * "text on the ground", every time.
 */
function levelColour(level: string, quest: boolean): string {
  if (!quest) {
    return level === "at_risk"
      ? "var(--at-risk)"
      : level === "needs_attention"
        ? "var(--watch)"
        : "var(--text-dim)";
  }
  return level === "at_risk" ? QUEST_WAX : level === "needs_attention" ? QUEST_GOLD_DIM : QUEST_INK_DIM;
}

/** Never colour alone: every severity ships a mark and a word as well as a hue. */
const LEVEL_MARK: Record<string, { glyph: string; word: string }> = {
  at_risk: { glyph: "▲", word: "needs a decision" },
  needs_attention: { glyph: "●", word: "needs attention" },
  steady: { glyph: "·", word: "steady" },
};

/**
 * One switch per class, each carrying that class's severity.
 *
 * Layers rather than a one-class-at-a-time picker, because time is the shared resource: five
 * separate maps would hide that Wednesday is already full of HIS while you are reading BIO, and
 * that collision *is* the problem this app is for. One piece of ground, and you choose what
 * stands on it.
 *
 * The severity stays lit on a switched-off class, which is the argument for putting these here
 * at all rather than leaving the lens buried in the roster table. Turning a class off has to
 * quieten the picture without quietening the class.
 */
function LayerBar({
  layers,
  theme,
  onToggle,
  onOnly,
  onAll,
}: {
  layers: {
    course: Course;
    on: boolean;
    level: string;
    concern: string | null;
    lit: number;
  }[];
  theme: ThemeName;
  onToggle: (courseId: string) => void;
  onOnly: (courseId: string) => void;
  onAll: () => void;
}) {
  const quest = theme === "quest";
  const anyOff = layers.some((l) => !l.on);

  return (
    <div className="terrain-layers">
      <ul>
        {layers.map(({ course, on, level, concern, lit }) => {
          const mark = LEVEL_MARK[level] ?? LEVEL_MARK.steady!;
          return (
            <li key={course.id}>
              <button
                type="button"
                className={`terrain-layer${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => onToggle(course.id)}
                // Shift-click is a shortcut, never the only way: the "Only this" path is also
                // reachable from the roster table, and a modifier nobody discovers is not a
                // feature. It is announced in the label below.
                onKeyDown={(e) => {
                  if (e.shiftKey && e.key === "Enter") {
                    e.preventDefault();
                    onOnly(course.id);
                  }
                }}
                title={concern ?? `${course.name} — ${mark.word}`}
              >
                <span
                  aria-hidden="true"
                  className="terrain-layer-swatch"
                  style={{ background: courseChipFill(course.id, course.colorToken) }}
                />
                <span className="terrain-layer-code">{course.code ?? course.name}</span>
                <span aria-hidden="true" style={{ color: levelColour(level, quest), fontWeight: 700 }}>
                  {mark.glyph}
                </span>
                {lit > 0 && on && (
                  <span aria-hidden="true" className="terrain-layer-count">
                    {lit}
                  </span>
                )}
                <span className="sr-only">
                  {course.name}: {mark.word}
                  {lit > 0 ? `, ${lit} needing time booked` : ""}.{" "}
                  {on ? "Shown on the map. Activate to hide." : "Hidden from the map. Activate to show."}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {anyOff && (
        <button type="button" className="terrain-layer-all" onClick={onAll}>
          Show every class
        </button>
      )}
    </div>
  );
}

/** Cells across the slab. Each costs one canvas fill, so this is the detail/time dial. */
const MESH_U = 168;
const MESH_V = 104;

/**
 * Where the ground starts dissolving, as a fraction of the way back.
 *
 * A crisp far edge says *the term ends here*, which is false and is the kind of false a picture
 * tells much more loudly than a sentence. Fading the last stretch into the background says the
 * true thing instead: the ground carries on, it is simply not worth modelling that far out. It
 * also gives the distance band something to emerge from rather than floating above a wall.
 */
const FADE_START = 0.66;

/** 1 where the ground is solid, falling to 0 where it has dissolved entirely. */
function groundOpacity(v: number): number {
  if (v <= FADE_START) return 1;
  const t = (v - FADE_START) / (1 - FADE_START);
  // Eased, because a linear ramp reads as a grey band laid over the model rather than as air.
  return Math.max(0, 1 - t * t);
}

/**
 * Where the light comes from, in map space: over the student's left shoulder and behind, high
 * enough that flat ground stays dark and only slopes facing it come up bright.
 */
const LIGHT = (() => {
  const v = { x: -0.58, y: 0.44, z: 0.69 };
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
})();

/**
 * The relief, hillshaded onto a canvas.
 *
 * Three earlier attempts are worth recording, because each failed in a way worth not repeating.
 *
 * The first drew each row of the field as a ridgeline filled flat to the bottom of the frame.
 * Every near row's fill covered the whole of every row behind it, so all that survived was the
 * stroke along each crest, and it read as contour lines ruled across a floor — which is what it
 * was. The second used a slope-shaded SVG quad mesh: real mass, but SVG has no Gouraud shading,
 * so at any resolution cheap enough to render the landscape looked built out of blocks. The
 * third went back to strips with a gradient anchored to each crest, which does read as terrain
 * — but only from a horizon camera, and the horizon camera was itself the problem.
 *
 * Looking down at a slab, the silhouette carries almost nothing and the shading carries
 * everything, so per-pixel hillshading stops being a nicety. That is a canvas job. The surface
 * normal comes from the height gradient in map space, so the same slope shades the same way
 * wherever it lands on screen, and altitude tints it — dark in the valleys, pale on the ridges
 * — which is the cue that survives being looked at for a quarter of a second.
 *
 * The base and its two visible walls are drawn last, because they hang below and in front of
 * the surface. They are what make this read as a model of the month rather than as a graph.
 */
function Relief({ field }: { field: HeightField }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(VIEW_W * dpr);
    canvas.height = Math.round(VIEW_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    // The model is built opaque on its own layer and faded once, as a layer.
    //
    // Fading cell by cell looked right in theory and was badly wrong on screen: each cell is
    // filled *and* stroked in its own colour to hide the seam between neighbours, and under a
    // partial alpha those two paints composite twice along every border. The result was a
    // regular lattice ruled over the whole far half — the model came out looking like gauze
    // stretched on a frame. Compositing the finished layer once has no seams to double.
    const layer = document.createElement("canvas");
    layer.width = canvas.width;
    layer.height = canvas.height;
    const lc = layer.getContext("2d");
    if (!lc) return;
    lc.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Heights are sampled once per grid vertex and reused by the four cells that share it —
    // sampling per cell corner did the same bilinear work four times over.
    const h: number[][] = [];
    for (let j = 0; j <= MESH_V; j += 1) {
      const v = j / MESH_V;
      const row: number[] = [];
      for (let i = 0; i <= MESH_U; i += 1) row.push(surfaceAt(field, (i / MESH_U) * 2 - 1, v));
      h.push(row);
    }

    const du = 2 / MESH_U;
    const dv = 1 / MESH_V;

    // Back to front, so near ground occludes far ground.
    for (let j = MESH_V - 1; j >= 0; j -= 1) {
      const v0 = j * dv;
      const v1 = (j + 1) * dv;
      for (let i = 0; i < MESH_U; i += 1) {
        const u0 = i * du - 1;
        const u1 = (i + 1) * du - 1;

        const hff = h[j + 1]![i]!;
        const hfr = h[j + 1]![i + 1]!;
        const hnf = h[j]![i]!;
        const hnr = h[j]![i + 1]!;
        const mid = (hff + hfr + hnf + hnr) / 4;

        // Normal from the height gradient in map space. The z term carries the scale between
        // "one unit of height" and "one unit of ground", which is what decides whether the
        // whole model reads as hills or as crumpled paper.
        const dhdu = (hfr + hnr - hff - hnf) / (2 * du);
        const dhdv = (hff + hfr - hnf - hnr) / (2 * dv);
        const nx = -dhdu * 0.5;
        const ny = -dhdv * 0.32;
        const len = Math.hypot(nx, ny, 1);
        const lambert = Math.max(0, (nx * LIGHT.x + ny * LIGHT.y + LIGHT.z) / len);

        // Altitude tint, then light. Valleys are near-black slate and ridges come up cold and
        // pale, so height reads even where the slope happens to face away from the light.
        // Altitude tint, then light. The floor is a lit slate rather than near-black: a plain
        // that renders as the background is indistinguishable from a hole, and the first pass
        // read as a dark plate with glows sitting on it rather than as ground.
        // The ramp is close to linear on purpose: an exponent flattering the low end blew
        // mid-height ground straight to white, so a moderately busy week looked exactly like
        // the worst one in the term and the picture stopped ranking anything.
        const alt = Math.min(1, mid * 1.05);
        const baseR = 46 + alt * 92;
        const baseG = 57 + alt * 103;
        const baseB = 80 + alt * 116;
        const shade = 0.36 + lambert * 0.78;
        lc.fillStyle = `rgb(${Math.round(baseR * shade)},${Math.round(baseG * shade)},${Math.round(baseB * shade)})`;

        const a = plot(u0, v1, hff);
        const b = plot(u1, v1, hfr);
        const c = plot(u1, v0, hnr);
        const d = plot(u0, v0, hnf);
        lc.beginPath();
        lc.moveTo(a.x, a.y);
        lc.lineTo(b.x, b.y);
        lc.lineTo(c.x, c.y);
        lc.lineTo(d.x, d.y);
        lc.closePath();
        lc.fill();
        // Stroked in its own fill: antialiasing between adjacent cells otherwise rules a pale
        // grid over the whole model.
        lc.strokeStyle = lc.fillStyle;
        lc.lineWidth = 1;
        lc.stroke();
      }
    }

    // The base the model sits on. The near wall follows the terrain's own front profile, which
    // is what a cut through a relief map looks like; the right wall does the same down its
    // edge. Without them the ground has no thickness and floats.
    const profile = (pts: { x: number; y: number }[], fill: string | CanvasGradient) => {
      lc.beginPath();
      lc.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) lc.lineTo(p.x, p.y);
      lc.closePath();
      lc.fillStyle = fill;
      lc.fill();
    };

    const nearTop: { x: number; y: number }[] = [];
    for (let i = 0; i <= MESH_U; i += 1) nearTop.push(plot((i / MESH_U) * 2 - 1, 0, h[0]![i]!));
    const nearBase = [plot(1, 0, 0), plot(-1, 0, 0)].map((p) => ({ x: p.x, y: p.y + SLAB_DEPTH }));
    // A cut through the model, not a shadow. Near-black walls left the shaded surface looking
    // like a crumpled sheet floating over a hole; a lit cross-section fading downward is what
    // makes it read as one solid block of a month.
    const cut = lc.createLinearGradient(0, plot(0, 0, 0).y - RISE * 0.4, 0, plot(1, 0, 0).y + SLAB_DEPTH);
    cut.addColorStop(0, "#3a4459");
    cut.addColorStop(0.55, "#232a3a");
    cut.addColorStop(1, "#12161f");
    profile([...nearTop, ...nearBase], cut);

    const rightTop: { x: number; y: number }[] = [];
    for (let j = MESH_V; j >= 0; j -= 1) rightTop.push(plot(1, j / MESH_V, h[j]![MESH_U]!));
    const rightBase = [plot(1, 0, 0), plot(1, 1, 0)].map((p) => ({ x: p.x, y: p.y + SLAB_DEPTH }));
    // The right face turns away from the light, so it is the same rock one step darker.
    const cutSide = lc.createLinearGradient(0, plot(1, 1, 0).y - RISE * 0.4, 0, plot(1, 0, 0).y + SLAB_DEPTH);
    cutSide.addColorStop(0, "#242c3c");
    cutSide.addColorStop(1, "#0d1017");
    profile([...rightTop, ...rightBase], cutSide);

    // Erase the far end of the finished layer. The gradient runs perpendicular to the lateral
    // axis, not along the time axis: those differ under an oblique projection, and using the
    // time axis tilts the haze a few degrees off the ground it is meant to be dissolving, so
    // one corner of the model outlives the other for no reason a reader could explain.
    const back = { x: -AXIS_U.y, y: AXIS_U.x };
    const backLen = Math.hypot(back.x, back.y);
    const nHat = { x: -back.x / backLen, y: -back.y / backLen };
    const from = plot(0, FADE_START, 0);
    const to = plot(0, 1, 0);
    const reach = (to.x - from.x) * nHat.x + (to.y - from.y) * nHat.y;
    const haze = lc.createLinearGradient(
      from.x,
      from.y,
      from.x + nHat.x * reach,
      from.y + nHat.y * reach,
    );
    // Stopped to match `groundOpacity` rather than ramping straight, so a beacon fades at the
    // same rate as the hill it is standing on.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      haze.addColorStop(t, `rgba(0, 0, 0, ${1 - groundOpacity(FADE_START + t * (1 - FADE_START))})`);
    }
    lc.globalCompositeOperation = "destination-out";
    lc.fillStyle = haze;
    lc.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.drawImage(layer, 0, 0, VIEW_W, VIEW_H);
  }, [field]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="terrain-canvas"
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
    />
  );
}

/**
 * Week rules along the right edge of the slab.
 *
 * Ruled on the edge rather than across the surface: lines drawn over the terrain either hide
 * under the hills they cross or float above them, and either way they stop being a scale.
 */
function WeekEdge({ focusDays, field }: { focusDays: number; field: HeightField }) {
  const ticks: { days: number; v: number }[] = [];
  // Only where there is still ground to rule against. A tick anchored to dissolved terrain
  // points at nothing and reads as a stray mark.
  for (let d = 7; d <= focusDays; d += 7) {
    const v = d / focusDays;
    if (groundOpacity(v) > 0.35) ticks.push({ days: d, v });
  }

  return (
    <g aria-hidden="true">
      {ticks.map(({ days, v }) => {
        const edge = plot(1, v, surfaceAt(field, 1, v));
        const out = plot(1, v, 0);
        return (
          <g key={days} opacity={groundOpacity(v)}>
            <line
              x1={edge.x}
              y1={edge.y}
              x2={out.x + 26}
              y2={out.y + 8}
              stroke="#5b6884"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <text x={out.x + 30} y={out.y + 12} fill="#9aa6c0" fontSize={12}>
              {days / 7}w
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** The near edge: today, where the student is standing. */
function Today({ reducedMotion }: { reducedMotion: boolean }) {
  const at = plot(0, 0, 0);
  const y = at.y + SLAB_DEPTH + 16;
  return (
    <g>
      <ellipse cx={at.x} cy={y} rx={200} ry={40} fill="url(#terrain-fire)" aria-hidden="true" />
      <g aria-hidden="true">
        <ellipse cx={at.x} cy={y + 2} rx={16} ry={5} fill="#3a2415" />
        <path
          d={`M${at.x} ${y - 24} q9 10 4 18 q-4 6 -4 6 q0 0 -4 -6 q-5 -8 4 -18 z`}
          fill="#ffb347"
          className={reducedMotion ? undefined : "terrain-flicker"}
        />
      </g>
      {/* Plated like the beacon labels: it sits in the middle of the fire's own glow, which
          measured 3.30:1 against it. */}
      <PlatedLabel
        x={at.x}
        y={y + 24}
        anchor="middle"
        fill="#cbd3e4"
        fontSize={13}
        fontWeight={600}
        text="Today"
      />
    </g>
  );
}

/**
 * The distance: everything past the modelled ground.
 *
 * A thin haze line stands in for the far edge, and the work out there is drawn small and dim.
 * That dimness is a claim — *this does not need you today* — and it is only true while nothing
 * is asking. Anything out here that still has no time booked keeps its colour and its glow, so
 * the one distant case that needs a decision now is the one thing in the band you can see.
 */
function DistanceBand({
  markers,
  focusDays,
  horizonDays,
  beyond,
}: {
  markers: TerrainMarker[];
  focusDays: number;
  horizonDays: number;
  beyond: number;
}) {
  const left = plotDistant(-1, 0.5);
  const right = plotDistant(1, 0.5);
  const note = plotDistant(0, 1);
  const weeks = Math.round(focusDays / 7);
  const far = Math.round(horizonDays / 7);

  return (
    <g aria-hidden="true">
      <line
        x1={left.x - 30}
        y1={left.y + 20}
        x2={right.x + 30}
        y2={right.y + 20}
        stroke="#39445e"
        strokeWidth={1}
        strokeDasharray="2 6"
      />
      <text x={right.x + 34} y={right.y + 24} fill="#8794b0" fontSize={12}>
        {weeks}w+
      </text>
      {markers.length > 0 && (
        <text x={note.x} y={note.y - 22} textAnchor="middle" fill="#8794b0" fontSize={12}>
          {markers.length} further out, to {far} weeks
          {beyond > 0 ? ` · ${beyond} beyond that` : ""}
        </text>
      )}
    </g>
  );
}

/**
 * Where a beacon's parts land. Shared by the mark and by its label, which are drawn in
 * separate passes and would otherwise drift apart the first time either was tuned.
 */
function beaconShape(marker: TerrainMarker, at: { x: number; y: number }, scale: number) {
  // Bigger work stands taller on its own ground, so size reads twice: once in the hill under
  // it and once in the pole.
  const stake = marker.rise * 26 * scale;
  return {
    x: at.x,
    groundY: at.y,
    y: at.y - stake,
    stake,
    size: Math.max(3.4, (5.6 + marker.rise * 4.4) * scale),
    // The named states are the ones worth burning for; everything else sits quiet whatever its
    // distance, so the lit markers are never competing with forty calm ones.
    burning: marker.state === "overdue" || marker.state === "needs_time",
  };
}

function Beacon({
  marker,
  at,
  scale,
  course,
  reducedMotion,
  haze = 1,
  onFocus,
}: {
  marker: TerrainMarker;
  /** Where it stands, already projected. */
  at: { x: number; y: number };
  scale: number;
  course: Course | undefined;
  reducedMotion: boolean;
  /** How much of the ground under it is still solid, so a beacon fades with its own hillside. */
  haze?: number;
  onFocus: () => void;
}) {
  const look = BEACON[marker.state];
  const { x, groundY, y, stake, size, burning } = beaconShape(marker, at, scale);
  // Trimmed from a wider halo: with twenty lit beacons on a busy month the glows merged into
  // one orange wash and swallowed the ground they are supposed to be standing on.
  const halo = size * (2.4 + marker.glow * 2.6);
  // Haze takes the calm markers with the ground they stand on, but never a warning: something
  // asking for time has to stay readable wherever it is, which is the whole argument for this
  // view over a date-sorted list.
  const fade = burning ? 1 : 0.4 + haze * 0.6;

  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={`${marker.title}. ${look.word}. ${marker.detail}`}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      opacity={fade}
      style={{ cursor: "pointer" }}
    >
      {stake > 2 && (
        <line x1={x} y1={groundY} x2={x} y2={y} stroke={look.fill} strokeWidth={0.9} opacity={0.45} />
      )}
      <circle
        cx={x}
        cy={y}
        r={halo}
        fill={`url(#halo-${marker.state})`}
        opacity={0.3 + marker.glow * 0.7}
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
      {/* The course's own colour, as a chip on the ground beneath — so a lit beacon says which
          class it belongs to without needing the label. */}
      {course && scale > 0.7 && (
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
    </g>
  );
}

/**
 * A label with its own dark ground under it.
 *
 * Terrain labels used to paint straight onto whatever they happened to land on, and measuring
 * the rendered pixels showed how badly that went: seven of fourteen were below AA and the worst
 * was **1.38:1** — cream lettering sitting on the orange halo of the very beacon it names. The
 * DOM contrast checker passed all of them, and could not have done otherwise, because a beacon
 * halo is an SVG sibling and the hillside is a canvas. Neither is an ancestor background, so
 * neither exists as far as `getComputedStyle` is concerned.
 *
 * A plate ends the whole class of problem rather than tuning around it: whatever the ground
 * does, whatever the halo does, the label's background is this colour. `tools/e2e/
 * canvas-contrast.mjs` measures the real pixels and is what any future change here has to
 * answer to.
 *
 * The width is **measured**, not estimated. Estimating it from the character count worked in
 * Quest and failed in the other two themes, because each theme ships its own typeface and a
 * per-character guess calibrated on a serif runs short on a sans. Letters hung off the end of
 * their plate onto bare hillside and four labels dropped back under AA — the exact failure the
 * plate exists to prevent, reintroduced by the shortcut taken while building it.
 */
function PlatedLabel({
  x,
  y,
  anchor,
  fill,
  fontSize,
  fontWeight,
  text,
  opacity = 1,
}: {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  fill: string;
  fontSize: number;
  fontWeight: number;
  text: string;
  opacity?: number;
}) {
  const textRef = useRef<SVGTextElement | null>(null);
  // The estimate is the first frame only, so the plate is never briefly absent; the measurement
  // replaces it before paint.
  const [inked, setInked] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) return;
    const measured = node.getComputedTextLength();
    // Zero means the font has not resolved yet, and a zero-width plate is worse than the guess.
    if (measured > 0) setInked(measured);
  }, [text, fontSize, fontWeight]);

  const width = (inked ?? text.length * fontSize * 0.56) + 12;
  const height = fontSize * 1.5;
  const left = anchor === "start" ? x - 6 : anchor === "end" ? x - width + 6 : x - width / 2;

  return (
    <g aria-hidden="true" opacity={opacity}>
      <rect
        aria-hidden="true"
        x={left}
        y={y - fontSize * 1.05}
        width={width}
        height={height}
        rx={4}
        fill="rgba(8, 11, 18, 0.9)"
      />
      <text
        ref={textRef}
        x={x}
        y={y}
        textAnchor={anchor}
        fill={fill}
        fontSize={fontSize}
        fontWeight={fontWeight}
      >
        {text}
      </text>
    </g>
  );
}
