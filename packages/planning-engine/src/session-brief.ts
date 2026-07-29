import type { CognitiveDemand, WorkItem, WorkType } from "@schoolquest/domain";
import { toEpochMinutes } from "@schoolquest/domain";

/**
 * The week as prepared session notes rather than a grid of blocks.
 *
 * See `docs/07-session-prep-design.md` for the reasoning. In short: a Dungeon Master
 * preparing a session reads the terrain, picks the spine, paces the beats, preps
 * contingencies, and tracks which set pieces are approaching — and every one of those maps
 * onto something a student with time blindness and weak prioritisation actually needs. This
 * module computes all of it from fields the schema already carries.
 *
 * Everything here is theme-neutral by rule: `major_assessment`, never `set_piece`. Only
 * `@schoolquest/theme-language` is allowed to know the word "gauntlet".
 *
 * Pure and total. No LLM, no clock reads beyond the `now` it is handed, and no invented
 * numbers — where a field is absent the output says so instead of guessing.
 */

/** How much a block is likely to cost, beyond its length. */
const DEMAND_WEIGHT: Record<CognitiveDemand, number> = { low: 1, medium: 1.5, high: 2.2 };

/** Weighted hours per day above which a day is heavy, then steady, then light. */
const HEAVY_THRESHOLD = 6;
const STEADY_THRESHOLD = 3.5;

/** Blocks at or under this are the ones worth naming for a short window. */
const SHORT_BLOCK_MINUTES = 30;

/** Titles repeating at least this often in a course are the course's routine work. */
const RECURRING_THRESHOLD = 3;

/** Big enough to be a landmark on the term, and to deserve prep laid down in advance. */
const MILESTONE_TYPES: ReadonlySet<WorkType> = new Set<WorkType>([
  "exam",
  "presentation",
  "paper",
  "group_project",
]);

export type BlockKind =
  | "major_assessment"
  | "back_to_back"
  | "recurring"
  | "first_pass"
  | "short_block"
  | "sustained";

export type DayLoad = "heavy" | "steady" | "light" | "clear";

/** The minimum a scheduled block must expose to be briefed on. */
export interface BriefableSession {
  id: string;
  workItemId: string;
  startAt: string;
  minutes: number;
}

/**
 * One item's blocks on one day, collapsed into a single beat.
 *
 * Grouping is the point: a long assignment is split into several blocks, and listing them
 * separately printed the same title three times in a row with nothing to distinguish the
 * rows — which reads as a rendering fault and hides how much else the day holds.
 */
export interface EncounterGroup {
  workItemId: string;
  courseId: string;
  title: string;
  date: string;
  /** Earliest block in the group. */
  startAt: string;
  minutes: number;
  blocks: number;
  kind: BlockKind;
  sessionIds: string[];
}

export interface DayShape {
  date: string;
  dayOfWeek: number;
  load: DayLoad;
  minutes: number;
  /** Minutes weighted by cognitive demand, in hours. The pacing signal. */
  weightedHours: number;
  encounters: number;
  carriesAssessment: boolean;
}

export interface Fallback {
  code: "SHORT_WINDOW" | "CRUX_DAY_LOST" | "SLACK_REMAINING" | "NO_SLACK";
  /** Ids the sentence is about, so the client can name them without re-deriving. */
  workItemIds: string[];
  minutes: number | null;
  date: string | null;
}

export interface Milestone {
  workItemId: string;
  courseId: string;
  title: string;
  workType: WorkType;
  dueAt: string;
  /** Whole days from `now`. Negative means it has passed and is still open. */
  daysAway: number;
  /** Blocks already laid down before it — the number that says whether prep has started. */
  prepBlocks: number;
  prepMinutes: number;
  /** False when the due date came from inference rather than a confirmed statement. */
  dueConfirmed: boolean;
}

