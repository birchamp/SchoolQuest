import type {
  AvailabilityRule,
  Commitment,
  Course,
  GradeResult,
  GradingCategory,
  MeetingPattern,
  ThemeName,
  WorkItem,
} from "@schoolquest/domain";
import type {
  BlockKind,
  CampaignRadar,
  CommitmentProposal,
  CourseConcern,
  CourseHealth,
  CourseLoad,
  CourseProgress,
  DayLoad,
  DayShape,
  EncounterGroup,
  Fallback,
  HealthLevel,
  MealBreak,
  MealStatus,
  Milestone,
  PlanDiff,
  PlanDiffBlock,
  ProjectHealth,
  ProjectProgress,
  RadarEncounter,
  RiskCode,
  ReviewOccurrence,
  ReviewQuestion,
  SessionBrief,
  TermEffortSummary,
  TermHealth,
  TermLoad,
  TermProgress,
  UndatedMilestone,
  UpkeepStatus,
  WeeklyReview,
} from "@schoolquest/planning-engine";

/**
 * The radar crosses the wire verbatim, so the view type is the engine's own rather than a
 * hand-kept mirror of it. A mirror of twenty fields is a mirror that drifts, and every field
 * here is a number the student reads off the screen.
 */
export type RadarEncounterView = RadarEncounter;
export type CampaignRadarView = CampaignRadar;

export interface Recommendation {
  rank: number;
  sessionId: string;
  /** "planned" or "started". Absent from a freshly generated plan, whose blocks are all planned. */
  status?: string;
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
  /** Present on saved-plan reads (a row's status); absent on a freshly generated plan. */
  status?: string;
  locked: boolean;
  acceptedByUser: boolean;
  reasonCodes: string[];
  tradeoffCode: string | null;
}

export interface PlanRisk {
  level: "safe" | "watch" | "at_risk" | "decision_needed";
  code: RiskCode;
  workItemId: string | null;
  detail: string;
  explanation?: string;
}

export interface CourseStandingView {
  estimatedPercent: number | null;
  remainingWeightFraction: number;
  confidence: string;
  /** Per grading category; only what the views read is typed here. */
  categories?: { passFailCount: number }[];
}

/*
 * The derived views below cross the wire exactly as the engine builds them -- the API hands the
 * engine's objects to `c.json` untouched, and every field is already a string, number, boolean
 * or null, so serialization changes nothing. They are therefore the engine's own types, under
 * the names the screens already use, rather than hand-kept copies that drift. Where the API
 * adds to an engine object, the addition is spelled out on top of the engine type.
 *
 * Kept as local declarations elsewhere in this file, on purpose: sessions, risks and
 * recommendations (saved-plan reads rebuild them from stored rows, without the engine's
 * `movementCost`, with a `status` and prose `explanation` it never has, and with codes an older
 * planner may have written), and everything that is not an engine output at all.
 */

/**
 * Derived progress for one course (packages/planning-engine/src/progress.ts). Points are only
 * ever real `pointsPossible` values, and `basis` says which measure the number came from so
 * the UI never implies precision it does not have.
 */
export type CourseProgressView = CourseProgress;

/**
 * The engine's term progress, plus the effort the API adds from the sessions table: focused
 * minutes actually logged across the whole term, and the number of sessions that produced
 * them. Unlike points, these exist for every student from the first completed block, and they
 * only ever rise.
 */
export type TermProgressView = TermProgress & {
  effortMinutes: number;
  sessionsCompleted: number;
};

/**
 * The week read as prepared session notes (packages/planning-engine/src/session-brief.ts,
 * docs/07-session-prep-design.md). Every field is derived from real work-item data on each
 * read; nothing here is stored or inferred.
 */
export type { BlockKind, DayLoad };
export type EncounterGroupView = EncounterGroup;
export type DayShapeView = DayShape;
export type FallbackView = Fallback;
export type MilestoneView = Milestone;
export type UndatedMilestoneView = UndatedMilestone;
export type SessionBriefView = SessionBrief;

/**
 * Where a long project stands (packages/planning-engine/src/project-progress.ts).
 *
 * Health claims are measured against the student's real weekly capacity, never against how
 * much the current plan has booked: long work is paced, so a healthy project only ever
 * holds one horizon's blocks.
 */
export type { ProjectHealth };
export type ProjectProgressView = ProjectProgress;
export type ProjectsSummaryView = TermEffortSummary;

/**
 * One pool of time, divided across every course
 * (packages/planning-engine/src/course-load.ts).
 */
export type { UpkeepStatus };
export type CourseLoadView = CourseLoad;
export type TermLoadView = TermLoad;

/** Where each meal falls (packages/planning-engine/src/meals.ts). */
export type { MealStatus };
export type MealBreakView = MealBreak;

/** What the weeks that already happened have to say (planning-engine/interruptions.ts). */
export type ReviewOccurrenceView = ReviewOccurrence;
export type CommitmentProposalView = CommitmentProposal;
export type ReviewQuestionView = ReviewQuestion;
export type WeeklyReviewView = WeeklyReview;

/** Per-course verdict (packages/planning-engine/src/course-health.ts). */
export type { HealthLevel };
export type CourseConcernView = CourseConcern;
export type CourseHealthView = CourseHealth;
export type TermHealthView = TermHealth;

/** What a regenerate changed (packages/planning-engine/src/plan-diff.ts). Generate responses only. */
export type { PlanDiff, PlanDiffBlock };

export interface PlanResponse {
  planVersionId?: string;
  /** What this plan changed against the one it replaces. Generate responses only. */
  diff?: PlanDiff;
  planVersion?: {
    id: string;
    versionNumber: number;
    horizonStart: string;
    horizonEnd: string;
    createdAt?: string;
  } | null;
  /** When the server read this plan: a UTC instant. */
  asOf?: string;
  /** The zone the server read it in. */
  timeZone?: string;
  /** Made by an earlier planner, in an older time standard; rebuilt before it is shown. */
  stale?: boolean;
  horizonStart?: string;
  horizonEnd?: string;
  capacity: { usedMinutes: number; availableMinutes: number };
  sessions: PlannedSession[];
  recommendations: Recommendation[];
  risks: PlanRisk[];
  unscheduledWorkItemIds: string[];
  courses: Course[];
  workItems: WorkItem[];
  /** The grading scheme per course, so an item's worth can be shown by category weight when the
   *  syllabus gave no per-item points. Absent from the "no plan yet" response. */
  gradingCategories?: GradingCategory[];
  standings: Record<string, CourseStandingView>;
  /** Results already recorded. Absent from the "no plan yet" response. */
  grades?: GradeResult[];
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
  /** What is coming and whether time is set aside for it. Saved-plan reads only. */
  radar?: CampaignRadarView;
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
  /** "device": kept in step with the device the app is opened on. "pinned": stays put. */
  timezoneMode?: "device" | "pinned";
  theme: ThemeName;
  reducedMotion: boolean;
  detailMode: "reduced" | "standard" | "expanded";
  /** Whether screen and button counts go into the usage log. Absent on an older server: on. */
  shareUsage?: boolean;
}
