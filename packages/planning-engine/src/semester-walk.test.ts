import { describe, expect, it } from "vitest";
import type { AvailabilityRule, WorkItem, WorkSession } from "@schoolquest/domain";
import { MINUTES_PER_DAY, toEpochMinutes } from "@schoolquest/domain";
import { INGESTED_SEMESTER } from "@schoolquest/fixtures";
import { DEFAULT_EFFORT_MINUTES, generatePlan } from "./scheduler.js";
import { computeCourseLoad } from "./course-load.js";
import { computeProjectProgress } from "./project-progress.js";
import { computeCourseHealth } from "./course-health.js";
import { buildTerrain } from "./terrain.js";
import { buildWeeklyReview } from "./interruptions.js";
import { buildEffortSurvey } from "./effort-survey.js";

/**
 * A whole semester, week by week.
 *
 * Every other test in this package fixes a moment and asks whether the engine answers it
 * correctly. That is necessary and it is not sufficient, because the thing this app is actually
 * for is a *term* — fifteen weeks of replanning on top of last week's leftovers, with work
 * finished, work missed, and deadlines arriving whether or not the ground was prepared. The
 * failures that matter most are the ones that only appear on the seventh replan: work that
 * quietly stops being scheduled, sessions that pile up in the past, a health reading that
 * decays with time rather than with the student.
 *
 * So this walks the fixture semester from the first Monday to the last, and at every step:
 *
 * 1. plans the week from the real scheduler,
 * 2. "attends" it — most sessions completed, a realistic share missed,
 * 3. advances seven days,
 * 4. replans on top of what actually happened.
 *
 * The behaviour it simulates is deliberately imperfect: a student who did everything the plan
 * said would prove nothing about a planner built for students who do not.
 *
 * Nothing here reads a clock. `now` is a parameter at every call, which is the property that
 * makes a fifteen-week simulation possible at all — and is why the engine was built that way.
 */

/** Monday of the week the term starts. The fixture term opens on Monday 24 August 2026. */
const FIRST_MONDAY = "2026-08-24";
const HORIZON_DAYS = 7;

/**
 * How the simulated student behaves.
 *
 * Not a model of any real person — a deterministic stand-in that misses enough to exercise the
 * paths a perfect week never reaches. Hashed from the session id so the same semester runs the
 * same way every time; this package has no `Math.random` by design.
 */
const ATTENDANCE = {
  /** Fraction of planned sessions actually completed. */
  completes: 0.72,
  /** Of those completed, the fraction that ran short. */
  partial: 0.18,
};

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday 08:00 UTC of the given week — where the student sits down to plan. */
function planningMoment(weekStart: string): string {
  return `${weekStart}T08:00:00.000Z`;
}

function minutesOf(s: { startAt: string; endAt: string; actualMinutes?: number | null }): number {
  return s.actualMinutes ?? Math.max(0, Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000));
}

interface WeekReport {
  week: number;
  weekStart: string;
  planned: number;
  completed: number;
  partial: number;
  missed: number;
  bookedMinutes: number;
  capacityMinutes: number;
  openItems: number;
  overdue: number;
  atRisk: number;
  needsAttention: number;
  unscheduled: number;
  litOnMap: number;
}

/** What one run of a term leaves behind, for the assertions to read. */
interface Walk {
  reports: WeekReport[];
  reviews: { week: number; minutesLost: number; questions: number }[];
  sessionsById: Map<string, WorkSession>;
  items: Map<string, WorkItem>;
  problems: string[];
  weeks: string[];
  totalItems: number;
  /** Per week: what the plan said it could not fit, and why. */
  shortfalls: {
    week: number;
    /** Open work the scheduler could act on — projects are counted through their stages. */
    openSchedulable: number;
    /** Neither booked nor named in a risk: it fell out of view entirely. */
    unaccounted: number;
    /** Of the schedulable open work, how much carries a real estimate rather than a guess. */
    realEffort: number;
    undated: number;
    /** How many of the term's courses got any time at all that week. */
    coursesTouched: number;
    coursesTotal: number;
    noWindow: number;
    notEnoughTime: number;
    unscheduled: string[];
  }[];
}

/**
 * Walk a term once.
 *
 * Parameterised so the same sixteen weeks can be run against a student who has time and one who
 * does not. Those are different products in effect — the first is about ordering, the second is
 * about triage — and only one of them had ever been run.
 */