/**
 * Major work whose due date is not known.
 *
 * These are the reason this type exists rather than being folded into `Milestone`. In the
 * five-course test semester, twelve exam-type items were extracted and only three had a due
 * date the syllabus actually stated — so an arc built solely from dated work showed three
 * landmarks for a whole term and silently omitted every exam. Dropping them would hide the
 * most important fact on the screen: there is an exam coming and nobody knows when.
 */
export interface UndatedMilestone {
  workItemId: string;
  courseId: string;
  title: string;
  workType: WorkType;
  /** Blocks already scheduled for it. Prep laid for an undated exam is worth surfacing. */
  prepBlocks: number;
  prepMinutes: number;
}

export interface SessionBrief {
  /** The one thing the week turns on, or null when nothing is scheduled. */
  spine: {
    workItemId: string;
    courseId: string;
    title: string;
    minutes: number;
    blocks: number;
    dueAt: string | null;
  } | null;
  /** The day the week turns on. */
  crux: { date: string; load: DayLoad; carriesAssessment: boolean } | null;
  days: DayShape[];
  encounters: EncounterGroup[];
  fallbacks: Fallback[];
  milestones: Milestone[];
  undatedMilestones: UndatedMilestone[];
}

export interface SessionBriefInput {
  sessions: readonly BriefableSession[];
  workItems: readonly WorkItem[];
  /** ISO instant. Only used for milestone distance and short-window relevance. */
  now: string;
  horizonStart: string;
  horizonDays: number;
  /** Unscheduled capacity left in the horizon, when the caller knows it. */
  slackMinutes?: number;
}

export function buildSessionBrief(input: SessionBriefInput): SessionBrief {
  const itemsById = new Map(input.workItems.map((w) => [w.id, w]));
  const recurringTitles = findRecurringTitles(input.workItems);
  const dueCountByDate = countItemsDueByDate(input.workItems);

  const encounters = groupEncounters(input.sessions, itemsById);
  const withKinds = encounters.map((group) => ({
    ...group,
    kind: classify(group, itemsById.get(group.workItemId), recurringTitles, dueCountByDate),
  }));

  const milestoneDueDates = new Set(
    input.workItems
      .filter((i) => MILESTONE_TYPES.has(i.workType) && i.dueAt && isOpen(i.status))
      .map((i) => i.dueAt!.slice(0, 10)),
  );

  const days = shapeDays(
    withKinds,
    itemsById,
    input.horizonStart,
    input.horizonDays,
    milestoneDueDates,
  );
  const crux = pickCrux(days);
  const spine = pickSpine(withKinds, itemsById);

  return {
    spine,
    crux,
    days,
    encounters: withKinds,
    fallbacks: buildFallbacks(withKinds, itemsById, crux, input),
    milestones: buildMilestones(input.workItems, input.sessions, input.now),
    undatedMilestones: buildUndatedMilestones(input.workItems, input.sessions),
  };
}

/** Still owed: not finished, not cancelled. */
function isOpen(status: string): boolean {
  return status !== "completed" && status !== "submitted" && status !== "canceled";
}

/**
 * Titles that recur across a course — a weekly log, a discussion post. Trailing numbers are
 * stripped so "Lab Notebook 3" and "Lab Notebook 7" count as the same routine.
 */
