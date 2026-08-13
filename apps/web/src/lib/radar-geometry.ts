import type { RadarEncounterView } from "./types.js";

/**
 * Where every mark on the radar goes.
 *
 * Kept apart from the component for one reason: this is the part that can be wrong in a way
 * nobody notices. A marker in the wrong place still looks like a radar. So the projection is
 * pure, takes no clock and no DOM, and is tested directly.
 *
 * The sweep is a half-plane rather than a full circle because a full circle would put half
 * the picture behind the student, where there is no time to draw. The student stands at the
 * centre of the baseline; everything ahead of them is above it.
 */

/**
 * The drawing surface. Everything below is in these coordinates.
 *
 * The band under the baseline is not spare room. See `OVERDUE_*` below: it is where work
 * that is already past its date goes, and a real term keeps it full.
 */
export const RADAR_VIEWBOX = { width: 980, height: 668 } as const;
export const RADAR_CENTER = { x: 490, y: 474 } as const;
export const RADAR_RADIUS = 400;

/**
 * Overdue work is drawn *behind* the student, in the mirrored band below the baseline.
 *
 * The prototype had no overdue state, and the obvious reading of its geometry — clamp the
 * distance at zero — put every late item on the centre mark. A real term six weeks in has
 * nineteen of them, and they landed as one indistinguishable blob directly on top of the
 * "you are here" square: the single most important thing on the board rendered as a smudge.
 *
 * Behind is where they actually are. The columns continue below the line, so something that
 * was due last Monday sits under the same spoke as next Monday, and how far below is how
 * long ago. The past has its own scale — it compresses, because "three weeks late" and "five
 * weeks late" are the same decision — and the two halves are never compared.
 */
const OVERDUE_REACH = 170;
/** Past this many days late the band stops growing; it is all one problem by then. */
const OVERDUE_SATURATION_DAYS = 21;

/**
 * Nothing is drawn closer to the centre than this.
 *
 * Without a floor, everything due today collapses onto the student's own mark and the day
 * that matters most becomes the one day that cannot be read.
 */
const MIN_RADIUS = 26;

/** Half-plane: bearing runs 180 degrees (left) to 0 (right) across seven day columns. */
const SWEEP_DEGREES = 180;
const DAY_COLUMNS = 7;

/**
 * Deterministic 32-bit hash of a marker id (FNV-1a).
 *
 * Both jitters below are derived from this rather than from a random source, so a marker
 * never moves between renders. Random jitter makes the whole board shimmer every time any
 * state changes, which reads as the data changing when nothing has.
 *
 * It takes a string because merged encounters carry ids like `boss:2026-10-02`. The
 * prototype hashed a numeric id and fell back to a day-derived key; a NaN there silently
 * drops a marker's position and it renders in the corner of the frame.
 */
export function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export interface Projection {
  x: number;
  y: number;
  /** Distance from the centre in pixels, before jitter is added. */
  radius: number;
  degrees: number;
  /** Marker diameter. */
  size: number;
  /** Drawn in the overdue band, below the baseline. */
  behind: boolean;
}

/** Marker diameter: the assignment's share of the course grade, made visible. */
export function markerSize(tier: number, boss: boolean): number {
  return boss ? 30 : 9 + tier * 4;
}

/**
 * More than ten days out and on pace.
 *
 * Drawn dimmed on purpose: present, but not asking for you. This is the counterweight to
 * showing four weeks at once — without it the far rings are as loud as tomorrow.
 */
export function isDistant(encounter: RadarEncounterView): boolean {
  return encounter.daysAway > 10 && encounter.health === "ok";
}

/**
 * Places one encounter, or returns null when it lies past the current horizon.
 *
 * Past the horizon it is dropped rather than drawn faintly: the rings are a scale, and a
 * mark outside the outermost ring would be a mark with no distance.
 */
export function projectEncounter(
  encounter: RadarEncounterView,
  weeks: number,
): Projection | null {
  const horizonDays = weeks * 7;
  if (encounter.daysAway > horizonDays) return null;

  const hash = hashId(encounter.id);
  // A fraction of a degree, so two things due the same day sit beside each other rather
  // than one hiding the other. The pile-up itself is the signal and must stay readable.
  const bearingJitter = ((hash % 9) - 4) * 0.5;
  const radiusJitter = ((Math.floor(hash / 9) % 7) - 3) * 3;

  const degrees =
    SWEEP_DEGREES -
    (encounter.bearingIndex + 0.5) * (SWEEP_DEGREES / DAY_COLUMNS) +
    bearingJitter;
  const radians = (degrees * Math.PI) / 180;

  const behind = encounter.daysAway < 0;
  const radius = behind
    ? MIN_RADIUS +
      (Math.min(-encounter.daysAway, OVERDUE_SATURATION_DAYS) / OVERDUE_SATURATION_DAYS) *
        (OVERDUE_REACH - MIN_RADIUS) +
      radiusJitter
    : Math.max(
        MIN_RADIUS,
        (Math.min(encounter.distanceDays, horizonDays) / horizonDays) * RADAR_RADIUS + radiusJitter,
      );

  return {
    x: RADAR_CENTER.x + radius * Math.cos(radians),
    // Mirrored below the baseline for anything already past its date.
    y: RADAR_CENTER.y + (behind ? 1 : -1) * radius * Math.sin(radians),
    radius,
    degrees,
    size: markerSize(encounter.tier, encounter.boss),
    behind,
  };
}

/**
 * The arc bounding the overdue band, and the mirrored spokes inside it.
 *
 * Drawn only when something is actually late. An empty band with its own furniture reads as
 * a region of the board the student has failed to fill, which is the opposite of true.
 */
