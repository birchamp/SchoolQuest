import { describe, expect, it } from "vitest";
import type {
  Course,
  CourseStanding,
  GradeResult,
  GradingCategory,
  WorkItem,
} from "@schoolquest/domain";
import { computeCourseHealth, DEFAULT_TARGET_PERCENT } from "./course-health.js";
import type { CourseLoad } from "./course-load.js";
import type { ProjectProgress } from "./project-progress.js";

const NOW = "2026-09-28T09:00:00.000Z";
const COURSE_ID = "crs_bio";

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: COURSE_ID,
    termId: "trm_t",
    name: "General Biology",
    code: "BIO 240",
    instructor: null,
    credits: null,
    colorToken: "azure",
    expectedWeeklyMinutes: null,
    targetGrade: null,
    gradingConfidence: "confirmed",
    ...overrides,
  };
}

function load(overrides: Partial<CourseLoad> = {}): CourseLoad {
  return {
    courseId: COURSE_ID,
    bookedMinutes: 180,
    shareOfBooked: 0.3,
    blocks: 4,
    investedMinutes: 0,
    openItems: 5,
    openProjects: 0,
    nextDueAt: null,
    nextDueTitle: null,
    upkeep: "current",
    upkeepOverdue: 0,
    daysSinceProgress: null,
    ...overrides,
  };
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_1",
    courseId: COURSE_ID,
    parentWorkItemId: null,
    title: "Problem set",
    description: null,
    workType: "problem_set",
    availableAt: null,
    dueAt: null,
    pointsPossible: null,
    gradingCategoryId: null,
    categorySharePercent: null,
    estimatedMinutes: null,
    remainingMinutes: null,
    cognitiveDemand: "medium",
    divisibility: "divisible",
    locationRequirement: "anywhere",
    status: "not_started",
    sourceConfidence: "confirmed",
    userPriority: 0,
    ...overrides,
  };
}

function standing(overrides: Partial<CourseStanding> = {}): CourseStanding {
  return {
    estimatedPercent: null,
    gradedWeightFraction: 0,
    remainingWeightFraction: 1,
    confidence: "unknown",
    categories: [],
    ...overrides,
  };
}

function category(weightPercent: number | null, id = "gcat_1"): GradingCategory {
  return { id, courseId: COURSE_ID, name: "Exams", weightPercent, dropRule: null, confidenceStatus: "confirmed" };
}

function build(input: {
  course?: Course;
  load?: CourseLoad;
  items?: WorkItem[];
  grades?: GradeResult[];
  categories?: GradingCategory[];
  standing?: CourseStanding;
  projects?: ProjectProgress[];
}) {
  const health = computeCourseHealth({
    courses: [input.course ?? course()],
    workItems: input.items ?? [],
    grades: input.grades ?? [],
    gradingCategories: input.categories ?? [],
    standings: { [COURSE_ID]: input.standing ?? standing() },
    load: [input.load ?? load()],
    projects: input.projects ?? [],
    now: NOW,
  });
  return health.courses[0]!;
}

const codes = (c: ReturnType<typeof build>) => c.concerns.map((x) => x.code);

describe("course health", () => {
  it("is steady when nothing is wrong", () => {
    const c = build({});
    expect(c.level).toBe("steady");
    expect(c.concerns).toEqual([]);
  });

  it("flags a course with open work and nothing booked this week", () => {
    const c = build({ load: load({ bookedMinutes: 0, blocks: 0, openItems: 4 }) });
    expect(codes(c)).toContain("UNPLANNED_WEEK");
    expect(c.level).toBe("needs_attention");
  });

  it("does not flag an unplanned week for a course with nothing left to do", () => {
    // A finished course has no work to book. Calling that unhealthy would be nonsense.
    const c = build({ load: load({ bookedMinutes: 0, blocks: 0, openItems: 0 }) });
    expect(c.level).toBe("steady");
  });

  it("flags a near deadline the week has not left room for", () => {
    const c = build({
      load: load({ bookedMinutes: 60 }),
      items: [
        item({ id: "wi_a", dueAt: "2026-09-29T23:59:00.000Z", estimatedMinutes: 240 }),
      ],
    });
    expect(codes(c)).toContain("DEADLINE_UNPREPARED");
  });

  it("does not flag a near deadline the week does cover", () => {
    const c = build({
      load: load({ bookedMinutes: 300 }),
      items: [item({ id: "wi_a", dueAt: "2026-09-29T23:59:00.000Z", estimatedMinutes: 240 })],
    });
    expect(codes(c)).not.toContain("DEADLINE_UNPREPARED");
  });

  it("ignores a deadline that is already handled", () => {
    const c = build({
      load: load({ bookedMinutes: 10 }),
      items: [
        item({ id: "wi_a", dueAt: "2026-09-29T23:59:00.000Z", estimatedMinutes: 240, status: "submitted" }),
      ],
    });
    expect(codes(c)).not.toContain("DEADLINE_UNPREPARED");
  });
});

