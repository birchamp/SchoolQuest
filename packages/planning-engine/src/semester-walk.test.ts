import { describe, expect, it } from "vitest";
import type { WorkItem, WorkSession } from "@schoolquest/domain";
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

describe("a whole semester, walked week by week", () => {
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
        availabilityRules: seed.availabilityRules,
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
    const totalItems = seed.workItems.length;
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
    expect(done).toBeGreaterThan(seed.workItems.length * 0.4);
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
