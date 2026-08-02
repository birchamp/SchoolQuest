import type {
  AvailabilityRule,
  Commitment,
  Course,
  MeetingPattern,
  ThemeName,
  WorkItem,
} from "@schoolquest/domain";

export interface Recommendation {
  rank: number;
  sessionId: string;
  workItemId: string;
  title: string;
  courseId: string;
  durationMinutes: number;
  startAt: string;
  reasonCodes: string[];
  explanation: string;
  tradeoff: string | null;
}

export interface PlannedSession {
  id: string;
  workItemId: string;
  courseId: string;
  startAt: string;
  endAt: string;
  minutes: number;
  locked: boolean;
  acceptedByUser: boolean;
  reasonCodes: string[];
  tradeoffCode: string | null;
}

export interface PlanRisk {
  level: "safe" | "watch" | "at_risk" | "decision_needed";
  code: string;
  workItemId: string | null;
  detail: string;
  explanation?: string;
}

export interface CourseStandingView {
  estimatedPercent: number | null;
  remainingWeightFraction: number;
  confidence: string;
}

/**
 * Derived progress for one course. Mirrors `CourseProgress` in the planning engine —
 * points are only ever real `pointsPossible` values, and `basis` says which measure the
 * number came from so the UI never implies precision it does not have.
 */
export interface CourseProgressView {
  courseId: string;
  itemsTotal: number;
  itemsDone: number;
  pointsTotal: number;
  pointsDone: number;
  pointsCoverage: number;
  completionFraction: number;
  /**
   * Which measure `completionFraction` came from. Never print a points figure when this
   * is `"items"`: that course's syllabus stated too few point values for one to mean
   * anything, and the engine has already refused to use them.
   */
  basis: "points" | "items";
}

export interface TermProgressView {
  courses: CourseProgressView[];
  itemsTotal: number;
  itemsDone: number;
  pointsTotal: number;
  pointsDone: number;
  pointsCoverage: number;
  completionFraction: number;
  basis: "points" | "items";
  /**
   * Focused minutes actually logged across the whole term, and the number of sessions
   * that produced them. Unlike points, these exist for every student from the first
   * completed block, and they only ever rise.
   */
  effortMinutes: number;
  sessionsCompleted: number;
}

/**
 * The week read as prepared session notes (packages/planning-engine/src/session-brief.ts,
 * docs/07-session-prep-design.md). Every field is derived from real work-item data on each
 * read; nothing here is stored or inferred.
 */
export type BlockKind =
  | "major_assessment"
  | "back_to_back"
  | "recurring"
  | "first_pass"
  | "short_block"
  | "sustained";

export type DayLoad = "heavy" | "steady" | "light" | "clear";

export interface EncounterGroupView {
  workItemId: string;
  courseId: string;
  title: string;
  date: string;
  startAt: string;
  minutes: number;
  blocks: number;
  kind: BlockKind;
  sessionIds: string[];
}

export interface DayShapeView {
  date: string;
  dayOfWeek: number;
  load: DayLoad;
  minutes: number;
  weightedHours: number;
  encounters: number;
  /** Something major is due this day, whether or not time is booked for it. */
  carriesAssessment: boolean;
}

export interface FallbackView {
  code: "SHORT_WINDOW" | "CRUX_DAY_LOST" | "SLACK_REMAINING" | "NO_SLACK";
  workItemIds: string[];
  minutes: number | null;
  date: string | null;
}

export interface MilestoneView {
  workItemId: string;
  courseId: string;
  title: string;
  workType: string;
  dueAt: string;
  /** Negative means it is past due and still open. */
  daysAway: number;
  /** Whether preparation has started. The number this feature exists for. */
  prepBlocks: number;
  prepMinutes: number;
  dueConfirmed: boolean;
}

export interface UndatedMilestoneView {
  workItemId: string;
  courseId: string;
  title: string;
  workType: string;
  prepBlocks: number;
  prepMinutes: number;
}

