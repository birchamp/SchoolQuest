import { MINUTES_PER_DAY, toEpochMinutes, type WorkItem } from "@schoolquest/domain";

/**
 * The term as ground you can see across.
 *
 * Every other view of the future is a list sorted by date, and a list is read one line at a
 * time — which is the one thing the students this is for cannot reliably do. Time blindness
 * is not helped by better sorting; it is helped by making time a *distance*, so "that is
 * weeks away" and "that is nearly here" become things the eye reports rather than things the
 * reader computes.
 *
 * So the term is laid out as terrain seen from where the student is standing. Depth is time.
 * Lateral position is which course. Height is how big the work is. And every marker carries a
 * light whose colour says whether the plan has made room for it.
 *
 * ## The two channels, and why they are separate
 *
 * **Brightness is proximity.** Anything near is lit, whatever state it is in, because "what
 * is on my plate" is a question about the next few days and it should not require reading a
 * single word to answer.
 *
 * **Hue is whether time has been set aside.** This is the channel that carries the warning,
 * and it is deliberately independent of distance: a paper six weeks out that nobody has
 * booked an hour for can burn red on the horizon, which is exactly the thing a date-sorted
 * list buries at position forty.
 *
 * ## What stops this from being a guilt machine
 *
 * An item with nothing booked is only marked as needing time once it is close enough that
 * work *should* have begun — measured from its own size, not from a calendar rule, so a
 * fifteen-hour paper starts asking weeks before a problem set does. Before that point it is
 * simply waiting, and waiting is drawn as calm, not as neglect. Nothing accumulates and
 * nothing decays: a marker returns to calm the moment time is booked for it
 * (`docs/02-prd.md` §3).
 *
 * Pure and deterministic — including the scatter, which is hashed from the work item's id so
 * the same term draws the same landscape every time. Nothing here reads a clock except
 * through `now`.
 */

export type BeaconState =
  /** Past its date and still open. */
  | "overdue"
  /** Close enough that work should have started, and no time is booked. */
  | "needs_time"
  /** Some time booked, but less than it looks like it needs. */
  | "partly_covered"
  /** Time is booked and it is keeping pace. */
  | "covered"
  /** Nothing booked, and nothing needs to be yet. */
  | "waiting"
  /** Finished. Drawn as a cold ember rather than removed, so progress is visible. */
  | "done";

export interface TerrainMarker {
  workItemId: string;
  courseId: string;
  title: string;
  workType: string;
  /** Null only for the undated markers, which are placed off to one side. */
  dueAt: string | null;
  dueConfirmed: boolean;
  /** Whole days until due; negative is past due. */
  daysAway: number | null;

  /** 0 at the viewer's feet, 1 at the horizon. Time, compressed for perspective. */
  depth: number;
  /** -1 (far left) to 1 (far right). Which course, plus a stable scatter. */
  lateral: number;
  /** 0..1 — how large the work is, drawn as height. */
  rise: number;

  state: BeaconState;
  /** 0..1 — how strongly this is lit. Proximity, not importance. */
  glow: number;
  /** One sentence naming the state. Rendered as-is, and read aloud as-is. */
  detail: string;

  requiredMinutes: number;
  bookedMinutes: number;
}

/**
 * The land itself, as a grid of heights.
 *
 * The first version drew three sine curves in three near-identical blues, which is a
 * gradient with a wobble rather than ground — and it was decoration, which this codebase
 * does not allow a metaphor to be. The relief is now *made of the work*: height at a point
 * is how much is due around that time, in that course's lane. A heavy fortnight three weeks
 * out is literally a mountain in the middle distance, and "when does this get hard" becomes
 * a thing the eye answers.
 *
 * Rows run back to front — `rows[0]` is at the horizon — so a renderer can paint them in
 * order and let near ground occlude far ground.
 */
export interface HeightField {
  /** `rows[depthBand][lateralSample]`, each 0..1. */
  rows: number[][];
  /** Depth (0 at the viewer, 1 at the horizon) of each row. */
  depths: number[];
  /** Lateral position (-1..1) of each sample. */
  laterals: number[];
}

