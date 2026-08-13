import {
  MINUTES_PER_DAY,
  dateToEpochMinutes,
  epochMinutesToDate,
  estimateAcademicValue,
  toEpochMinutes,
  type GradingCategory,
  type WorkItem,
} from "@schoolquest/domain";
import { DEFAULT_EFFORT_MINUTES } from "./scheduler.js";
import { runwayDays } from "./terrain.js";

/**
 * The term as a radar sweep: what is coming, and whether time has been set aside for it.
 *
 * This is the same argument `terrain.ts` makes — that time blindness is not helped by better
 * sorting, only by making time a *distance* — carried to the surface the student actually
 * plans from. Three things are read off it without reading a word:
 *
 *   - **How far out** something is. Distance from the centre is days until due.
 *   - **Which day** it lands on. Bearing is the weekday, so a column read outward is every
 *     Thursday of the month at once, and two things due the same day visibly pile up.
 *   - **How big** it is. Diameter is the assignment's share of the course grade.
 *
 * Colour carries exactly one thing: whether enough time is booked. That constraint is the
 * whole design. Course identity, completion percentage and a sweep line were all considered
 * and left out, because the moment colour means two things it means neither.
 *
 * ## What "enough time" means here, and why it is not `booked / needed`
 *
 * The naive ratio marks a twelve-hour paper red the day it appears on a syllabus, six weeks
 * before anyone should have started it. A warning that is always on is not a warning, and a
 * screen that is permanently red is a guilt machine — which this product is explicitly not
 * (docs/01-product-brief.md §3).
 *
 * So the comparison is against what *should* be banked by now, and "by now" is derived from
 * the work's own size via `runwayDays`: a fifteen-hour paper starts asking for time weeks
 * out, a problem set asks days out, and before that point nothing is owed and the marker is
 * calm. The raw hours are still reported on every encounter, so the bar and the dossier show
 * the real figures rather than the pace-adjusted one.
 *
 * Pure and deterministic. Nothing here reads a clock except through `now`.
 */

/** The three tiers the whole visual language rests on. */
export type RadarHealth =
  /** On pace, or ahead. Booked time meets what the runway asks for by now. */
  | "ok"
  /** Behind but recoverable — roughly one session short of where it should be. */
  | "warn"
  /** Under half of what should already be banked, or past due. */
  | "crit";

/** 1 trivial to 5 boss-class, from the share of the course grade the item controls. */
export type ThreatTier = 1 | 2 | 3 | 4 | 5;

/** Why the dossier says what it says. Wording lives in the theme, never here. */
export type RadarAdviceCode =
  /** Past its date and still open. */
  | "OVERDUE"
  /** Nothing is owed yet; the runway has not opened. */
  | "NOT_YET_DUE_WORK"
  /** Booked time meets the pace. Hold the blocks already on the calendar. */
  | "HOLD"
  /** One more session closes the gap. */
  | "ONE_MORE_SESSION"
  /** Book time now or drop something else. */
  | "BOOK_NOW"
  /** Two heavy encounters on one day: the day is oversubscribed, not just the work. */
  | "SPLIT_THE_BOSS";

export interface RadarEncounter {
  /** A work item id, or `boss:<date>` for a merged encounter. */
  id: string;
  /** True when two or more heavy items landing on one day were folded together. */
  boss: boolean;
  /** The work items behind this marker. A solo encounter lists only itself. */
  memberIds: string[];
  /** Every course involved, in the order the members are listed. */
  courseIds: string[];
  title: string;
  /** The work type, or `mixed` on a boss spanning more than one. */
  workType: string;
  dueAt: string;
  dueDate: string;
  /** Whole calendar days from today. 0 is today; negative is past due. */
  daysAway: number;
  /**
   * Distance from the centre, in days. Never negative — overdue work is drawn on top of
   * the student rather than behind them, because that is where it actually is.
   */
  distanceDays: number;
  /** Which spoke: 0 is today, 6 is six days out. Bearing repeats weekly by construction. */
  bearingIndex: number;
  /** 0 Sunday to 6 Saturday, the real weekday this lands on. */
  dayOfWeek: number;
  tier: ThreatTier;
  /**
   * Share of the course grade this controls, 0..1, normalized within its own course by
   * `estimateAcademicValue`. Null when the syllabus gave nothing to go on — in which case
   * the tier came from the work type and the UI must say so rather than print a percentage.
   */
  gradeShare: number | null;
  hoursNeeded: number;
  hoursBanked: number;
  /** Hours that should already stand on the calendar, given this size of work. */
  hoursExpected: number;
  /** `banked / needed`, 0..1. The progress bar, and nothing else. */
  coverage: number;
  /** `banked / expected`, 0..1. The verdict below is a threshold on this. */
  readiness: number;
  health: RadarHealth;
  overdue: boolean;
  /** Hours short of what should be banked by now. Zero when on pace. */
  shortfallHours: number;
  advice: RadarAdviceCode;
}