describe("grades", () => {
  it("says nothing about grades when the term has simply not graded anything yet", () => {
    // The state of every course in the real five-course semester, and of any term in its
    // first weeks. Docking health here would paint every course red on day one.
    const c = build({ standing: standing({ estimatedPercent: null, gradedWeightFraction: 0 }) });
    expect(c.level).toBe("steady");
    expect(codes(c)).toEqual([]);
  });

  it("flags a standing below the default B floor", () => {
    const c = build({
      standing: standing({ estimatedPercent: 72, gradedWeightFraction: 0.4 }),
    });
    expect(codes(c)).toContain("GRADE_BELOW_TARGET");
    expect(c.level).toBe("at_risk");
    expect(c.targetPercent).toBe(DEFAULT_TARGET_PERCENT);
    expect(c.targetIsOwn).toBe(false);
  });

  it("judges against the student's own target when they set one", () => {
    const c = build({
      course: course({ targetGrade: 93 }),
      standing: standing({ estimatedPercent: 88, gradedWeightFraction: 0.5 }),
    });
    const concern = c.concerns.find((x) => x.code === "GRADE_BELOW_TARGET")!;
    expect(concern.detail).toContain("your target");
    expect(concern.detail).toContain("93%");
    expect(c.targetIsOwn).toBe(true);
  });

  it("is quiet about a target the student is meeting", () => {
    const c = build({ standing: standing({ estimatedPercent: 91, gradedWeightFraction: 0.5 }) });
    expect(codes(c)).not.toContain("GRADE_BELOW_TARGET");
  });

  it("will not judge a standing drawn from too little of the course", () => {
    // One 70% on a 5%-weight quiz is not "below a B", it is one quiz. Raising an alarm off
    // it would be both meaningless and the kind of alarm that does real damage.
    const c = build({ standing: standing({ estimatedPercent: 70, gradedWeightFraction: 0.05 }) });
    expect(codes(c)).not.toContain("GRADE_BELOW_TARGET");
    expect(c.gradePercent).toBe(70);
    expect(c.gradedWeightFraction).toBe(0.05);
  });

  it("flags work that came back and was never recorded", () => {
    const c = build({
      items: [
        item({ id: "wi_a", status: "submitted", dueAt: "2026-09-20T23:59:00.000Z" }),
        item({ id: "wi_b", status: "completed", dueAt: "2026-09-21T23:59:00.000Z" }),
      ],
    });
    const concern = c.concerns.find((x) => x.code === "GRADES_UNRECORDED")!;
    expect(concern.detail).toContain("2 finished");
    expect(c.ungradedResults).toBe(2);
  });

  it("does not chase a result the instructor cannot have posted yet", () => {
    const c = build({
      items: [item({ id: "wi_a", status: "submitted", dueAt: "2026-10-05T23:59:00.000Z" })],
    });
    expect(codes(c)).not.toContain("GRADES_UNRECORDED");
  });

  it("does not count work that already has a result", () => {
    const c = build({
      items: [item({ id: "wi_a", status: "completed", dueAt: "2026-09-20T23:59:00.000Z" })],
      grades: [
        {
          id: "grd_1",
          workItemId: "wi_a",
          pointsEarned: 18,
          pointsPossible: 20,
          letterGrade: null,
          postedAt: null,
          confirmationStatus: "confirmed",
          sourceDocumentId: null,
          dropped: false,
        },
      ],
    });
    expect(c.ungradedResults).toBe(0);
  });

  it("says so when the grading scheme does not add up", () => {
    // The real BIO 240 in the test semester: four categories summing to 90.
    const c = build({ categories: [category(50, "a"), category(40, "b")] });
    const concern = c.concerns.find((x) => x.code === "GRADE_STRUCTURE_INCOMPLETE")!;
    expect(concern.detail).toContain("90%");
  });

  it("says so when a category has no weight at all", () => {
    const c = build({ categories: [category(60, "a"), category(null, "b")] });
    expect(codes(c)).toContain("GRADE_STRUCTURE_INCOMPLETE");
  });

  it("accepts a scheme that adds up", () => {
    const c = build({ categories: [category(60, "a"), category(40, "b")] });
    expect(codes(c)).not.toContain("GRADE_STRUCTURE_INCOMPLETE");
  });

  it("carries the grade and its coverage together, always", () => {
    const c = build({ standing: standing({ estimatedPercent: 84, gradedWeightFraction: 0.22 }) });
    expect(c.gradePercent).toBe(84);
    expect(c.gradedWeightFraction).toBe(0.22);
  });
});

