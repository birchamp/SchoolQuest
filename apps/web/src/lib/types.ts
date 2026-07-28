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