export interface RadarTermWeek {
  /** 1-based week of the term. */
  weekNumber: number;
  startDate: string;
  /** Effort due in this week, in hours. Projected workload, not booked time. */
  hours: number;
  /** 0..1 against the busiest week of the term, so the bars have a scale. */
  intensity: number;
  isCurrent: boolean;
  isPast: boolean;
  /** This week contains a merged boss encounter. */
  hasBoss: boolean;
}

export interface CampaignRadar {
  /** Everything placeable inside the horizon, sorted by due date. */
  encounters: RadarEncounter[];
  horizonDays: number;
  /** Week of the term `now` falls in, 1-based. Null when the term has no start date. */
  currentTermWeek: number | null;
  /** The whole term, one entry per week. Empty when the term has no dates. */
  termWeeks: RadarTermWeek[];
  /** Open work with no due date. It cannot be placed in time, and the radar says so. */
  undatedCount: number;
  /** Open work further out than the horizon. Counted, not placed. */
  beyondCount: number;
}

export interface RadarInput {
  workItems: readonly WorkItem[];
  gradingCategories: readonly GradingCategory[];
  /** Minutes booked per work item across the whole term, not just this week. */
  bookedByItem: Readonly<Record<string, number>>;
  /** ISO instant. */
  now: string;
  /** First day of instruction, "YYYY-MM-DD". Without it there is no term map. */
  termStartDate?: string;
  /** Last day of instruction, "YYYY-MM-DD". */
  termEndDate?: string;
  /** How far out to place anything. Four weeks, matching the widest horizon control. */
  horizonDays?: number;
}

/**
 * Four weeks.
 *
 * The horizon control zooms inside this rather than past it: at 1W a single week fills the
 * sweep and two things due the same afternoon separate; at 4W the month compresses and the
 * question changes from "what is next" to "which week do I steal hours from". Past four
 * weeks a plan is not real enough to draw — dates move and syllabi change — and the term map
 * along the bottom is the honest way to see further.
 */
const DEFAULT_HORIZON_DAYS = 28;

/** At or above this share of what should be banked, an encounter is on pace. */
const OK_READINESS = 0.95;
/** Below `OK_READINESS` and at or above this, it is one session short. */
const WARN_READINESS = 0.55;

/**
 * Grade share at which each tier begins. A tier is the largest one the share clears.
 *
 * These are shares of the *whole course grade*, which is the only comparable measure across
 * classes: a 200-point final in a 1000-point course and a 20%-weighted final are the same
 * fifth of the grade, and `estimateAcademicValue` has already reconciled the two conventions
 * before anything reaches here.
 */
const TIER_THRESHOLDS: readonly { tier: ThreatTier; minShare: number }[] = [
  { tier: 5, minShare: 0.2 },
  { tier: 4, minShare: 0.12 },
  { tier: 3, minShare: 0.07 },
  { tier: 2, minShare: 0.03 },
  { tier: 1, minShare: 0 },
];

/** Tier at or above which an item is heavy enough to merge into a boss. */
const BOSS_TIER = 4;