export function overdueBandGeometry(): { arc: string; spokes: SpokeGeometry[] } {
  const spokes: SpokeGeometry[] = [];
  for (let k = 0; k <= DAY_COLUMNS; k += 1) {
    const radians = ((k * SWEEP_DEGREES) / DAY_COLUMNS) * (Math.PI / 180);
    spokes.push({
      x1: RADAR_CENTER.x,
      y1: RADAR_CENTER.y,
      x2: Math.round(RADAR_CENTER.x + OVERDUE_REACH * Math.cos(radians)),
      y2: Math.round(RADAR_CENTER.y + OVERDUE_REACH * Math.sin(radians)),
    });
  }
  const r = OVERDUE_REACH;
  return {
    arc: `M ${RADAR_CENTER.x + r} ${RADAR_CENTER.y} A ${r} ${r} 0 0 1 ${RADAR_CENTER.x - r} ${RADAR_CENTER.y}`,
    spokes,
  };
}

export interface RingGeometry {
  /** SVG path for the week arc. */
  d: string;
  /** "1 (wk 5)" — weeks from today, and the week of the term it lands in. */
  label: string;
  labelX: number;
  labelY: number;
}

/**
 * One arc per week inside the horizon.
 *
 * The label carries both numbers because they answer different questions: weeks-from-now is
 * how long you have, week-of-term is where the syllabus says you are. A student reading a
 * syllabus that says "Week 7" needs the second, and no other screen offers it.
 */
export function ringGeometry(weeks: number, currentTermWeek: number | null): RingGeometry[] {
  const rings: RingGeometry[] = [];
  for (let k = 1; k <= weeks; k += 1) {
    const r = (k / weeks) * RADAR_RADIUS;
    // Set on a shallow diagonal rather than in a row along the baseline. The baseline is
    // where near work crowds, and at six weeks into a term the labels there were sitting
    // underneath the markers they exist to give a scale to.
    const radians = (RING_LABEL_BEARING * Math.PI) / 180;
    rings.push({
      d: `M ${RADAR_CENTER.x - r} ${RADAR_CENTER.y} A ${r} ${r} 0 0 1 ${RADAR_CENTER.x + r} ${RADAR_CENTER.y}`,
      label: currentTermWeek === null ? `${k} wk` : `${k} (wk ${currentTermWeek + k})`,
      labelX: Math.round(RADAR_CENTER.x + r * Math.cos(radians)),
      labelY: Math.round(RADAR_CENTER.y - r * Math.sin(radians)),
    });
  }
  return rings;
}

/**
 * Degrees: the spoke between the first and second columns.
 *
 * A column boundary is the one ray on the board nothing is ever drawn along — markers are
 * scattered around column *centres* — so the week labels climb it without colliding with
 * either the markers or the weekday labels ringing the outside.
 */
const RING_LABEL_BEARING = (SWEEP_DEGREES / DAY_COLUMNS) * 6;

export interface SpokeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The eight rays that separate the seven day columns. */
export function spokeGeometry(): SpokeGeometry[] {
  const spokes: SpokeGeometry[] = [];
  for (let k = 0; k <= DAY_COLUMNS; k += 1) {
    const radians = ((k * SWEEP_DEGREES) / DAY_COLUMNS) * (Math.PI / 180);
    spokes.push({
      x1: RADAR_CENTER.x,
      y1: RADAR_CENTER.y,
      x2: Math.round(RADAR_CENTER.x + RADAR_RADIUS * Math.cos(radians)),
      y2: Math.round(RADAR_CENTER.y - RADAR_RADIUS * Math.sin(radians)),
    });
  }
  return spokes;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface DayLabelGeometry {
  /** 0 is today. */
  index: number;
  label: string;
  x: number;
  y: number;
}

/**
 * Names the seven columns, starting from today.
 *
 * Column 0 is today whatever weekday that is, so the sweep does not rotate through the week.
 * The prototype put Monday at the far left because its fixtures assumed today was Monday;
 * on any other day that silently mislabels every column.
 */
export function dayLabelGeometry(todayDayOfWeek: number): DayLabelGeometry[] {
  const labels: DayLabelGeometry[] = [];
  for (let i = 0; i < DAY_COLUMNS; i += 1) {
    const degrees = SWEEP_DEGREES - (i + 0.5) * (SWEEP_DEGREES / DAY_COLUMNS);
    const radians = (degrees * Math.PI) / 180;
    const r = RADAR_RADIUS + 26;
    labels.push({
      index: i,
      label: WEEKDAYS[(todayDayOfWeek + i) % 7]!,
      x: Math.round(RADAR_CENTER.x + r * Math.cos(radians)),
      y: Math.round(RADAR_CENTER.y - r * Math.sin(radians)),
    });
  }
  return labels;
}

export function weekdayName(dayOfWeek: number): string {
  return WEEKDAYS[((dayOfWeek % 7) + 7) % 7]!;
}

/**
 * Where the hover card goes: beside the marker, flipped before it leaves the frame, and
 * never so high that its own top edge is cut off.
 */
export function tooltipPosition(projection: { x: number; y: number }): { x: number; y: number } {
  const flip = projection.x > 660;
  return {
    x: Math.round(flip ? projection.x - 276 : projection.x + 22),
    // Clamped against the frame it is actually drawn in. The ceiling used to be a bare 300,
    // written when the box was 520 tall; once the overdue band made it 668, a card for a
    // late marker was parked halfway up the board, no longer pointing at anything.
    y: Math.round(
      Math.max(6, Math.min(projection.y - 18, RADAR_VIEWBOX.height - TOOLTIP_HEIGHT)),
    ),
  };
}

/** Enough room for the pinned card, which is the taller of the two states. */
const TOOLTIP_HEIGHT = 200;