export interface SessionBriefView {
  spine: {
    workItemId: string;
    courseId: string;
    title: string;
    minutes: number;
    blocks: number;
    dueAt: string | null;
  } | null;
  crux: { date: string; load: DayLoad; carriesAssessment: boolean } | null;
  days: DayShapeView[];
  encounters: EncounterGroupView[];
  fallbacks: FallbackView[];
  milestones: MilestoneView[];
  undatedMilestones: UndatedMilestoneView[];
}

/**
 * Where a long project stands (packages/planning-engine/src/project-progress.ts).
 *
 * Health claims are measured against the student's real weekly capacity, never against how
 * much the current plan has booked: long work is paced, so a healthy project only ever
 * holds one horizon's blocks.
 */
export type ProjectHealth =
  | "past_due"
  | "not_started"
  | "on_track"
  | "crowding"
  | "will_not_fit"
  | "stalled"
  | "finished";

export interface ProjectProgressView {
  workItemId: string;
  courseId: string;
  title: string;
  workType: string;
  dueAt: string | null;
  dueConfirmed: boolean;
  daysAway: number | null;
  estimatedMinutes: number;
  /** True when a per-type default stood in because nobody estimated the effort. */
  effortIsAssumed: boolean;
  remainingMinutes: number;
  investedMinutes: number;
  completionFraction: number;
  bookedMinutes: number;
  /** Minutes per week needed from here to land on time; null with no known deadline. */
  neededPerWeekMinutes: number | null;
  daysSinceProgress: number | null;
  health: ProjectHealth;
  stages: { workItemId: string; title: string; done: boolean; dueAt: string | null }[];
}

export interface ProjectsSummaryView {
  investedMinutes: number;
  sessionsCompleted: number;
  bookedMinutes: number;
  projectsTotal: number;
  projectsFinished: number;
  projectsWillNotFit: number;
  projectsCrowding: number;
  projectsNotStarted: number;
  projectsStalled: number;
  projectsPastDue: number;
}

/**
 * One pool of time, divided across every course
 * (packages/planning-engine/src/course-load.ts).
 */
export type UpkeepStatus = "no_routine" | "current" | "slipping" | "behind";

export interface CourseLoadView {
  courseId: string;
  bookedMinutes: number;
  /** Share of everything booked this week, 0..1. */
  shareOfBooked: number;
  blocks: number;
  investedMinutes: number;
  openItems: number;
  openProjects: number;
  nextDueAt: string | null;
  nextDueTitle: string | null;
  upkeep: UpkeepStatus;
  upkeepOverdue: number;
  daysSinceProgress: number | null;
}

export interface TermLoadView {
  courses: CourseLoadView[];
  bookedMinutes: number;
  capacityMinutes: number;
  /** Capacity not yet spoken for. Room, never debt. */
  unbookedMinutes: number;
  coursesWithNothingBooked: number;
}

/** Where each meal falls (packages/planning-engine/src/meals.ts). */
export type MealStatus = "planned" | "reserved" | "squeezed" | "no_gap";

export interface MealBreakView {
  date: string;
  key: string;
  label: string;
  status: MealStatus;
  /** Epoch minutes. Null for "planned" (the student's own) and "no_gap". */
  start: number | null;
  end: number | null;
  minutes: number;
}

/** What the weeks that already happened have to say (planning-engine/interruptions.ts). */
export interface ReviewOccurrenceView {
  date: string;
  minutes: number;
  sessionIds: string[];
  cause: string | null;
}

export interface CommitmentProposalView {
  title: string;
  commitmentType: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  named: boolean;
}

export interface ReviewQuestionView {
  slotKey: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  weeks: number;
  minutesLost: number;
  occurrences: ReviewOccurrenceView[];
  proposal: CommitmentProposalView | null;
}

export interface WeeklyReviewView {
  questions: ReviewQuestionView[];
  minutesLost: number;
  unanswered: number;
}