/**
 * Tier for work whose weight the syllabus never stated.
 *
 * Deliberately a coarse prior on the work type and nothing cleverer: guessing a percentage
 * would put a fabricated number in the dossier next to real ones, and the student cannot
 * tell them apart. The tier still sizes the marker, `gradeShare` stays null, and the UI is
 * obliged to say the weight was inferred.
 */
function tierFromWorkType(workType: string): ThreatTier {
  switch (workType) {
    case "exam":
    case "paper":
    case "group_project":
    case "presentation":
      return 4;
    case "problem_set":
    case "lab":
    case "quiz":
    case "exam_prep":
    case "quiz_prep":
      return 3;
    case "reading":
    case "discussion":
      return 1;
    default:
      return 2;
  }
}

function tierFromShare(share: number): ThreatTier {
  for (const step of TIER_THRESHOLDS) {
    if (share >= step.minShare) return step.tier;
  }
  return 1;
}

/** Effort still owed on an item, from the best source available (docs/04 §9). */
function requiredMinutesFor(item: WorkItem): number {
  if (item.remainingMinutes !== null) return item.remainingMinutes;
  if (item.estimatedMinutes !== null) return item.estimatedMinutes;
  return DEFAULT_EFFORT_MINUTES[item.workType] ?? 60;
}

