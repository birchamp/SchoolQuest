import type {
  AvailabilityRule,
  Commitment,
  Course,
  Dependency,
  GradeResult,
  GradingCategory,
  MeetingPattern,
  Term,
  WorkItem,
  WorkSession,
} from "@schoolquest/domain";

/**
 * The seed scenario from docs/08-coding-agent-handoff.md §10. It is the regression
 * fixture for the planning engine and the demo data for a new account:
 *
 *  - Psychology: weekly reading + quiz, and a 250-point paper due in four weeks.
 *  - Education:  weekly reading + smaller quizzes, and a major project due in six weeks.
 *  - Two evening work shifts, fixed class meetings, and a 90-minute Tuesday library window.
 *  - Psychology is the weaker course.
 *  - Paper source research must happen before outlining.
 *
 * The expected behaviour: the Tuesday library window goes to psychology source research
 * rather than low-value reading, while the reading stays visibly protected later.
 */

/** Monday of the reference week. All fixture dates are relative to this. */
export const SEED_WEEK_START = "2026-09-07";
/** Monday 08:00 UTC — "now" for deterministic tests. */
export const SEED_NOW = "2026-09-07T08:00:00.000Z";

export interface SeedSemester {
  term: Term;
  courses: Course[];
  gradingCategories: GradingCategory[];
  meetingPatterns: MeetingPattern[];
  commitments: Commitment[];
  availabilityRules: AvailabilityRule[];
  workItems: WorkItem[];
  dependencies: Dependency[];
  grades: GradeResult[];
  existingSessions: WorkSession[];
}