export interface Terrain {
  markers: TerrainMarker[];
  /** Items with no known date, which cannot be placed by time. */
  undated: TerrainMarker[];
  /**
   * Work further out than the drawn horizon. Counted rather than placed, because squeezing
   * four months into one picture leaves the next fortnight — the only part anyone can act
   * on — in the bottom tenth of it, and everything else in an illegible band at the back.
   */
  beyond: TerrainMarker[];
  /** The furthest day drawn, so the caller can label the horizon honestly. */
  horizonDays: number;
  counts: Record<BeaconState, number>;
  /** The relief, built from where the work actually falls. */
  field: HeightField;
}

export interface TerrainInput {
  workItems: readonly WorkItem[];
  /** Minutes booked per work item across the whole term, not just this week. */
  bookedByItem: Readonly<Record<string, number>>;
  /** Course ids in a stable order; lanes are assigned from this. */
  courseIds: readonly string[];
  /** ISO instant. */
  now: string;
  /** Fallback effort by work type, so an unestimated item still has a size. */
  defaultEffortMinutes: Readonly<Record<string, number>>;
  /** How far ahead to draw. Anything past it is counted at the horizon instead. */
  visibleDays?: number;
}

/**
 * Roughly how much of a piece of work a student gets through in a week when they are
 * actually working on it: three sessions of about ninety minutes.
 *
 * This is what turns "no time booked" into a claim about *this* item rather than a blanket
 * rule: a fifteen-hour paper needs a bit over three weeks by this measure and starts asking
 * for time that far out, while a problem set asks for days. Without a size-aware rule the
 * horizon fills with red for work nobody should have started yet, and a warning that is
 * always on is not a warning. `MIN_WARNING_DAYS` puts a floor under it.
 */
const MINUTES_PER_WORKING_WEEK = 270;

/** Never demand that something be started more than this far ahead. */
const MAX_RUNWAY_DAYS = 35;

/**
 * The least warning anything gets, however small it is.
 *
 * Runway alone is derived from size, and for a thirty-minute quiz that comes out at one day —
 * which is not a warning, it is a notification on the morning it is due. Walking the real
 * semester forward showed the cost plainly: sixty days on, sixteen items had gone past their
 * date and exactly one had ever been lit on the way there. Everything now gets at least this
 * long lit as "on your plate and unaccounted for", and larger work gets proportionally more.
 */
const MIN_WARNING_DAYS = 10;

/**
 * How far ahead the ground is drawn.
 *
 * Eight weeks, because a term runs four months and drawing all of it was measurably worse:
 * with a 138-day horizon the whole of the next fortnight landed in the bottom fifth of the
 * frame and fifty markers piled into an unreadable band at the back. Eight weeks is also
 * about as far ahead as any of this is actionable — beyond it the honest answer is a count,
 * not a position.
 */
const DEFAULT_VISIBLE_DAYS = 56;

/** Rows of relief. Enough for the ridges to read as land, few enough to stay cheap. */
const FIELD_ROWS = 26;
/** Samples across each row. */
const FIELD_COLS = 49;

/**
 * How far a piece of work's mass spreads through the land, in depth and across lanes.
 *
 * Wide enough that neighbouring work merges into a ridge rather than standing as a spike per
 * item — the shape of a busy fortnight is the point, not the individual pins, which the
 * beacons already carry.
 */
const SPREAD_DEPTH = 0.09;
const SPREAD_LATERAL = 0.26;

/** Below this the item is a stone rather than a hill. */
const SMALL_MINUTES = 45;
/** At or above this it is a mountain. */
const LARGE_MINUTES = 600;

/**
 * How hard time is compressed toward the horizon.
 *
 * Linear depth wastes the near ground — with a term running four months out, everything for
 * the next fortnight lands in the bottom tenth of the picture, which is precisely the part
 * the student needs room to read. The exponent gives near days more of the frame while
 * keeping the far end genuinely far.
 */
const DEPTH_CURVE = 0.6;