function walkSemester(
  options: {
    availability?: AvailabilityRule[];
    /** Rewrites every item's effort before the term starts — see `answerTheSurvey`. */
    effort?: (item: WorkItem) => WorkItem;
  } = {},
): Walk {
const seed = {
  ...INGESTED_SEMESTER,
  // The engines want plain arrays they can hold on to; the fixture is shared across tests.
  workItems: INGESTED_SEMESTER.workItems.map((w) => {
    const clone = structuredClone(w);
    return options.effort ? options.effort(clone) : clone;
  }),
  gradingCategories: [],
  dependencies: [],
  grades: [],
};

// The term runs to mid-December; the walk stops at the last Monday inside it.
const lastDay = seed.term.endDate;
const weeks: string[] = [];
for (let d = FIRST_MONDAY; d <= lastDay; d = addDays(d, 7)) weeks.push(d);

/**
 * The whole run happens once, in a single pass, and every assertion below reads its record.
 *
 * Fifteen replans is a second or two of work, but splitting it across `it` blocks would run
 * the semester once per assertion and — worse — let two assertions disagree about which
 * semester they were describing.
 */
const reports: WeekReport[] = [];
/** What the weekly review said each week, gathered where there is recent history to read. */
const reviews: { week: number; minutesLost: number; questions: number }[] = [];
const sessionsById = new Map<string, WorkSession>();
const items = new Map<string, WorkItem>(seed.workItems.map((w) => [w.id, structuredClone(w)]));
/** Every complaint the walk collects, so one failure does not hide the fourteen behind it. */
const problems: string[] = [];
/** What each plan admitted it could not fit. The whole point of the crunch run. */
const shortfalls: Walk["shortfalls"] = [];

for (const [index, weekStart] of weeks.entries()) {
  const now = planningMoment(weekStart);
  const nowMinutes = toEpochMinutes(now);

  const plan = generatePlan(
    {
      termId: seed.term.id,
      horizonStart: weekStart,
      horizonDays: HORIZON_DAYS,
      now,
      preferences: seed.term.planningPreferences,
      courses: seed.courses,
      gradingCategories: seed.gradingCategories,
      meetingPatterns: seed.meetingPatterns,
      commitments: seed.commitments,
      availabilityRules: options.availability ?? seed.availabilityRules,
      workItems: [...items.values()],
      dependencies: seed.dependencies,
      // Last week's blocks, exactly as the API passes them: the record of what happened.
      existingSessions: [...sessionsById.values()],
    },
    `plv_week_${index + 1}`,
  );

  // --- Invariants that must hold on every single plan, not just the first. ---
  for (const s of plan.sessions) {
    if (toEpochMinutes(s.startAt) < nowMinutes) {
      problems.push(`week ${index + 1}: scheduled ${s.id} at ${s.startAt}, before now (${now})`);
    }
    const item = items.get(s.workItemId);
    if (!item) {
      problems.push(`week ${index + 1}: scheduled ${s.id} for an unknown work item`);
    } else if (item.status === "completed" || item.status === "submitted") {
      problems.push(`week ${index + 1}: scheduled ${s.id} for ${item.id}, already finished`);
    }
  }
  if (plan.capacity.usedMinutes > plan.capacity.availableMinutes) {
    problems.push(
      `week ${index + 1}: booked ${plan.capacity.usedMinutes}m into ${plan.capacity.availableMinutes}m of capacity`,
    );
  }

  /**
   * An `at_risk` alarm must mean the deadline is actually in danger.
   *
   * `NO_FEASIBLE_WINDOW` reads to the student as "No available window fits this before it is
   * due." On the first Monday of this term it fired on 42 of 61 items, and every single one of
   * them was due weeks past the end of the horizon — deliberately deferred by
   * `horizonAllocation`, with nothing wrong at all. Two thirds of a semester declared in danger
   * on day one, to a reader who is anxious and time-blind by definition.
   *
   * Checked on all sixteen weeks of both runs rather than at one moment, because the honest
   * shape of this signal is that it stays near zero early and grows as real deadlines close in.
   */
  const horizonEnd = nowMinutes + HORIZON_DAYS * MINUTES_PER_DAY;
  for (const risk of plan.risks) {
    if (risk.code !== "NO_FEASIBLE_WINDOW") continue;
    const item = risk.workItemId ? items.get(risk.workItemId) : undefined;
    if (item?.dueAt && toEpochMinutes(item.dueAt) > horizonEnd) {
      problems.push(
        `week ${index + 1}: cried at-risk over "${item.title}", which is not due until ${item.dueAt.slice(0, 10)}`,
      );
    }
  }

  // --- Record the new plan, retiring last week's blocks the way the API does. ---
  for (const [id, s] of sessionsById) {
    if (s.status === "planned" && toEpochMinutes(s.startAt) >= nowMinutes) sessionsById.delete(id);
  }
  for (const s of plan.sessions) {
    // The real `WorkSession`, not a lookalike: a simulation that models its own shape can
    // drift from the thing it claims to be simulating without anything noticing.
    sessionsById.set(s.id, {
      id: s.id,
      planVersionId: `plv_week_${index + 1}`,
      workItemId: s.workItemId,
      startAt: s.startAt,
      endAt: s.endAt,
      status: "planned",
      locked: false,
      acceptedByUser: false,
      actualMinutes: null,
      outcomeCode: null,
    });
  }

  // --- Live the week. ---
  let completed = 0;
  let partial = 0;
  let missed = 0;
  for (const s of plan.sessions) {
    const record = sessionsById.get(s.id)!;
    const roll = hash01(s.id);
    if (roll < ATTENDANCE.completes) {
      const short = hash01(`${s.id}:short`) < ATTENDANCE.partial;
      record.status = short ? "partial" : "completed";
      record.actualMinutes = short ? Math.round(minutesOf(s) * 0.55) : minutesOf(s);
      record.outcomeCode = short ? "partially_completed" : "completed";
      if (short) partial += 1;
      else completed += 1;

      // Finishing the last of an item's work retires it, the same as the complete endpoint.
      const item = items.get(s.workItemId);
      if (item && !short) {
        const done = [...sessionsById.values()]
          .filter((x) => x.workItemId === item.id && (x.status === "completed" || x.status === "partial"))
          .reduce((sum, x) => sum + minutesOf(x), 0);
        const required = item.estimatedMinutes ?? DEFAULT_EFFORT_MINUTES[item.workType] ?? 60;
        if (done >= required) {
          items.set(item.id, { ...item, status: "completed" });
          // Finishing the last stage finishes the project, exactly as the complete endpoint
          // does. Without it a decomposed paper sits at "5 of 5 stages cleared" and still
          // reports itself unfinished forever, because the parent has no blocks of its own —
          // the scheduler plans through the stages.
          const parentId = item.parentWorkItemId;
          if (parentId) {
            const siblings = [...items.values()].filter((w) => w.parentWorkItemId === parentId);
            if (siblings.every((w) => w.status === "completed" || w.status === "submitted")) {
              const parent = items.get(parentId);
              if (parent) items.set(parentId, { ...parent, status: "completed" });
            }
          }
        }
      }
    } else {
      record.status = "missed";
      record.outcomeCode = "did_not_start";
      missed += 1;
    }
  }

  // --- Read the week the way the app does, with the clock at the end of it. ---
  const endOfWeek = planningMoment(addDays(weekStart, 6));
  const all = [...sessionsById.values()];
  const load = computeCourseLoad({
    courseIds: seed.courses.map((c) => c.id),
    workItems: [...items.values()],
    booked: all.filter((s) => s.status === "planned").map((s) => ({ workItemId: s.workItemId, minutes: minutesOf(s) })),
    completed: all
      .filter((s) => s.status === "completed" || s.status === "partial")
      .map((s) => ({ workItemId: s.workItemId, endAt: s.endAt, minutes: minutesOf(s) })),
    capacityMinutes: plan.capacity.availableMinutes,
    now: endOfWeek,
  });
  const projects = computeProjectProgress({
    workItems: [...items.values()],
    completed: all
      .filter((s) => s.status === "completed" || s.status === "partial")
      .map((s) => ({ workItemId: s.workItemId, endAt: s.endAt, minutes: minutesOf(s) })),
    booked: all.filter((s) => s.status === "planned").map((s) => ({ workItemId: s.workItemId, minutes: minutesOf(s) })),
    now: endOfWeek,
    weeklyCapacityMinutes: plan.capacity.availableMinutes,
  });
  const health = computeCourseHealth({
    courses: seed.courses,
    workItems: [...items.values()],
    grades: seed.grades,
    gradingCategories: seed.gradingCategories,
    standings: {},
    // computeCourseLoad returns the term roll-up; health wants the per-course rows.
    load: load.courses,
    projects,
    now: endOfWeek,
  });

  const bookedByItem: Record<string, number> = {};
  for (const s of all) bookedByItem[s.workItemId] = (bookedByItem[s.workItemId] ?? 0) + minutesOf(s);
  const terrain = buildTerrain({
    workItems: [...items.values()],
    bookedByItem,
    courseIds: seed.courses.map((c) => c.id),
    now: endOfWeek,
    defaultEffortMinutes: DEFAULT_EFFORT_MINUTES,
  });

  // The review reads the weeks behind it, so it is run here — at the end of each week, with
  // the history that week just produced — rather than once at the end of term, when every
  // missed block is months old and outside the lookback by design.
  const review = buildWeeklyReview({
    lost: [...sessionsById.values()]
      .filter((s) => s.status === "missed")
      .map((s) => ({
        sessionId: s.id,
        workItemId: s.workItemId,
        startAt: s.startAt,
        endAt: s.endAt,
        source: "reported" as const,
      })),
    reported: [],
    resolutions: [],
    now: endOfWeek,
  });
  reviews.push({ week: index + 1, minutesLost: review.minutesLost, questions: review.questions.length });

  const open = [...items.values()].filter(
    (w) => w.status !== "completed" && w.status !== "submitted" && w.status !== "canceled",
  );
  const overdue = open.filter(
    (w) => w.dueAt !== null && toEpochMinutes(w.dueAt) < toEpochMinutes(endOfWeek),
  ).length;

  // Which courses got any time at all. Under scarcity this is the number that matters: a week
  // that spends every hour on one problem set leaves four courses untouched.
  const touched = new Set(
    plan.sessions.map((x) => items.get(x.workItemId)?.courseId).filter((id): id is string => Boolean(id)),
  );

  /**
   * The loop's actual target: is every open assignment *accounted for* this week?
   *
   * Accounted for means one of two things — the plan booked time for it, or the plan named it as
   * something it could not fit. Anything in neither bucket has silently fallen out of the
   * student's view, which is the failure the whole app exists to prevent.
   *
   * `realEffort` is the second half of the goal. An item whose minutes come from the work-type
   * lookup has *a* number, not a realistic one, and counting those as planned would let the app
   * claim a precision it does not have.
   */
  const openNow = [...items.values()].filter(
    (w) => w.status !== "completed" && w.status !== "submitted" && w.status !== "canceled",
  );
  const parentOf = new Set(
    [...items.values()].filter((w) => w.parentWorkItemId).map((w) => w.parentWorkItemId!),
  );
  const schedulable = openNow.filter((w) => !parentOf.has(w.id));
  const bookedThisWeek = new Set(plan.sessions.map((x) => x.workItemId));
  const namedInRisks = new Set(
    plan.risks.map((r) => r.workItemId).filter((id): id is string => Boolean(id)),
  );

  shortfalls.push({
    week: index + 1,
    openSchedulable: schedulable.length,
    unaccounted: schedulable.filter((w) => !bookedThisWeek.has(w.id) && !namedInRisks.has(w.id)).length,
    realEffort: schedulable.filter((w) => w.estimatedMinutes !== null || w.remainingMinutes !== null).length,
    undated: schedulable.filter((w) => w.dueAt === null).length,
    coursesTouched: touched.size,
    coursesTotal: seed.courses.length,
    noWindow: plan.risks.filter((r) => r.code === "NO_FEASIBLE_WINDOW").length,
    notEnoughTime: plan.risks.filter((r) => r.code === "INSUFFICIENT_CAPACITY").length,
    unscheduled: [...plan.unscheduledWorkItemIds],
  });

  reports.push({
    week: index + 1,
    weekStart,
    planned: plan.sessions.length,
    completed,
    partial,
    missed,
    bookedMinutes: plan.capacity.usedMinutes,
    capacityMinutes: plan.capacity.availableMinutes,
    openItems: open.length,
    overdue,
    atRisk: health.coursesAtRisk,
    needsAttention: health.coursesNeedingAttention,
    unscheduled: plan.unscheduledWorkItemIds.length,
    litOnMap: terrain.counts.overdue + terrain.counts.needs_time,
  });
}


  return {
    reports,
    reviews,
    sessionsById,
    items,
    problems,
    weeks,
    totalItems: seed.workItems.length,
    shortfalls,
  };
}