function findRecurringTitles(items: readonly WorkItem[]): Set<string> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = `${item.courseId}:${normalizeTitle(item.title)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, n]) => n >= RECURRING_THRESHOLD).map(([key]) => key),
  );
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[#\d]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countItemsDueByDate(items: readonly WorkItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.dueAt) continue;
    const date = item.dueAt.slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return counts;
}

function groupEncounters(
  sessions: readonly BriefableSession[],
  itemsById: Map<string, WorkItem>,
): Omit<EncounterGroup, "kind">[] {
  const groups = new Map<string, Omit<EncounterGroup, "kind">>();

  for (const session of [...sessions].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const date = session.startAt.slice(0, 10);
    const key = `${session.workItemId}:${date}`;
    const existing = groups.get(key);
    if (existing) {
      existing.minutes += session.minutes;
      existing.blocks += 1;
      existing.sessionIds.push(session.id);
      continue;
    }
    const item = itemsById.get(session.workItemId);
    groups.set(key, {
      workItemId: session.workItemId,
      courseId: item?.courseId ?? "",
      title: item?.title ?? "Study session",
      date,
      startAt: session.startAt,
      minutes: session.minutes,
      blocks: 1,
      sessionIds: [session.id],
    });
  }

  return [...groups.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/**
 * Order matters here, and it encodes a judgement: what the block *is* outranks how long it
 * is. An exam is a set piece even when its block is short, and three blocks of one thing in
 * a day is a gauntlet even if each block is brief.
 */
function classify(
  group: Omit<EncounterGroup, "kind">,
  item: WorkItem | undefined,
  recurringTitles: Set<string>,
  dueCountByDate: Map<string, number>,
): BlockKind {
  // The set piece is the day the thing is actually due, not every block of preparation
  // leading up to it. Classifying on work type alone made 12 of 23 beats in the test
  // semester a "set piece" — a 30-minute revision block for an exam three weeks out was
  // being given the same weight as the exam. If everything is the climax, nothing is.
  if (
    item &&
    MILESTONE_TYPES.has(item.workType) &&
    item.dueAt &&
    group.date === item.dueAt.slice(0, 10)
  ) {
    return "major_assessment";
  }

  if (group.blocks >= 3 || (dueCountByDate.get(group.date) ?? 0) >= 3) return "back_to_back";

  if (item && recurringTitles.has(`${item.courseId}:${normalizeTitle(item.title)}`)) {
    return "recurring";
  }

  // Untouched work gets named as a first look, because starting is the hard part and a
  // block labelled "reconnaissance" asks less of the student than one labelled with the
  // whole assignment.
  if (item && item.status === "not_started" && item.remainingMinutes === item.estimatedMinutes) {
    return "first_pass";
  }

  if (group.minutes <= SHORT_BLOCK_MINUTES) return "short_block";
  return "sustained";
}

function shapeDays(
  encounters: EncounterGroup[],
  itemsById: Map<string, WorkItem>,
  horizonStart: string,
  horizonDays: number,
  dueDatesOfMilestones: Set<string>,
): DayShape[] {
  const byDate = new Map<string, EncounterGroup[]>();
  for (const group of encounters) {
    byDate.set(group.date, [...(byDate.get(group.date) ?? []), group]);
  }

  return Array.from({ length: horizonDays }, (_, offset) => {
    const date = addDays(horizonStart, offset);
    const groups = byDate.get(date) ?? [];

    let minutes = 0;
    let weighted = 0;
    for (const group of groups) {
      const demand = itemsById.get(group.workItemId)?.cognitiveDemand ?? "medium";
      minutes += group.minutes;
      weighted += group.minutes * DEMAND_WEIGHT[demand];
    }
    const weightedHours = weighted / 60;
    // A day is a set-piece day when something major is *due* on it, whether or not the plan
    // put a block there. An exam you have not scheduled any time for is still the day's
    // event — arguably more so.
    const carriesAssessment = dueDatesOfMilestones.has(date);

    return {
      date,
      dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
      // A day holding the event itself is never "light", however short the block is —
      // the exam is the day's weight whatever the calendar says.
      load: carriesAssessment
        ? weightedHours >= HEAVY_THRESHOLD
          ? "heavy"
          : "steady"
        : loadFor(weightedHours),
      minutes,
      weightedHours: Math.round(weightedHours * 100) / 100,
      encounters: groups.length,
      carriesAssessment,
    };
  });
}

function loadFor(weightedHours: number): DayLoad {
  if (weightedHours >= HEAVY_THRESHOLD) return "heavy";
  if (weightedHours >= STEADY_THRESHOLD) return "steady";
  return weightedHours > 0 ? "light" : "clear";
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The day the week turns on: the set piece if there is one, otherwise the heaviest. */
function pickCrux(days: DayShape[]): SessionBrief["crux"] {
  const candidates = days.filter((d) => d.load !== "clear");
  if (candidates.length === 0) return null;

  const assessment = candidates.filter((d) => d.carriesAssessment);
  const pool = assessment.length > 0 ? assessment : candidates;
  const crux = pool.reduce((best, d) => (d.weightedHours > best.weightedHours ? d : best));
  return { date: crux.date, load: crux.load, carriesAssessment: crux.carriesAssessment };
}

/**
 * The spine: the item holding the most of the week, tie-broken by the nearer due date.
 *
 * Deliberately *not* the highest-priority item. Priority answers "what next"; the spine
 * answers "what is this week about", and that is the thing the week actually spends itself
 * on. A student who remembers one fact from this screen should remember this one.
 */
function pickSpine(
  encounters: EncounterGroup[],
  itemsById: Map<string, WorkItem>,
): SessionBrief["spine"] {
  const totals = new Map<string, { minutes: number; blocks: number }>();
  for (const group of encounters) {
    const running = totals.get(group.workItemId) ?? { minutes: 0, blocks: 0 };
    totals.set(group.workItemId, {
      minutes: running.minutes + group.minutes,
      blocks: running.blocks + group.blocks,
    });
  }
  if (totals.size === 0) return null;

  const ranked = [...totals.entries()].sort((a, b) => {
    if (b[1].minutes !== a[1].minutes) return b[1].minutes - a[1].minutes;
    const dueA = itemsById.get(a[0])?.dueAt;
    const dueB = itemsById.get(b[0])?.dueAt;
    if (dueA && dueB) return dueA.localeCompare(dueB);
    // A known due date outranks an unknown one, which is the only ordering that does not
    // require inventing a deadline.
    return dueA ? -1 : dueB ? 1 : 0;
  });

  const [workItemId, total] = ranked[0]!;
  const item = itemsById.get(workItemId);
  return {
    workItemId,
    courseId: item?.courseId ?? "",
    title: item?.title ?? "Study session",
    minutes: total.minutes,
    blocks: total.blocks,
    dueAt: item?.dueAt ?? null,
  };
}

/**
 * The DM's "if the party…" lines.
 *
 * Every one is computed against this week's actual blocks. Generic advice would be worse
 * than nothing here — a student who has read "try breaking it into smaller pieces" once has
 * read it enough.
 */
function buildFallbacks(
  encounters: EncounterGroup[],
  itemsById: Map<string, WorkItem>,
  crux: SessionBrief["crux"],
  input: SessionBriefInput,
): Fallback[] {
  const fallbacks: Fallback[] = [];
  const nowMinutes = toEpochMinutes(input.now);

  // If the window is small: the shortest block still ahead, so "I only have 25 minutes"
  // has a real answer rather than a suggestion to find more time.
  const upcoming = encounters
    .filter((g) => toEpochMinutes(g.startAt) >= nowMinutes - 30)
    .sort((a, b) => a.minutes - b.minutes);
  const shortest = upcoming[0];
  if (shortest) {
    fallbacks.push({
      code: "SHORT_WINDOW",
      workItemIds: [shortest.workItemId],
      minutes: shortest.minutes,
      date: shortest.date,
    });
  }

  // If the crux day is lost: which items actually break. An item breaks when all of its
  // scheduled time is on that day or later and it is due within two days after it — there
  // is then nowhere left to put the work.
  if (crux) {
    const cruxEnd = toEpochMinutes(`${crux.date}T23:59:00Z`);
    const atRisk = new Set<string>();
    for (const [workItemId, groups] of groupByItem(encounters)) {
      const item = itemsById.get(workItemId);
      if (!item?.dueAt) continue;
      const dueMinutes = toEpochMinutes(item.dueAt);
      if (dueMinutes > cruxEnd + 2 * 24 * 60) continue;
      const allOnOrAfter = groups.every(
        (g) => g.date >= crux.date && toEpochMinutes(g.startAt) <= dueMinutes,
      );
      if (allOnOrAfter) atRisk.add(workItemId);
    }
    if (atRisk.size > 0) {
      fallbacks.push({
        code: "CRUX_DAY_LOST",
        workItemIds: [...atRisk],
        minutes: null,
        date: crux.date,
      });
    }
  }

  // What room there is. An honest "none" is more useful than silence, because it tells the
  // student that anything new this week displaces something rather than adding to it.
  if (input.slackMinutes !== undefined) {
    fallbacks.push({
      code: input.slackMinutes > 0 ? "SLACK_REMAINING" : "NO_SLACK",
      workItemIds: [],
      minutes: Math.max(0, input.slackMinutes),
      date: null,
    });
  }

  return fallbacks;
}

function groupByItem(encounters: EncounterGroup[]): Map<string, EncounterGroup[]> {
  const byItem = new Map<string, EncounterGroup[]>();
  for (const group of encounters) {
    byItem.set(group.workItemId, [...(byItem.get(group.workItemId) ?? []), group]);
  }
  return byItem;
}

/**
 * The set pieces on the term's horizon, with how much preparation is already laid down.
 *
 * `prepBlocks` is the number this whole feature exists for. A calendar tells a student an
 * exam is on the 14th; it does not tell them whether they have started. "Final in 40 days,
 * nothing prepared yet" is the sentence that gets acted on, and nothing in the app said it
 * before.
 *
 * Prep counts any block for the item scheduled before it is due, plus blocks for items
 * whose title marks them as preparation for it. Sessions are counted across every plan
 * version the caller passes, not just the current week.
 */
function buildMilestones(
  workItems: readonly WorkItem[],
  sessions: readonly BriefableSession[],
  now: string,
): Milestone[] {
  const nowMinutes = toEpochMinutes(now);
  const blocksByItem = countBlocksByItem(sessions);

  return workItems
    .filter(
      (item) => MILESTONE_TYPES.has(item.workType) && item.dueAt !== null && isOpen(item.status),
    )
    .map((item) => {
      const prep = blocksByItem.get(item.id) ?? { blocks: 0, minutes: 0 };
      return {
        workItemId: item.id,
        courseId: item.courseId,
        title: item.title,
        workType: item.workType,
        dueAt: item.dueAt!,
        daysAway: Math.floor((toEpochMinutes(item.dueAt!) - nowMinutes) / (24 * 60)),
        prepBlocks: prep.blocks,
        prepMinutes: prep.minutes,
        dueConfirmed: item.sourceConfidence === "confirmed",
      };
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

function countBlocksByItem(
  sessions: readonly BriefableSession[],
): Map<string, { blocks: number; minutes: number }> {
  const byItem = new Map<string, { blocks: number; minutes: number }>();
  for (const session of sessions) {
    const running = byItem.get(session.workItemId) ?? { blocks: 0, minutes: 0 };
    byItem.set(session.workItemId, {
      blocks: running.blocks + 1,
      minutes: running.minutes + session.minutes,
    });
  }
  return byItem;
}

/**
 * Major work that has no date at all.
 *
 * Kept separate rather than filtered away. An exam nobody has dated is not less important
 * than a dated one — it is the same exam with a missing fact, and the missing fact is
 * exactly what a student needs prompting about. `prepBlocks` sharpens it further: time
 * already booked against an undated exam means the plan is guessing.
 */
function buildUndatedMilestones(
  workItems: readonly WorkItem[],
  sessions: readonly BriefableSession[],
): UndatedMilestone[] {
  const blocksByItem = countBlocksByItem(sessions);

  return workItems
    .filter(
      (item) => MILESTONE_TYPES.has(item.workType) && item.dueAt === null && isOpen(item.status),
    )
    .map((item) => {
      const prep = blocksByItem.get(item.id) ?? { blocks: 0, minutes: 0 };
      return {
        workItemId: item.id,
        courseId: item.courseId,
        title: item.title,
        workType: item.workType,
        prepBlocks: prep.blocks,
        prepMinutes: prep.minutes,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