describe("projects and rhythm", () => {
  const project = (health: ProjectProgress["health"], title = "Research Paper") =>
    ({
      workItemId: "wi_p",
      courseId: COURSE_ID,
      title,
      workType: "paper",
      dueAt: null,
      dueConfirmed: true,
      daysAway: null,
      estimatedMinutes: 600,
      effortIsAssumed: false,
      remainingMinutes: 600,
      investedMinutes: 0,
      health,
    }) as unknown as ProjectProgress;

  it("treats a past-due project as needing a decision", () => {
    const c = build({ projects: [project("past_due")] });
    expect(c.level).toBe("at_risk");
    expect(codes(c)).toContain("PROJECT_PAST_DUE");
  });

  it("treats a project that will not fit as needing a decision", () => {
    const c = build({ projects: [project("will_not_fit")] });
    expect(c.level).toBe("at_risk");
  });

  it("treats a stalled project as attention, not alarm", () => {
    const c = build({ projects: [project("stalled")] });
    expect(c.level).toBe("needs_attention");
  });

  it("ignores a healthy project", () => {
    const c = build({ projects: [project("on_track")] });
    expect(c.level).toBe("steady");
  });

  it("flags routine work that has slipped", () => {
    const c = build({ load: load({ upkeep: "behind", upkeepOverdue: 3 }) });
    expect(codes(c)).toContain("UPKEEP_BEHIND");
  });

  it("flags a course that has gone quiet while work is still open", () => {
    const c = build({ load: load({ daysSinceProgress: 14, openItems: 3 }) });
    expect(codes(c)).toContain("GONE_QUIET");
  });

  it("does not call a finished course quiet", () => {
    const c = build({ load: load({ daysSinceProgress: 30, openItems: 0 }) });
    expect(codes(c)).not.toContain("GONE_QUIET");
  });
});

