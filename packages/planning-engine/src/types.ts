import type {
  AvailabilityRule,
  Commitment,
  Course,
  CourseStanding,
  Dependency,
  EnergyLevel,
  GradingCategory,
  LocationRequirement,
  MeetingPattern,
  PlanningPreferences,
  RiskLevel,
  WorkItem,
  WorkSession,
} from "@schoolquest/domain";
import type { ReasonCode, RiskCode, TradeoffCode } from "./reason-codes.js";

/**
 * Everything the engine needs, already normalized. The engine performs no I/O and
 * calls no LLM — it must be reproducible from this input alone (docs/08 §6).
 */
export interface PlanningInput {
  termId: string;
  /** Start of the operational horizon, "YYYY-MM-DD". */
  horizonStart: string;
  horizonDays: number;
  /** "Now" as an ISO instant. Nothing is scheduled before it. */
  now: string;
  preferences: PlanningPreferences;
  courses: Course[];
  gradingCategories: GradingCategory[];
  meetingPatterns: MeetingPattern[];
  commitments: Commitment[];
  availabilityRules: AvailabilityRule[];
  workItems: WorkItem[];
  dependencies: Dependency[];
  /** Sessions from the previous plan, used to keep replanning stable. */
  existingSessions: WorkSession[];
  /** Per-course standing, keyed by course id. Absent means "no grade data". */
  courseStandings?: Record<string, CourseStanding>;
  /** Deterministic tie-breaking seed. Same inputs + same seed => same plan. */
  seed?: number;
}

/** A contiguous stretch of time the student could actually work in. */
export interface CapacityWindow {
  start: number;
  end: number;
  energyLevel: EnergyLevel;
  location: LocationRequirement;
  /** Availability rules marked "hard" cannot be violated even to rescue a deadline. */
  hardness: "hard" | "soft";
}

/** The 0..1 components behind a priority score, kept separate so the UI can show the breakdown. */
export interface PriorityComponents {
  deadlinePressure: number;
  academicValue: number;
  projectLeverage: number;
  failureRisk: number;
  spacingNeed: number;
  contextFit: number;
  neglectPenalty: number;
  userPriority: number;
}

export interface PriorityScore {
  workItemId: string;
  score: number;
  components: PriorityComponents;
  reasonCodes: ReasonCode[];
  /** Multiplier below 1 that damps aggressive scheduling of uncertain data. */
  confidencePenalty: number;
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
  reasonCodes: ReasonCode[];
  tradeoffCode: TradeoffCode | null;
  /** How costly it is to move this block, 0..1. Drives minimal-change replanning. */
  movementCost: number;
}

export interface PlanRisk {
  level: RiskLevel;
  code: RiskCode;
  workItemId: string | null;
  detail: string;
}

export interface PlanRecommendation {
  rank: number;
  sessionId: string;
  workItemId: string;
  title: string;
  courseId: string;
  durationMinutes: number;
  startAt: string;
  reasonCodes: ReasonCode[];
  tradeoffCode: TradeoffCode | null;
}

export interface PlanningResult {
  planVersionId: string;
  algorithmVersion: string;
  horizonStart: string;
  horizonEnd: string;
  sessions: PlannedSession[];
  recommendations: PlanRecommendation[];
  risks: PlanRisk[];
  unscheduledWorkItemIds: string[];
  /** Minutes of capacity used vs available across the horizon. */
  capacity: { usedMinutes: number; availableMinutes: number };
  priorities: PriorityScore[];
}