export function buildTerrain(input: TerrainInput): Terrain {
  const now = toEpochMinutes(input.now);
  const laneOf = new Map(input.courseIds.map((id, i) => [id, i]));

  const open = input.workItems.filter(
    (item) => item.status !== "canceled" && item.status !== "optional",
  );

  const dated = open.filter((item) => item.dueAt !== null);
  const furthest = dated.reduce((max, item) => {
    const days = (toEpochMinutes(item.dueAt!) - now) / MINUTES_PER_DAY;
    return Math.max(max, days);
  }, 0);
  // A term with only imminent work still needs a horizon to draw against, and one running
  // months out is clipped rather than compressed.
  const horizonDays = Math.max(14, Math.min(input.visibleDays ?? DEFAULT_VISIBLE_DAYS, Math.ceil(furthest)));

  const markers: TerrainMarker[] = [];
  const undated: TerrainMarker[] = [];
  const beyond: TerrainMarker[] = [];

  for (const item of open) {
    const required = effortOf(item, input.defaultEffortMinutes);
    const booked = input.bookedByItem[item.id] ?? 0;
    const lane = laneOf.get(item.courseId) ?? 0;
    const lateral = lateralFor(lane, input.courseIds.length, item.id);
    const rise = riseFor(required);

    if (item.dueAt === null) {
      undated.push({
        workItemId: item.id,
        courseId: item.courseId,
        title: item.title,
        workType: item.workType,
        dueAt: null,
        dueConfirmed: false,
        daysAway: null,
        depth: 0.85,
        lateral,
        rise,
        state: finished(item) ? "done" : "waiting",
        glow: 0.25,
        detail: finished(item)
          ? "Finished."
          : "No date is known for this, so it cannot be placed in time.",
        requiredMinutes: required,
        bookedMinutes: booked,
      });
      continue;
    }

    const daysAway = Math.floor((toEpochMinutes(item.dueAt) - now) / MINUTES_PER_DAY);
    const depth = depthFor(daysAway, horizonDays);
    const { state, detail } = beaconFor(item, { daysAway, required, booked });

    (daysAway > horizonDays ? beyond : markers).push({
      workItemId: item.id,
      courseId: item.courseId,
      title: item.title,
      workType: item.workType,
      dueAt: item.dueAt,
      dueConfirmed: item.sourceConfidence === "confirmed",
      daysAway,
      depth,
      lateral,
      rise,
      state,
      // Proximity, so what is near is lit whatever state it is in. Overdue work is pinned
      // at full brightness — it is the one thing that must not recede.
      glow: state === "overdue" ? 1 : Math.max(0.12, 1 - depth),
      detail,
      requiredMinutes: required,
      bookedMinutes: booked,
    });
  }

  // Far markers are drawn first so near ones sit on top of them.
  markers.sort((a, b) => b.depth - a.depth || a.workItemId.localeCompare(b.workItemId));

  const counts: Record<BeaconState, number> = {
    overdue: 0,
    needs_time: 0,
    partly_covered: 0,
    covered: 0,
    waiting: 0,
    done: 0,
  };
  // Everything is counted, drawn or not: a legend that only totals what fits would be the
  // one number on this screen that is quietly false.
  for (const marker of [...markers, ...undated, ...beyond]) counts[marker.state] += 1;

  beyond.sort((a, b) => (a.daysAway ?? 0) - (b.daysAway ?? 0));
  return { markers, undated, beyond, horizonDays, counts, field: buildField(markers) };
}

function finished(item: WorkItem): boolean {
  return item.status === "completed" || item.status === "submitted";
}

function effortOf(item: WorkItem, defaults: Readonly<Record<string, number>>): number {
  return item.remainingMinutes ?? item.estimatedMinutes ?? defaults[item.workType] ?? 60;
}

/**
 * How far ahead this particular piece of work starts asking for time.
 *
 * Derived from its own size rather than from a fixed number of days, because that is the
 * only version that is true of both a fifteen-hour paper and a half-hour quiz.
 */
export function runwayDays(requiredMinutes: number): number {
  const weeks = requiredMinutes / MINUTES_PER_WORKING_WEEK;
  return Math.min(MAX_RUNWAY_DAYS, Math.max(MIN_WARNING_DAYS, Math.ceil(weeks * 7)));
}