export function buildSeedSemester(userId = "usr_seed"): SeedSemester {
  const term: Term = {
    id: "trm_fall",
    userId,
    name: "Fall 2026",
    startDate: "2026-08-31",
    endDate: "2026-12-18",
    status: "active",
    planningPreferences: {
      maxDailyAcademicMinutes: 240,
      preferredSessionMinutes: 45,
      minSessionMinutes: 20,
      maxSessionMinutes: 90,
      breakMinutes: 10,
      protectedDaysOfWeek: [],
      deadlineBufferDays: 1,
    },
  };

  const courses: Course[] = [
    {
      id: "crs_psych",
      termId: term.id,
      name: "Developmental Psychology",
      code: "PSY 210",
      instructor: "Dr. Alvarez",
      credits: 3,
      colorToken: "violet",
      expectedWeeklyMinutes: 360,
      targetGrade: 90,
      gradingConfidence: "confirmed",
    },
    {
      id: "crs_edu",
      termId: term.id,
      name: "Foundations of Childhood Education",
      code: "EDU 240",
      instructor: "Prof. Nakamura",
      credits: 3,
      colorToken: "emerald",
      expectedWeeklyMinutes: 300,
      targetGrade: 90,
      gradingConfidence: "confirmed",
    },
  ];

  const gradingCategories: GradingCategory[] = [
    {
      id: "gcat_psych_major",
      courseId: "crs_psych",
      name: "Major Projects",
      weightPercent: 40,
      dropRule: null,
      confidenceStatus: "confirmed",
    },
    {
      id: "gcat_psych_quiz",
      courseId: "crs_psych",
      name: "Quizzes",
      weightPercent: 30,
      dropRule: { dropLowest: 1 },
      confidenceStatus: "confirmed",
    },
    {
      id: "gcat_psych_reading",
      courseId: "crs_psych",
      name: "Reading Responses",
      weightPercent: 30,
      dropRule: null,
      confidenceStatus: "confirmed",
    },
    {
      id: "gcat_edu_major",
      courseId: "crs_edu",
      name: "Major Projects",
      weightPercent: 35,
      dropRule: null,
      confidenceStatus: "confirmed",
    },
    {
      id: "gcat_edu_quiz",
      courseId: "crs_edu",
      name: "Quizzes",
      weightPercent: 25,
      dropRule: { dropLowest: 1 },
      confidenceStatus: "confirmed",
    },
    {
      id: "gcat_edu_reading",
      courseId: "crs_edu",
      name: "Readings",
      weightPercent: 40,
      dropRule: null,
      confidenceStatus: "confirmed",
    },
  ];

  const meetingPatterns: MeetingPattern[] = [
    {
      id: "mtg_psych",
      courseId: "crs_psych",
      daysOfWeek: [1, 3], // Monday, Wednesday
      startTime: "10:00",
      endTime: "11:15",
      location: "Harmon Hall 204",
      effectiveStart: term.startDate,
      effectiveEnd: term.endDate,
    },
    {
      id: "mtg_edu",
      courseId: "crs_edu",
      daysOfWeek: [2, 4], // Tuesday, Thursday
      startTime: "09:00",
      endTime: "10:15",
      location: "Education Building 110",
      effectiveStart: term.startDate,
      effectiveEnd: term.endDate,
    },
  ];

  const commitments: Commitment[] = [
    {
      id: "cmt_shift_tue",
      termId: term.id,
      title: "Work shift",
      commitmentType: "work",
      daysOfWeek: [2],
      startTime: "17:00",
      endTime: "22:00",
      specificDate: null,
      flexibility: "fixed",
      locked: true,
    },
    {
      id: "cmt_shift_fri",
      termId: term.id,
      title: "Work shift",
      commitmentType: "work",
      daysOfWeek: [5],
      startTime: "17:00",
      endTime: "22:00",
      specificDate: null,
      flexibility: "fixed",
      locked: true,
    },
    {
      id: "cmt_meals",
      termId: term.id,
      title: "Dinner",
      commitmentType: "meal",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: "18:00",
      endTime: "18:45",
      specificDate: null,
      flexibility: "flexible",
      locked: false,
    },
  ];

  /**
   * Tuesday 13:00-14:30 is the library window the scenario turns on: the only
   * high-energy, library-capable block in the week.
   */
  const availabilityRules: AvailabilityRule[] = [
    weekday("avl_mon_pm", term.id, 1, "13:00", "17:00", "medium", "anywhere"),
    weekday("avl_tue_library", term.id, 2, "13:00", "14:30", "high", "library"),
    weekday("avl_tue_pm", term.id, 2, "14:30", "16:30", "medium", "anywhere"),
    weekday("avl_wed_pm", term.id, 3, "13:00", "17:00", "high", "anywhere"),
    weekday("avl_thu_pm", term.id, 4, "11:00", "16:00", "medium", "anywhere"),
    weekday("avl_fri_am", term.id, 5, "10:00", "15:00", "low", "anywhere"),
    weekday("avl_sat", term.id, 6, "10:00", "15:00", "medium", "anywhere"),
    weekday("avl_sun", term.id, 0, "12:00", "18:00", "high", "anywhere"),
  ];

  const workItems: WorkItem[] = [
    // --- Psychology: the 250-point paper, decomposed into milestones.
    {
      ...baseWorkItem(),
      id: "wi_psych_paper",
      courseId: "crs_psych",
      title: "Developmental Analysis Paper",
      description: "8-10 page analysis of a developmental case, APA format.",
      workType: "paper",
      dueAt: "2026-10-05T23:59:00.000Z",
      pointsPossible: 250,
      gradingCategoryId: "gcat_psych_major",
      estimatedMinutes: 600,
      remainingMinutes: 600,
      cognitiveDemand: "high",
    },
    {
      ...baseWorkItem(),
      id: "wi_psych_sources",
      courseId: "crs_psych",
      parentWorkItemId: "wi_psych_paper",
      title: "Find three psychology sources",
      workType: "milestone",
      dueAt: "2026-09-13T23:59:00.000Z",
      estimatedMinutes: 90,
      remainingMinutes: 90,
      cognitiveDemand: "high",
      // The constraint that makes the Tuesday library window the right answer.
      locationRequirement: "library",
    },
    {
      ...baseWorkItem(),
      id: "wi_psych_outline",
      courseId: "crs_psych",
      parentWorkItemId: "wi_psych_paper",
      title: "Outline the paper against the rubric",
      workType: "milestone",
      dueAt: "2026-09-20T23:59:00.000Z",
      estimatedMinutes: 90,
      remainingMinutes: 90,
      cognitiveDemand: "high",
    },
    {
      ...baseWorkItem(),
      id: "wi_psych_draft",
      courseId: "crs_psych",
      parentWorkItemId: "wi_psych_paper",
      title: "Write the full draft",
      workType: "milestone",
      dueAt: "2026-09-29T23:59:00.000Z",
      estimatedMinutes: 240,
      remainingMinutes: 240,
      cognitiveDemand: "high",
    },
    {
      ...baseWorkItem(),
      id: "wi_psych_revise",
      courseId: "crs_psych",
      parentWorkItemId: "wi_psych_paper",
      title: "Revise against the rubric and proofread",
      workType: "milestone",
      dueAt: "2026-10-04T23:59:00.000Z",
      estimatedMinutes: 120,
      remainingMinutes: 120,
      cognitiveDemand: "medium",
    },

    // --- Psychology recurring coursework.
    {
      ...baseWorkItem(),
      id: "wi_psych_reading_w2",
      courseId: "crs_psych",
      title: "Read chapter 4: Cognitive development",
      workType: "reading",
      dueAt: "2026-09-09T10:00:00.000Z",
      pointsPossible: 10,
      gradingCategoryId: "gcat_psych_reading",
      estimatedMinutes: 60,
      remainingMinutes: 60,
      cognitiveDemand: "low",
    },
    {
      ...baseWorkItem(),
      id: "wi_psych_quiz_w2",
      courseId: "crs_psych",
      title: "Quiz 2: Chapters 3-4",
      workType: "quiz_prep",
      dueAt: "2026-09-11T10:00:00.000Z",
      pointsPossible: 25,
      gradingCategoryId: "gcat_psych_quiz",
      estimatedMinutes: 45,
      remainingMinutes: 45,
      cognitiveDemand: "medium",
    },

    // --- Education: major project due in six weeks.
    {
      ...baseWorkItem(),
      id: "wi_edu_project",
      courseId: "crs_edu",
      title: "Childhood Education Field Project",
      description: "Observation log, analysis, and presentation.",
      workType: "group_project",
      dueAt: "2026-10-19T23:59:00.000Z",
      pointsPossible: 200,
      gradingCategoryId: "gcat_edu_major",
      estimatedMinutes: 720,
      remainingMinutes: 720,
      cognitiveDemand: "high",
    },
    {
      ...baseWorkItem(),
      id: "wi_edu_site",
      courseId: "crs_edu",
      parentWorkItemId: "wi_edu_project",
      title: "Confirm observation site and permissions",
      workType: "milestone",
      dueAt: "2026-09-18T23:59:00.000Z",
      estimatedMinutes: 60,
      remainingMinutes: 60,
      cognitiveDemand: "medium",
    },
    {
      ...baseWorkItem(),
      id: "wi_edu_observe",
      courseId: "crs_edu",
      parentWorkItemId: "wi_edu_project",
      title: "Complete first observation session",
      workType: "milestone",
      dueAt: "2026-09-27T23:59:00.000Z",
      estimatedMinutes: 120,
      remainingMinutes: 120,
      cognitiveDemand: "medium",
      locationRequirement: "campus",
    },

    // --- Education recurring coursework.
    {
      ...baseWorkItem(),
      id: "wi_edu_reading_w2",
      courseId: "crs_edu",
      title: "Read: Play-based learning models",
      workType: "reading",
      dueAt: "2026-09-10T09:00:00.000Z",
      pointsPossible: 15,
      gradingCategoryId: "gcat_edu_reading",
      estimatedMinutes: 50,
      remainingMinutes: 50,
      cognitiveDemand: "low",
    },
    {
      ...baseWorkItem(),
      id: "wi_edu_quiz_w2",
      courseId: "crs_edu",
      title: "Quiz 2: Foundations",
      workType: "quiz_prep",
      dueAt: "2026-09-15T09:00:00.000Z",
      pointsPossible: 20,
      gradingCategoryId: "gcat_edu_quiz",
      estimatedMinutes: 40,
      remainingMinutes: 40,
      cognitiveDemand: "medium",
    },
  ];

  /** Source gathering informs the outline, which informs the draft, which informs revision. */
  const dependencies: Dependency[] = [
    {
      id: "dep_sources_outline",
      predecessorWorkItemId: "wi_psych_sources",
      successorWorkItemId: "wi_psych_outline",
      dependencyType: "finish_to_start",
    },
    {
      id: "dep_outline_draft",
      predecessorWorkItemId: "wi_psych_outline",
      successorWorkItemId: "wi_psych_draft",
      dependencyType: "finish_to_start",
    },
    {
      id: "dep_draft_revise",
      predecessorWorkItemId: "wi_psych_draft",
      successorWorkItemId: "wi_psych_revise",
      dependencyType: "finish_to_start",
    },
    {
      id: "dep_site_observe",
      predecessorWorkItemId: "wi_edu_site",
      successorWorkItemId: "wi_edu_observe",
      dependencyType: "finish_to_start",
    },
  ];

  /**
   * Psychology is the weaker course: one confirmed low quiz score against a solid
   * education score. The pending psychology reading grade must NOT count as zero.
   */
  const grades: GradeResult[] = [
    {
      id: "grd_psych_quiz1",
      workItemId: "wi_psych_quiz_w2",
      pointsEarned: 17,
      pointsPossible: 25,
      letterGrade: null,
      postedAt: "2026-09-04T18:00:00.000Z",
      confirmationStatus: "confirmed",
      sourceDocumentId: null,
      dropped: false,
    },
    {
      id: "grd_psych_reading1",
      workItemId: "wi_psych_reading_w2",
      pointsEarned: null, // Submitted, not graded yet.
      pointsPossible: 10,
      letterGrade: null,
      postedAt: null,
      confirmationStatus: "confirmed",
      sourceDocumentId: null,
      dropped: false,
    },
    {
      id: "grd_edu_quiz1",
      workItemId: "wi_edu_quiz_w2",
      pointsEarned: 19,
      pointsPossible: 20,
      letterGrade: null,
      postedAt: "2026-09-04T18:00:00.000Z",
      confirmationStatus: "confirmed",
      sourceDocumentId: null,
      dropped: false,
    },
  ];

  return {
    term,
    courses,
    gradingCategories,
    meetingPatterns,
    commitments,
    availabilityRules,
    workItems,
    dependencies,
    grades,
    existingSessions: [],
  };
}

function baseWorkItem() {
  return {
    parentWorkItemId: null,
    description: null,
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
  } satisfies Omit<WorkItem, "id" | "courseId" | "title" | "workType">;
}

function weekday(
  id: string,
  termId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  energyLevel: AvailabilityRule["energyLevel"],
  location: AvailabilityRule["location"],
): AvailabilityRule {
  return { id, termId, dayOfWeek, startTime, endTime, energyLevel, location, hardness: "soft" };
}