function isOpen(item: WorkItem): boolean {
  return (
    item.status !== "completed" &&
    item.status !== "submitted" &&
    item.status !== "canceled" &&
    item.status !== "optional"
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function roundTo(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

/**
 * How much of the work should already stand on the calendar, 0..1.
 *
 * Zero until the item's runway opens, then rising linearly to 1 on the due date. The runway
 * comes from the work's own size, which is what stops the radar demanding that a term paper
 * and a reading quiz be started on the same schedule.
 */
export function expectedFraction(daysAway: number, requiredMinutes: number): number {
  const runway = runwayDays(requiredMinutes);
  if (runway <= 0) return 1;
  return clamp01((runway - daysAway) / runway);
}

function verdict(readiness: number, overdue: boolean): RadarHealth {
  if (overdue) return readiness >= OK_READINESS ? "warn" : "crit";
  if (readiness >= OK_READINESS) return "ok";
  if (readiness >= WARN_READINESS) return "warn";
  return "crit";
}

function adviceFor(input: {
  health: RadarHealth;
  boss: boolean;
  overdue: boolean;
  hoursExpected: number;
}): RadarAdviceCode {
  if (input.overdue) return "OVERDUE";
  if (input.boss && input.health !== "ok") return "SPLIT_THE_BOSS";
  if (input.health === "ok") {
    return input.hoursExpected <= 0 ? "NOT_YET_DUE_WORK" : "HOLD";
  }
  return input.health === "warn" ? "ONE_MORE_SESSION" : "BOOK_NOW";
}

/**
 * Builds the radar.
 *
 * Boss merging happens before anything is measured, so a merged encounter's hours are the
 * summed hours of its members and every view agrees about it without extra work.
 */
export function buildCampaignRadar(input: RadarInput): CampaignRadar {
  const horizonDays = Math.max(7, input.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const now = toEpochMinutes(input.now);
  const startOfToday = dateToEpochMinutes(epochMinutesToDate(now));

  const open = input.workItems.filter(isOpen);
  const categoriesByCourse = new Map<string, GradingCategory[]>();
  for (const category of input.gradingCategories) {
    const list = categoriesByCourse.get(category.courseId);
    if (list) list.push(category);
    else categoriesByCourse.set(category.courseId, [category]);
  }
  const itemsByCourse = new Map<string, WorkItem[]>();
  for (const item of input.workItems) {
    const list = itemsByCourse.get(item.courseId);
    if (list) list.push(item);
    else itemsByCourse.set(item.courseId, [item]);
  }

  let undatedCount = 0;
  let beyondCount = 0;

  /** One placed work item, before boss merging. */
  interface Placed {
    item: WorkItem;
    dueAt: string;
    dueDate: string;
    daysAway: number;
    distanceDays: number;
    minutesNeeded: number;
    minutesBanked: number;
    tier: ThreatTier;
    gradeShare: number | null;
  }

  const placed: Placed[] = [];
  for (const item of open) {
    if (item.dueAt === null) {
      undatedCount += 1;
      continue;
    }
    const dueMinutes = toEpochMinutes(item.dueAt);
    const dueDate = epochMinutesToDate(dueMinutes);
    // Whole calendar days, not a floor of the raw difference: work due at nine tomorrow
    // morning is tomorrow's problem even when it is only ten hours away.
    const daysAway = Math.round((dateToEpochMinutes(dueDate) - startOfToday) / MINUTES_PER_DAY);
    if (daysAway > horizonDays) {
      beyondCount += 1;
      continue;
    }

    const gradeShare = estimateAcademicValue(item, {
      courseWorkItems: itemsByCourse.get(item.courseId) ?? [],
      categories: categoriesByCourse.get(item.courseId) ?? [],
    });

    placed.push({
      item,
      dueAt: item.dueAt,
      dueDate,
      daysAway,
      // Fractional distance keeps two things due the same day from landing exactly on top
      // of each other, and keeps overdue work pinned at the centre rather than behind it.
      distanceDays: Math.max(0, (dueMinutes - now) / MINUTES_PER_DAY),
      minutesNeeded: requiredMinutesFor(item),
      minutesBanked: input.bookedByItem[item.id] ?? 0,
      tier: gradeShare === null ? tierFromWorkType(item.workType) : tierFromShare(gradeShare),
      gradeShare,
    });
  }

  // Heavy work landing on one day is a fight with the day, not with either assignment, and
  // it usually has to be solved a week earlier than either piece suggests alone. Group by
  // calendar date so the merge is about the day the student actually lives through.
  const heavyByDate = new Map<string, Placed[]>();
  for (const p of placed) {
    if (p.tier < BOSS_TIER) continue;
    const list = heavyByDate.get(p.dueDate);
    if (list) list.push(p);
    else heavyByDate.set(p.dueDate, [p]);
  }

  const merged = new Set<string>();
  const encounters: RadarEncounter[] = [];

  for (const [date, group] of heavyByDate) {
    if (group.length < 2) continue;
    const members = [...group].sort((a, b) => a.item.id.localeCompare(b.item.id));
    for (const m of members) merged.add(m.item.id);

    const minutesNeeded = members.reduce((sum, m) => sum + m.minutesNeeded, 0);
    const minutesBanked = members.reduce((sum, m) => sum + m.minutesBanked, 0);
    // The nearest member sets the clock: the day is what is oversubscribed, and the day
    // arrives when its earliest piece does.
    const daysAway = Math.min(...members.map((m) => m.daysAway));
    const distanceDays = Math.min(...members.map((m) => m.distanceDays));
    const shares = members.map((m) => m.gradeShare);
    const gradeShare = shares.every((s) => s !== null)
      ? clamp01((shares as number[]).reduce((sum, s) => sum + s, 0))
      : null;
    const workTypes = new Set(members.map((m) => m.item.workType));

    encounters.push(
      measure({
        id: `boss:${date}`,
        boss: true,
        memberIds: members.map((m) => m.item.id),
        courseIds: members.map((m) => m.item.courseId),
        title: `${members.length}-front encounter: ${members.map((m) => m.item.title).join(" / ")}`,
        workType: workTypes.size === 1 ? [...workTypes][0]! : "mixed",
        dueAt: members.reduce((earliest, m) => (m.dueAt < earliest ? m.dueAt : earliest), members[0]!.dueAt),
        dueDate: date,
        daysAway,
        distanceDays,
        minutesNeeded,
        minutesBanked,
        tier: 5,
        gradeShare,
      }),
    );
  }

  for (const p of placed) {
    if (merged.has(p.item.id)) continue;
    encounters.push(
      measure({
        id: p.item.id,
        boss: false,
        memberIds: [p.item.id],
        courseIds: [p.item.courseId],
        title: p.item.title,
        workType: p.item.workType,
        dueAt: p.dueAt,
        dueDate: p.dueDate,
        daysAway: p.daysAway,
        distanceDays: p.distanceDays,
        minutesNeeded: p.minutesNeeded,
        minutesBanked: p.minutesBanked,
        tier: p.tier,
        gradeShare: p.gradeShare,
      }),
    );
  }

  encounters.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));

  const termWeeks = buildTermWeeks({
    workItems: open,
    bossDates: new Set([...heavyByDate].filter(([, g]) => g.length >= 2).map(([date]) => date)),
    today: epochMinutesToDate(startOfToday),
    ...(input.termStartDate ? { termStartDate: input.termStartDate } : {}),
    ...(input.termEndDate ? { termEndDate: input.termEndDate } : {}),
  });

  return {
    encounters,
    horizonDays,
    // Zero before the term opens, so the ring labels still read "1 (wk 1)" rather than
    // dropping the week numbering entirely. A student setting up in August is the ordinary
    // case, and it is the one moment the semester's week numbers are most worth showing.
    currentTermWeek: termWeekNumberFor(epochMinutesToDate(startOfToday), input),
    termWeeks,
    undatedCount,
    beyondCount,
  };

  /** Turns hours and a date into the verdict, in one place so both paths agree. */
  function measure(base: {
    id: string;
    boss: boolean;
    memberIds: string[];
    courseIds: string[];
    title: string;
    workType: string;
    dueAt: string;
    dueDate: string;
    daysAway: number;
    distanceDays: number;
    minutesNeeded: number;
    minutesBanked: number;
    tier: ThreatTier;
    gradeShare: number | null;
  }): RadarEncounter {
    const hoursNeeded = base.minutesNeeded / 60;
    const hoursBanked = base.minutesBanked / 60;
    const overdue = base.daysAway < 0;
    const hoursExpected = hoursNeeded * expectedFraction(base.daysAway, base.minutesNeeded);
    const readiness = hoursExpected <= 0 ? 1 : clamp01(hoursBanked / hoursExpected);
    const health = verdict(readiness, overdue);
    const dueMinutes = toEpochMinutes(base.dueAt);

    return {
      id: base.id,
      boss: base.boss,
      memberIds: base.memberIds,
      courseIds: base.courseIds,
      title: base.title,
      workType: base.workType,
      dueAt: base.dueAt,
      dueDate: base.dueDate,
      daysAway: base.daysAway,
      distanceDays: roundTo(base.distanceDays, 4),
      // Bearing repeats weekly, and spoke 0 is today — so a column read outward really is
      // the same weekday every week, whatever day of the week today happens to be.
      bearingIndex: ((base.daysAway % 7) + 7) % 7,
      dayOfWeek: new Date(dueMinutes * 60_000).getUTCDay(),
      tier: base.tier,
      gradeShare: base.gradeShare === null ? null : roundTo(base.gradeShare, 4),
      hoursNeeded: roundTo(hoursNeeded, 2),
      hoursBanked: roundTo(hoursBanked, 2),
      hoursExpected: roundTo(hoursExpected, 2),
      coverage: hoursNeeded <= 0 ? 1 : roundTo(clamp01(hoursBanked / hoursNeeded), 4),
      readiness: roundTo(readiness, 4),
      health,
      overdue,
      shortfallHours: roundTo(Math.max(0, hoursExpected - hoursBanked), 2),
      advice: adviceFor({ health, boss: base.boss, overdue, hoursExpected }),
    };
  }
}

/**
 * Which week of the term a date falls in, 1-based.
 *
 * Zero before the first day of instruction; null when the term has no dates at all. The
 * three answers are genuinely different — "the term has not started", "we are in week six"
 * and "nobody has told us when the term is" — and collapsing the first into the third loses
 * the week numbering for every student who sets up before classes begin.
 */
function termWeekNumberFor(
  date: string,
  input: { termStartDate?: string; termEndDate?: string },
): number | null {
  if (!input.termStartDate || !input.termEndDate) return null;
  const offset = dateToEpochMinutes(date) - dateToEpochMinutes(input.termStartDate);
  if (offset < 0) return 0;
  return Math.floor(offset / (7 * MINUTES_PER_DAY)) + 1;
}

/**
 * The term as one bar per week: projected workload, and which weeks contain a boss.
 *
 * Its job is the decision the radar itself cannot show — not what to do today, but which
 * week has room to steal hours from. Height is work *due* that week rather than booked, so
 * the shape does not change every time the plan is regenerated.
 */
function buildTermWeeks(input: {
  workItems: readonly WorkItem[];
  bossDates: ReadonlySet<string>;
  today: string;
  termStartDate?: string;
  termEndDate?: string;
}): RadarTermWeek[] {
  if (!input.termStartDate || !input.termEndDate) return [];

  const start = dateToEpochMinutes(input.termStartDate);
  const end = dateToEpochMinutes(input.termEndDate);
  if (end < start) return [];

  const weekCount = Math.floor((end - start) / (7 * MINUTES_PER_DAY)) + 1;
  if (weekCount <= 0 || weekCount > 60) return [];

  const weekOf = (date: string): number =>
    Math.floor((dateToEpochMinutes(date) - start) / (7 * MINUTES_PER_DAY));

  const hours = new Array<number>(weekCount).fill(0);
  for (const item of input.workItems) {
    if (item.dueAt === null) continue;
    const index = weekOf(epochMinutesToDate(toEpochMinutes(item.dueAt)));
    if (index < 0 || index >= weekCount) continue;
    hours[index] = hours[index]! + requiredMinutesFor(item) / 60;
  }

  const bossWeeks = new Set<number>();
  for (const date of input.bossDates) {
    const index = weekOf(date);
    if (index >= 0 && index < weekCount) bossWeeks.add(index);
  }

  const busiest = Math.max(...hours, 0);
  const currentIndex = weekOf(input.today);

  return hours.map((h, index) => ({
    weekNumber: index + 1,
    startDate: epochMinutesToDate(start + index * 7 * MINUTES_PER_DAY),
    hours: roundTo(h, 1),
    intensity: busiest > 0 ? roundTo(h / busiest, 4) : 0,
    isCurrent: index === currentIndex,
    isPast: index < currentIndex,
    hasBoss: bossWeeks.has(index),
  }));
}

export interface RadarSummary {
  inRange: number;
  provisioned: number;
  underPlanned: number;
  critical: number;
  /**
   * Share of in-range encounters that are on pace, 0..100. Rounded once, here, so every
   * caller shows the same number.
   */
  partyPercent: number;
  /** Hours that should already be booked and are not, across everything in range. */
  deficitHours: number;
}

/**
 * Counts what is inside a given horizon.
 *
 * Separate from `buildCampaignRadar` because the horizon is a zoom control the student
 * moves, and re-deriving the whole radar to change a headline number would mean the numbers
 * could drift from the markers they are counting.
 */
export function summarizeRadar(
  encounters: readonly RadarEncounter[],
  horizonDays: number,
): RadarSummary {
  const inRange = encounters.filter((e) => e.daysAway <= horizonDays);
  const provisioned = inRange.filter((e) => e.health === "ok").length;
  const underPlanned = inRange.filter((e) => e.health === "warn").length;
  const critical = inRange.filter((e) => e.health === "crit").length;
  const deficit = inRange.reduce((sum, e) => sum + e.shortfallHours, 0);

  return {
    inRange: inRange.length,
    provisioned,
    underPlanned,
    critical,
    partyPercent: inRange.length === 0 ? 100 : Math.round((provisioned / inRange.length) * 100),
    deficitHours: roundTo(deficit, 1),
  };
}

/**
 * The worst thing on the board, so the dossier is never empty and never neutral.
 *
 * Bosses outrank everything, then critical, then under-planned, then whatever is soonest.
 */
export function worstEncounter(
  encounters: readonly RadarEncounter[],
): RadarEncounter | null {
  const rank: Record<RadarHealth, number> = { crit: 0, warn: 1, ok: 2 };
  const sorted = [...encounters].sort((a, b) => {
    const ra = a.boss && a.health !== "ok" ? -1 : rank[a.health];
    const rb = b.boss && b.health !== "ok" ? -1 : rank[b.health];
    return ra - rb || a.daysAway - b.daysAway || a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}