describe("the board as a whole", () => {
  it("puts the course needing most at the top", () => {
    const health = computeCourseHealth({
      courses: [
        course({ id: "crs_calm", name: "Calm" }),
        course({ id: "crs_bad", name: "Bad" }),
        course({ id: "crs_mid", name: "Mid" }),
      ],
      workItems: [],
      grades: [],
      gradingCategories: [],
      standings: {
        crs_bad: standing({ estimatedPercent: 61, gradedWeightFraction: 0.6 }),
      },
      load: [
        { ...load(), courseId: "crs_calm" },
        { ...load(), courseId: "crs_bad" },
        { ...load(), courseId: "crs_mid", bookedMinutes: 0, blocks: 0 },
      ],
      projects: [],
      now: NOW,
    });
    expect(health.courses.map((c) => c.courseId)).toEqual(["crs_bad", "crs_mid", "crs_calm"]);
    expect(health.coursesAtRisk).toBe(1);
    expect(health.coursesNeedingAttention).toBe(1);
    expect(health.coursesSteady).toBe(1);
    expect(health.coursesUnplanned).toBe(1);
  });

  it("works for any number of courses", () => {
    for (const n of [1, 3, 7]) {
      const health = computeCourseHealth({
        courses: Array.from({ length: n }, (_, i) => course({ id: `crs_${i}` })),
        workItems: [],
        grades: [],
        gradingCategories: [],
        standings: {},
        load: Array.from({ length: n }, (_, i) => ({ ...load(), courseId: `crs_${i}` })),
        projects: [],
        now: NOW,
      });
      expect(health.courses).toHaveLength(n);
    }
  });

  it("survives a course the load pass never saw", () => {
    const health = computeCourseHealth({
      courses: [course()],
      workItems: [],
      grades: [],
      gradingCategories: [],
      standings: {},
      load: [],
      projects: [],
      now: NOW,
    });
    expect(health.courses[0]!.level).toBe("steady");
    expect(health.courses[0]!.bookedMinutes).toBe(0);
  });

  it("counts days to the next deadline", () => {
    const c = build({ load: load({ nextDueAt: "2026-10-03T23:59:00.000Z", nextDueTitle: "Exam" }) });
    expect(c.nextDueInDays).toBe(5);
    expect(c.nextDueTitle).toBe("Exam");
  });

  it("orders concerns worst first", () => {
    const c = build({
      load: load({ bookedMinutes: 0, openItems: 3 }),
      projects: [
        {
          workItemId: "wi_p",
          courseId: COURSE_ID,
          title: "Paper",
          health: "past_due",
        } as unknown as ProjectProgress,
      ],
    });
    expect(c.concerns[0]!.level).toBe("at_risk");
  });
});

describe("judging a standing with no declared weights", () => {
  it("judges on recorded results when the course has no weighted categories", () => {
    // The common case: a student types in three exam scores and nothing maps to a category,
    // so computeCourseStanding reports a percentage with a graded-weight fraction of zero.
    // Gating on weight alone would have made this alarm unreachable for most students.
    const c = build({
      standing: standing({ estimatedPercent: 71, gradedWeightFraction: 0 }),
      items: [item({ id: "wi_a" }), item({ id: "wi_b" }), item({ id: "wi_c" })],
      grades: ["wi_a", "wi_b", "wi_c"].map((workItemId, i) => ({
        id: `grd_${i}`,
        workItemId,
        pointsEarned: 71,
        pointsPossible: 100,
        letterGrade: null,
        postedAt: null,
        confirmationStatus: "confirmed" as const,
        sourceDocumentId: null,
        dropped: false,
      })),
    });
    const concern = c.concerns.find((x) => x.code === "GRADE_BELOW_TARGET")!;
    expect(concern.detail).toContain("across 3 recorded results");
    expect(c.gradedCount).toBe(3);
  });

  it("still will not judge off one or two results", () => {
    const c = build({
      standing: standing({ estimatedPercent: 55, gradedWeightFraction: 0 }),
      items: [item({ id: "wi_a" }), item({ id: "wi_b" })],
      grades: ["wi_a", "wi_b"].map((workItemId, i) => ({
        id: `grd_${i}`,
        workItemId,
        pointsEarned: 55,
        pointsPossible: 100,
        letterGrade: null,
        postedAt: null,
        confirmationStatus: "confirmed" as const,
        sourceDocumentId: null,
        dropped: false,
      })),
    });
    expect(c.concerns.map((x) => x.code)).not.toContain("GRADE_BELOW_TARGET");
  });

  it("prefers the weight basis when weights are declared", () => {
    const c = build({
      standing: standing({ estimatedPercent: 71, gradedWeightFraction: 0.5 }),
      items: [item({ id: "wi_a" })],
      grades: [
        {
          id: "grd_1",
          workItemId: "wi_a",
          pointsEarned: 71,
          pointsPossible: 100,
          letterGrade: null,
          postedAt: null,
          confirmationStatus: "confirmed" as const,
          sourceDocumentId: null,
          dropped: false,
        },
      ],
    });
    expect(c.concerns.find((x) => x.code === "GRADE_BELOW_TARGET")!.detail).toContain(
      "50% of the course graded",
    );
  });
});