/** Per-course verdict (packages/planning-engine/src/course-health.ts). */
export type HealthLevel = "at_risk" | "needs_attention" | "steady";

export interface CourseConcernView {
  code: string;
  level: Exclude<HealthLevel, "steady">;
  detail: string;
}

export interface CourseHealthView {
  courseId: string;
  level: HealthLevel;
  concerns: CourseConcernView[];
  bookedMinutes: number;
  blocks: number;
  openItems: number;
  nextDueAt: string | null;
  nextDueTitle: string | null;
  nextDueInDays: number | null;
  gradePercent: number | null;
  /** Zero whenever the graded work is not mapped to weighted categories — the common case. */
  gradedWeightFraction: number;
  gradedCount: number;
  targetPercent: number;
  targetIsOwn: boolean;
  ungradedResults: number;
}

export interface TermHealthView {
  courses: CourseHealthView[];
  coursesAtRisk: number;
  coursesNeedingAttention: number;
  coursesSteady: number;
  coursesUnplanned: number;
}

export interface PlanResponse {
  planVersionId?: string;
  planVersion?: { id: string; versionNumber: number; horizonStart: string; horizonEnd: string } | null;
  horizonStart?: string;
  horizonEnd?: string;
  capacity: { usedMinutes: number; availableMinutes: number };
  sessions: PlannedSession[];
  recommendations: Recommendation[];
  risks: PlanRisk[];
  unscheduledWorkItemIds: string[];
  courses: Course[];
  workItems: WorkItem[];
  standings: Record<string, CourseStandingView>;
  /** Absent only from the "no plan yet" response, which carries no courses either. */
  progress?: TermProgressView;
  /** Present on saved-plan reads; the generate response does not build one. */
  brief?: SessionBriefView;
  projects?: { rows: ProjectProgressView[]; summary: ProjectsSummaryView };
  courseLoad?: TermLoadView;
  /** Absent on plans generated before the engine started reporting the day's shape. */
  meals?: MealBreakView[];
  /** Present on saved-plan reads only; generating a plan does not look backwards. */
  review?: WeeklyReviewView;
  /** Present on saved-plan reads only. */
  health?: TermHealthView;
  /** The rest of the week, so an hour calendar can account for every hour and not just
   *  the booked ones. Present on saved-plan reads only. */
  meetingPatterns?: MeetingPattern[];
  commitments?: Commitment[];
  availabilityRules?: AvailabilityRule[];
}

export interface CoachActionView {
  type: string;
  label: string;
  payload: Record<string, string | number | boolean>;
}

export interface CoachMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions: CoachActionView[];
  refused: boolean;
  /** Present on optimistic messages that have not been persisted yet. */
  pending?: boolean;
}

export interface CoachReplyResponse {
  message: string;
  facts: string[];
  assumptions: string[];
  actions: CoachActionView[];
  guardVerdict: string;
  refused: boolean;
}

export interface MealWindowView {
  key: string;
  label: string;
  /** Earliest and latest the meal could move to on a busy day. */
  earliest: string;
  latest: string;
  /** Where it lands when nothing is in the way. */
  anchor: string;
  minutes: number;
}

export interface PlanningPreferencesView {
  maxDailyAcademicMinutes: number;
  preferredSessionMinutes: number;
  minSessionMinutes: number;
  maxSessionMinutes: number;
  breakMinutes: number;
  mealWindows: MealWindowView[];
  protectedDaysOfWeek: number[];
  deadlineBufferDays: number;
}

export interface Term {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  /** Absent from older payloads that predate preferences being returned. */
  planningPreferences?: PlanningPreferencesView;
  /** Breaks, finals and the week-numbering convention. Absent means nobody has supplied one. */
  calendar?: { exceptions: { date: string }[] };
}

export interface Me {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  theme: ThemeName;
  reducedMotion: boolean;
  detailMode: "reduced" | "standard" | "expanded";
}