function beaconFor(
  item: WorkItem,
  facts: { daysAway: number; required: number; booked: number },
): { state: BeaconState; detail: string } {
  if (finished(item)) return { state: "done", detail: "Finished." };

  if (facts.daysAway < 0) {
    return {
      state: "overdue",
      detail: `Its date has passed${
        facts.booked > 0 ? " and it is still open" : " and no time was booked for it"
      }.`,
    };
  }

  const runway = runwayDays(facts.required);

  if (facts.booked === 0) {
    if (facts.daysAway <= runway) {
      return {
        state: "needs_time",
        detail: `Due in ${facts.daysAway} ${facts.daysAway === 1 ? "day" : "days"}, needs about ${hours(
          facts.required,
        )}, and no time is booked for it yet.`,
      };
    }
    return {
      state: "waiting",
      detail: `Due in ${facts.daysAway} days. Nothing needs booking for it for about another ${
        facts.daysAway - runway
      } days.`,
    };
  }

  if (facts.booked >= facts.required) {
    return {
      state: "covered",
      detail: `${hours(facts.booked)} booked, which covers what it looks like it needs.`,
    };
  }

  return {
    state: "partly_covered",
    detail: `${hours(facts.booked)} booked of about ${hours(facts.required)}.`,
  };
}

function hours(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)} hours`;
}

/** Time, compressed so the near ground gets the room it needs. */
function depthFor(daysAway: number, horizonDays: number): number {
  const clamped = Math.max(0, Math.min(daysAway, horizonDays));
  return Math.pow(clamped / horizonDays, DEPTH_CURVE);
}

/** Size, as a 0..1 height. */
function riseFor(minutes: number): number {
  if (minutes <= SMALL_MINUTES) return 0.08;
  if (minutes >= LARGE_MINUTES) return 1;
  return 0.08 + (0.92 * (minutes - SMALL_MINUTES)) / (LARGE_MINUTES - SMALL_MINUTES);
}

/**
 * Which course, plus a small stable scatter.
 *
 * Courses get lanes so the eye can follow one across the term, but a lane with nine items
 * due the same fortnight would stack them into one illegible pile. The scatter is hashed
 * from the id rather than randomised, so the landscape is identical on every render — a map
 * that rearranges itself between glances is worse than no map.
 */
function lateralFor(lane: number, laneCount: number, id: string): number {
  const centre = laneCount <= 1 ? 0 : (lane / (laneCount - 1)) * 2 - 1;
  const usable = 0.78; // Keep lanes clear of the frame edge.
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const jitter = ((Math.abs(hash) % 1000) / 1000 - 0.5) * (laneCount <= 1 ? 0.9 : 1.4 / laneCount);
  return Math.max(-1, Math.min(1, centre * usable + jitter));
}


/**
 * Raises the land under the work.
 *
 * Each marker contributes its effort as a soft bump centred on where it sits, so a fortnight
 * carrying three big pieces rises as one ridge rather than three spikes. A little base relief
 * is added underneath so ground with nothing on it still reads as landscape rather than as a
 * flat floor — that part is decoration and is deliberately small enough never to be mistaken
 * for load.
 */
function buildField(markers: readonly TerrainMarker[]): HeightField {
  const depths = Array.from({ length: FIELD_ROWS }, (_, i) => 1 - i / (FIELD_ROWS - 1));
  const laterals = Array.from({ length: FIELD_COLS }, (_, i) => (i / (FIELD_COLS - 1)) * 2 - 1);

  const rows = depths.map((depth) =>
    laterals.map((lateral) => {
      let load = 0;
      for (const m of markers) {
        const dd = (m.depth - depth) / SPREAD_DEPTH;
        const dl = (m.lateral - lateral) / SPREAD_LATERAL;
        const falloff = Math.exp(-(dd * dd + dl * dl));
        if (falloff < 0.01) continue;
        load += m.requiredMinutes * falloff;
      }
      // Base relief: deterministic, small, and never confusable with work. Divided by the sum
      // of the wave amplitudes so it lands in 0..1 — without that the troughs go negative and
      // the ground dips below the plane the beacons stand on.
      const base =
        ((Math.sin(lateral * 5.1 + depth * 3.7) + Math.sin(lateral * 11.3 - depth * 6.1) * 0.4) / 1.4) *
          0.5 +
        0.5;
      return { load, base };
    }),
  );

  const peak = rows.reduce(
    (max, row) => row.reduce((m, cell) => Math.max(m, cell.load), max),
    0,
  );

  return {
    depths,
    laterals,
    rows: rows.map((row) =>
      row.map((cell) => {
        // Square root, so a fortnight holding twice the work is visibly higher without one
        // enormous project flattening everything else into the floor.
        const fromWork = peak > 0 ? Math.sqrt(cell.load / peak) : 0;
        return Math.min(1, fromWork * 0.86 + cell.base * 0.14);
      }),
    ),
  };
}
