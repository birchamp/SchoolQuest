import type { Course, ThemeName, WorkItem } from "@schoolquest/domain";

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

export interface Term {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
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