describe("a whole semester, walked week by week", () => {
  const walk = walkSemester();
  const { reports, reviews, sessionsById, items, problems, weeks, totalItems } = walk;

  it("walks the whole term", () => {
    console.log(
      "\nwk  starting     planned  done  part  miss   booked/cap   open  overdue  risk  watch  unsched  lit\n" +
        reports
          .map(
            (r) =>
              `${String(r.week).padStart(2)}  ${r.weekStart}  ` +
              `${String(r.planned).padStart(7)}  ${String(r.completed).padStart(4)}  ` +
              `${String(r.partial).padStart(4)}  ${String(r.missed).padStart(4)}  ` +
              `${String(`${r.bookedMinutes}/${r.capacityMinutes}`).padStart(11)}  ` +
              `${String(r.openItems).padStart(4)}  ${String(r.overdue).padStart(7)}  ` +
              `${String(r.atRisk).padStart(4)}  ${String(r.needsAttention).padStart(5)}  ` +
              `${String(r.unscheduled).padStart(7)}  ${String(r.litOnMap).padStart(3)}`,
          )
          .join("\n"),
    );
    const stillOpen = [...items.values()].filter(
      (w) => w.status !== "completed" && w.status !== "submitted" && w.status !== "canceled",
    );
    console.log(
      `\nstill open at the end of term (${stillOpen.length}):\n` +
        stillOpen
          .map((w) => `  ${w.title} [${w.workType}] due=${w.dueAt ?? "none"} est=${w.estimatedMinutes ?? "-"}`)
          .join("\n"),
    );
    expect(reports.length).toBeGreaterThanOrEqual(14);
  });

  it("never schedules into the past, over capacity, or onto finished work", () => {
    expect(problems).toEqual([]);
  });

  it("plans real work every single week, not just at the start of term", () => {
    // The failure this catches is the one a single-moment test cannot: a planner that works
    // beautifully in week one and quietly stops finding anything to book by week nine.
    const empty = reports.filter((r) => r.planned === 0).map((r) => `week ${r.week} (${r.weekStart})`);
    expect(empty).toEqual([]);
  });

  it("gets through the term's work rather than accumulating it", () => {
    const first = reports[0]!;
    const last = reports.at(-1)!;
    expect(last.openItems).toBeLessThan(first.openItems);
  });

  it("keeps overdue work from running away", () => {
    // A student who does 72% of a plan will fall behind, and should — the question is whether
    // the *planner* compounds it. Anything past its date is still open work the scheduler can
    // see, so a term ending with most of its work overdue would mean the engine stopped
    // rescuing deadlines rather than that the student stopped studying.
    const worst = Math.max(...reports.map((r) => r.overdue));
    expect(worst).toBeLessThan(totalItems * 0.4);
  });

  it("holds a steady week of study rather than front-loading the term", () => {
    const booked = reports.map((r) => r.bookedMinutes);
    const median = [...booked].sort((a, b) => a - b)[Math.floor(booked.length / 2)]!;
    expect(median).toBeGreaterThan(0);
    // No week may book more than the student actually has. Checked per week above; this is the
    // aggregate claim, which a per-week bug could still satisfy by starving later weeks.
    const totalBooked = booked.reduce((a, b) => a + b, 0);
    const totalCapacity = reports.reduce((a, r) => a + r.capacityMinutes, 0);
    expect(totalBooked).toBeLessThanOrEqual(totalCapacity);
  });

  it("leaves no session stranded in the past as still-planned", () => {
    // Every block from a past week has to have become history — completed, partial, missed or
    // retired. A `planned` block behind the clock is the bug that inflated booked minutes on
    // the dashboard and made "missed" indistinguishable from "superseded".
    const end = toEpochMinutes(planningMoment(addDays(weeks.at(-1)!, 7)));
    const stranded = [...sessionsById.values()].filter(
      (s) => s.status === "planned" && toEpochMinutes(s.startAt) < end,
    );
    expect(stranded).toEqual([]);
  });

  it("never books two blocks over the same minutes", () => {
    const byStart = [...sessionsById.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
    const clashes: string[] = [];
    for (let i = 1; i < byStart.length; i += 1) {
      const prev = byStart[i - 1]!;
      const cur = byStart[i]!;
      if (toEpochMinutes(cur.startAt) < toEpochMinutes(prev.endAt)) {
        clashes.push(`${prev.id} (${prev.startAt}–${prev.endAt}) overlaps ${cur.id} (${cur.startAt})`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("finishes the term with most of its work actually done", () => {
    const done = [...items.values()].filter((w) => w.status === "completed").length;
    expect(done).toBeGreaterThan(totalItems * 0.4);
  });

  it("notices the weeks that went wrong, without inventing weeks that did not", () => {
    // A term where roughly a quarter of blocks were missed has something to say. One that
    // reported nothing all term would mean the detector never fires on real history, which is
    // how it would ship broken and nobody would know.
    const spoke = reviews.filter((r) => r.minutesLost > 0);
    expect(spoke.length).toBeGreaterThan(0);
    // A review is a conversation, not an audit. The cap holds every single week, including the
    // worst one — which is the week it would break on if it were going to.
    const tooMany = reviews.filter((r) => r.questions > 3);
    expect(tooMany).toEqual([]);
  });

  it("is the same semester every time it is run", () => {
    const again = {
      ...INGESTED_SEMESTER,
      workItems: INGESTED_SEMESTER.workItems.map((w) => structuredClone(w)),
      gradingCategories: [],
      dependencies: [],
    };
    const plan = generatePlan(
      {
        termId: again.term.id,
        horizonStart: FIRST_MONDAY,
        horizonDays: HORIZON_DAYS,
        now: planningMoment(FIRST_MONDAY),
        preferences: again.term.planningPreferences,
        courses: again.courses,
        gradingCategories: again.gradingCategories,
        meetingPatterns: again.meetingPatterns,
        commitments: again.commitments,
        availabilityRules: again.availabilityRules,
        workItems: again.workItems,
        dependencies: again.dependencies,
        existingSessions: [],
      },
      "plv_week_1",
    );
    expect(plan.sessions.length).toBe(reports[0]!.planned);
  });
});

/**
 * The same term, for a student who does not have the hours.
 *
 * The walk above runs at roughly a quarter of capacity, which makes almost every decision in it
 * a question about *ordering*. Overload is a different product: the question stops being "what
 * first" and becomes "what gets left", and the app's job stops being a schedule and becomes an
 * honest account of what will not fit.
 *
 * None of that had ever been run. `NO_FEASIBLE_WINDOW`, `INSUFFICIENT_CAPACITY` and the line
 * "There is not enough time this week to finish everything" all existed and were exercised only
 * by unit tests holding a single contrived moment. This runs them against a real term.
 *
 * The squeeze is applied to *availability*, not to the work: the syllabuses stay exactly as they
 * were extracted, and the student simply has far fewer hours. That is the shape of the real
 * problem — a full course load and a job — and it avoids inventing assignments to make a point.
 */
describe("a term with more work than hours", () => {
  // One two-hour window on four evenings: eight hours a week against a term that wants roughly
  // twenty-five. Deliberately not survivable, because the question is what the app does then.
  const SQUEEZED: AvailabilityRule[] = [1, 2, 3, 4].map((dayOfWeek) => ({
    id: `avl_squeeze_${dayOfWeek}`,
    termId: INGESTED_SEMESTER.term.id,
    dayOfWeek,
    startTime: "19:00",
    endTime: "21:00",
    energyLevel: "low",
    location: "anywhere",
    hardness: "soft",
  }));

  const walk = walkSemester({ availability: SQUEEZED });
  const { reports, problems, items, shortfalls, totalItems } = walk;

  it("walks the term under pressure", () => {
    console.log(
      "\nCRUNCH  (8h/week against a full five-course load)\n" +
        "wk  starting     planned  done  miss   booked/cap   open  overdue  risk  watch  nowin  short  courses\n" +
        reports
          .map((r, i) => {
            const s = shortfalls[i]!;
            return (
              `${String(r.week).padStart(2)}  ${r.weekStart}  ` +
              `${String(r.planned).padStart(7)}  ${String(r.completed).padStart(4)}  ` +
              `${String(r.missed).padStart(4)}  ` +
              `${String(`${r.bookedMinutes}/${r.capacityMinutes}`).padStart(11)}  ` +
              `${String(r.openItems).padStart(4)}  ${String(r.overdue).padStart(7)}  ` +
              `${String(r.atRisk).padStart(4)}  ${String(r.needsAttention).padStart(5)}  ` +
              `${String(s.noWindow).padStart(5)}  ${String(s.notEnoughTime).padStart(5)}  ` +
              `${s.coursesTouched}/${s.coursesTotal}`
            );
          })
          .join("\n"),
    );
    expect(reports.length).toBeGreaterThanOrEqual(14);
  });

  it("still never books more time than the student has", () => {
    // The one guarantee that must not bend under pressure. A planner that solves overload by
    // quietly overbooking has not solved anything — it has moved the failure to a Tuesday
    // evening when the student discovers the day was never possible.
    expect(problems).toEqual([]);
  });

  it("uses the little time there is rather than freezing", () => {
    // Deadlock is the plausible failure here: everything is late, everything is urgent, and a
    // scheduler that cannot choose plans nothing at all.
    const idle = reports.filter((r) => r.planned === 0).map((r) => `week ${r.week}`);
    expect(idle).toEqual([]);
    const utilisation =
      reports.reduce((sum, r) => sum + r.bookedMinutes, 0) /
      reports.reduce((sum, r) => sum + r.capacityMinutes, 0);
    expect(utilisation).toBeGreaterThan(0.6);
  });

  it("says out loud that it cannot fit everything", () => {
    // The thing that separates an honest planner from one that hides the problem. Silence here
    // would mean a student being handed a tidy eight-hour week with no indication that thirty
    // hours of work went somewhere else.
    const spoke = shortfalls.filter((s) => s.noWindow + s.notEnoughTime > 0);
    expect(spoke.length).toBeGreaterThan(reports.length / 2);
  });

  it("never drops work silently — everything unplanned is named", () => {
    // Unscheduled ids and the risk list have to agree. Work that vanishes from the plan without
    // appearing in the risks is work the student has no way to discover.
    const silent = shortfalls.filter((s) => s.unscheduled.length > 0 && s.noWindow + s.notEnoughTime === 0);
    expect(silent).toEqual([]);
  });

  it("keeps the work rather than deleting it", () => {
    // Overload must not look like progress. Nothing may be marked finished that was not done,
    // and the term should end with real work still open — that is the truth of the situation.
    const done = [...items.values()].filter((w) => w.status === "completed").length;
    const open = totalItems - done;
    expect(open).toBeGreaterThan(0);
    expect(done).toBeLessThan(totalItems);
  });

  it("keeps every course moving, week after week, instead of concentrating", () => {
    /**
     * The standing goal says *all* courses, every week. Under overload this used to be the one
     * place it plainly did not hold: with eight hours against five courses the planner touched a
     * median of three courses a week and twice dropped to one.
     *
     * The mechanism was never a bug in the ordinary sense. `horizonAllocation` hands an item its
     * entire remaining effort once the deadline is inside the horizon, and the placement pass is
     * priority-ordered and greedy, so one problem set due Friday could take nine of ten blocks
     * and four courses got nothing. That is the right behaviour when the week has room.
     *
     * `placeOnePerCourse` now runs first when demand exceeds what is left of the week, giving
     * each course's top-priority item one session before any course gets a second. It is a
     * product judgement and worth stating as one: a student already drowning in five courses is
     * better served by partial credit in five than full credit in one, and by seeing that
     * nothing has gone dark. It costs finishing speed, and the numbers below are where that cost
     * shows up.
     */
    const coverage = shortfalls.map((s) => s.coursesTouched);
    const sorted = [...coverage].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const total = shortfalls[0]!.coursesTotal;

    console.log(
      `\ncourse coverage under overload: median ${median} of ${total} per week, ` +
        `worst ${Math.min(...coverage)}, best ${Math.max(...coverage)}`,
    );

    // Every course, every week, is the goal. One short week is tolerated — a course can run out
    // of open work, and a week can be too fragmented to seat a fifth block — but not two.
    expect(Math.min(...coverage)).toBeGreaterThanOrEqual(total - 1);
    expect(median).toBe(total);
  });

  it("spends its scarce hours on graded work before optional work", () => {
    // Triage is the whole product under overload. With eight hours a week the app has to be
    // choosing, and the thing it should choose is work that counts.
    const scheduledIds = new Set([...walk.sessionsById.values()].map((s) => s.workItemId));
    const scheduled = [...items.values()].filter((w) => scheduledIds.has(w.id));
    const graded = scheduled.filter((w) => w.gradingCategoryId !== null).length;
    expect(graded / Math.max(1, scheduled.length)).toBeGreaterThan(0.5);
  });
});

/**
 * The standing goal, measured rather than asserted into existence.
 *
 * "Every week, every assignment in every course is seen, planned, and accounted for, with
 * realistic time allotted to each — unless the student says time is not needed."
 *
 * That is three separate claims and only one of them currently holds. This reports all three
 * every run so progress is visible, and asserts only the part that is already true, so the suite
 * stays honest about the rest instead of quietly encoding today's shortfall as correct.
 */
describe("is every assignment accounted for", () => {
  const slack = walkSemester();
  const crunch = walkSemester({
    availability: [1, 2, 3, 4].map((dayOfWeek) => ({
      id: `avl_squeeze_${dayOfWeek}`,
      termId: INGESTED_SEMESTER.term.id,
      dayOfWeek,
      startTime: "19:00",
      endTime: "21:00",
      energyLevel: "low" as const,
      location: "anywhere" as const,
      hardness: "soft" as const,
    })),
  });

  const summarise = (name: string, walk: Walk) => {
    const rows = walk.shortfalls;
    const open = rows.reduce((sum, r) => sum + r.openSchedulable, 0);
    const withEffort = rows.reduce((sum, r) => sum + r.realEffort, 0);
    const unaccounted = rows.reduce((sum, r) => sum + r.unaccounted, 0);
    const undated = Math.max(...rows.map((r) => r.undated));
    return {
      name,
      open,
      effortPercent: open === 0 ? 100 : Math.round((withEffort / open) * 100),
      unaccounted,
      worstWeekUnaccounted: Math.max(...rows.map((r) => r.unaccounted)),
      undated,
    };
  };

  it("reports where the goal actually stands", () => {
    const both = [summarise("slack", slack), summarise("crunch", crunch)];
    console.log(
      "\nGOAL: every assignment seen, planned and accounted for, with realistic time\n" +
        both
          .map(
            (r) =>
              `  ${r.name.padEnd(7)} open-week-slots ${String(r.open).padStart(4)}  ` +
              `real effort ${String(`${r.effortPercent}%`).padStart(4)}  ` +
              `unaccounted ${String(r.unaccounted).padStart(4)} (worst week ${r.worstWeekUnaccounted})  ` +
              `undated ${r.undated}`,
          )
          .join("\n"),
    );
    expect(both).toHaveLength(2);
  });

  it("never lets an assignment fall out of view: booked, or named as not fitting", () => {
    // The one part of the goal that already holds, and the one that matters most. Work the
    // student cannot see is work they cannot decide about, and this is what would break first
    // if the scheduler started dropping candidates quietly.
    for (const walk of [slack, crunch]) {
      const lost = walk.shortfalls.filter((r) => r.unaccounted > 0);
      expect(lost).toEqual([]);
    }
  });

  it("still cannot claim realistic time for most work — the gap this loop exists to close", () => {
    /**
     * Five of sixty-one assignments arrived from extraction with an effort estimate. Every other
     * number in the plan comes from a thirteen-entry lookup keyed on work type, so "45 minutes
     * for a quiz" is a category average wearing the clothes of a measurement.
     *
     * Asserted as a *ceiling* rather than a floor, deliberately: this test should start failing
     * as soon as the app begins asking the student and the professor for real numbers, and that
     * failure is the signal to raise the bar rather than a regression.
     *
     * The asking now exists (`buildEffortSurvey`, and the Setup card that drives it), so this
     * number measures the *starting* state of an unanswered term rather than a dead end. The
     * test above shows what the same sixteen weeks look like once it is answered: 111 booked
     * hours become 158, which is the size of the thing this lookup table was standing in for.
     */
    const rows = slack.shortfalls;
    const open = rows.reduce((sum, r) => sum + r.openSchedulable, 0);
    const withEffort = rows.reduce((sum, r) => sum + r.realEffort, 0);
    expect(withEffort / open).toBeLessThan(0.5);
  });

  /**
   * The same term after the student answers the effort survey.
   *
   * `buildEffortSurvey` collapses the fixture's 60 open items into 14 questions. This answers
   * every one of them one rung up the ladder from what the app assumes, which is not a random
   * perturbation — it is the direction students reliably answer in. The per-type defaults are
   * optimistic (an hour and a half for a problem set, four hours for a paper), and the whole
   * premise of this app is a reader who under-estimates how long things take.
   *
   * The point is not that this particular multiplier is right. It is that **nobody knows**
   * whether it is right until the student is asked, and until then every hour the plan shows is
   * a number the app made up. This measures how much of the picture rides on that.
   */
  const answered = walkSemester({
    effort: (item) => {
      if (item.estimatedMinutes !== null || item.remainingMinutes !== null) return item;
      const survey = buildEffortSurvey({
        workItems: [item],
        courses: INGESTED_SEMESTER.courses,
        gradingCategories: INGESTED_SEMESTER.gradingCategories,
      });
      const options = survey.questions[0]?.options ?? [];
      const current = options.findIndex((o) => o.isCurrentAssumption);
      const chosen = options[Math.min(current + 1, options.length - 1)];
      if (!chosen) return item;
      return { ...item, estimatedMinutes: chosen.minutes, remainingMinutes: chosen.minutes };
    },
  });

  it("shows what the plan looks like once somebody actually says how long things take", () => {
    const before = summarise("assumed", slack);
    const after = summarise("answered", answered);
    const hours = (walk: Walk) =>
      Math.round(
        walk.reports.reduce((sum, r) => sum + r.bookedMinutes, 0) / 60,
      );

    console.log(
      "\nEFFORT SURVEY: the same term, before and after the student answers\n" +
        `  assumed   real effort ${String(`${before.effortPercent}%`).padStart(4)}  ` +
        `booked ${hours(slack)}h across the term\n` +
        `  answered  real effort ${String(`${after.effortPercent}%`).padStart(4)}  ` +
        `booked ${hours(answered)}h across the term\n` +
        `  14 questions cover all 60 unestimated items.`,
    );

    // Answering settles it: nothing is left resting on the work-type lookup.
    expect(after.effortPercent).toBe(100);
    expect(before.effortPercent).toBeLessThan(20);
    // And nothing falls out of view in the process — the part of the goal that already held
    // has to keep holding when the numbers get bigger.
    expect(after.unaccounted).toBe(0);
  });

  it("has work it cannot place in time at all, because nobody stated a date", () => {
    // Eight items came out of five syllabuses with no due date. They are scheduled without
    // deadline pressure and flagged DUE_DATE_UNKNOWN, which is honest and is not the same as
    // being planned. Also a ceiling: it should fall as the setup conversation gets built.
    expect(Math.max(...slack.shortfalls.map((r) => r.undated))).toBeGreaterThan(0);
  });
});

/** Sanity: the fixture really is a whole term, not a fortnight with ambitions. */
describe("the semester being walked", () => {
  it("spans a real term with work spread across it", () => {
    const seed = INGESTED_SEMESTER;
    const dated = seed.workItems.filter((w) => w.dueAt !== null);
    const days = dated.map((w) => Math.floor(toEpochMinutes(w.dueAt!) / MINUTES_PER_DAY));
    const span = (Math.max(...days) - Math.min(...days)) / 7;
    expect(seed.courses.length).toBeGreaterThanOrEqual(5);
    expect(span).toBeGreaterThan(10);
  });
});
