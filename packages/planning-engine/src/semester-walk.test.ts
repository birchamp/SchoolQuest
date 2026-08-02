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
function walkSemester(options: { availability?: AvailabilityRule[] } = {}): Walk {
const seed = {
  ...INGESTED_SEMESTER,
  // The engines want plain arrays they can hold on to; the fixture is shared across tests.
  workItems: INGESTED_SEMESTER.workItems.map((w) => structuredClone(w)),
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

  shortfalls.push({
    week: index + 1,
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

  it("concentrates rather than spreads — a known gap, recorded so it cannot be forgotten", () => {
    /**
     * This is the one thing overload exposes that the app does *not* currently handle well, and
     * it is asserted loosely on purpose: the test exists to make the behaviour visible and to
     * fail loudly if it gets worse, not to bless it.
     *
     * With eight hours against five courses the planner touches a median of three courses a
     * week and twice drops to one. The mechanism is not a bug in the ordinary sense —
     * `horizonAllocation` hands an item its *entire* remaining effort once the deadline is
     * inside the horizon, which is right when there is slack and ruinous when there is not. One
     * problem set due Friday can take nine of ten blocks, and four courses get nothing.
     *
     * Whether that is wrong is a product judgement rather than a defect. Finishing one thing
     * beats half-finishing five, sometimes; and in a five-course term where a student is already
     * drowning, partial credit in four courses usually beats full credit in one. Deciding it
     * needs a person, so this records the number and leaves the decision open.
     */
    const coverage = shortfalls.map((s) => s.coursesTouched);
    const sorted = [...coverage].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const total = shortfalls[0]!.coursesTotal;

    console.log(
      `\ncourse coverage under overload: median ${median} of ${total} per week, ` +
        `worst ${Math.min(...coverage)}, best ${Math.max(...coverage)}`,
    );

    // Never zero: a week that touches no course at all would be the deadlock this run exists
    // to rule out, and that guarantee is real.
    expect(Math.min(...coverage)).toBeGreaterThan(0);
    // The floor this must not slip below. If a change drops the median to one, the planner has
    // stopped spreading altogether and somebody should have to argue for that.
    expect(median).toBeGreaterThanOrEqual(2);
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
