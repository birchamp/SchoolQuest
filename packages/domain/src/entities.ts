import { z } from "zod";
import {
  cognitiveDemand,
  commitmentType,
  confidenceStatus,
  dependencyType,
  detailMode,
  divisibility,
  energyLevel,
  flexibility,
  gradeConfirmation,
  hardness,
  locationRequirement,
  outcomeCode,
  riskLevel,
  sessionStatus,
  termStatus,
  themeName,
  workStatus,
  workType,
} from "./enums.js";

/** ISO-8601 instant, always stored in UTC. Local rendering uses the user's timezone. */
export const isoDateTime = z.string().datetime({ offset: true });
/** Calendar date with no time component, e.g. "2026-09-07". */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
/** Wall-clock time of day, e.g. "14:30". */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
/** 0 = Sunday, matching JavaScript's Date#getDay. */
export const dayOfWeek = z.number().int().min(0).max(6);

export const user = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  timezone: z.string(),
  theme: themeName.default("plain"),
  reducedMotion: z.boolean().default(false),
  detailMode: detailMode.default("standard"),
  createdAt: isoDateTime,
});
export type User = z.infer<typeof user>;

export const planningPreferences = z.object({
  /** Hard ceiling on scheduled academic minutes in a single day. */
  maxDailyAcademicMinutes: z.number().int().positive().default(300),
  preferredSessionMinutes: z.number().int().positive().default(45),
  minSessionMinutes: z.number().int().positive().default(20),
  maxSessionMinutes: z.number().int().positive().default(120),
  breakMinutes: z.number().int().nonnegative().default(10),
  /** Days the scheduler must leave empty unless the user explicitly overrides. */
  protectedDaysOfWeek: z.array(dayOfWeek).default([]),
  /** Days of slack the scheduler reserves before a high-value deadline. */
  deadlineBufferDays: z.number().int().nonnegative().default(1),
});
export type PlanningPreferences = z.infer<typeof planningPreferences>;

export const term = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  status: termStatus.default("planning"),
  planningPreferences: planningPreferences.default({}),
});
export type Term = z.infer<typeof term>;

export const gradingCategory = z.object({
  id: z.string(),
  courseId: z.string(),
  name: z.string(),
  weightPercent: z.number().min(0).max(100).nullable(),
  /** e.g. { "dropLowest": 1 } — null when the syllabus says nothing. */
  dropRule: z.record(z.unknown()).nullable().default(null),
  confidenceStatus: confidenceStatus.default("unknown"),
});
export type GradingCategory = z.infer<typeof gradingCategory>;

export const course = z.object({
  id: z.string(),
  termId: z.string(),
  name: z.string().min(1),
  code: z.string().nullable(),
  instructor: z.string().nullable(),
  credits: z.number().nullable(),
  colorToken: z.string().default("slate"),
  expectedWeeklyMinutes: z.number().int().nonnegative().nullable(),
  /** Target grade as a percentage, if the student stated one. */
  targetGrade: z.number().min(0).max(100).nullable(),
  gradingConfidence: confidenceStatus.default("unknown"),
});
export type Course = z.infer<typeof course>;

export const meetingPattern = z.object({
  id: z.string(),
  courseId: z.string(),
  daysOfWeek: z.array(dayOfWeek),
  startTime: timeOfDay,
  endTime: timeOfDay,
  location: z.string().nullable(),
  effectiveStart: isoDate.nullable(),
  effectiveEnd: isoDate.nullable(),
});
export type MeetingPattern = z.infer<typeof meetingPattern>;

export const commitment = z.object({
  id: z.string(),
  termId: z.string(),
  title: z.string(),
  commitmentType: commitmentType,
  daysOfWeek: z.array(dayOfWeek),
  startTime: timeOfDay,
  endTime: timeOfDay,
  /** Set for one-off commitments; null for weekly recurrence. */
  specificDate: isoDate.nullable().default(null),
  flexibility: flexibility.default("fixed"),
  locked: z.boolean().default(false),
});
export type Commitment = z.infer<typeof commitment>;

export const availabilityRule = z.object({
  id: z.string(),
  termId: z.string(),
  dayOfWeek: dayOfWeek,
  startTime: timeOfDay,
  endTime: timeOfDay,
  energyLevel: energyLevel.default("medium"),
  location: locationRequirement.default("anywhere"),
  hardness: hardness.default("soft"),
});
export type AvailabilityRule = z.infer<typeof availabilityRule>;

export const workItem = z.object({
  id: z.string(),
  courseId: z.string(),
  /** Set when this item is a milestone of a larger project. */
  parentWorkItemId: z.string().nullable().default(null),
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  workType: workType,
  availableAt: isoDateTime.nullable().default(null),
  /** Null is legitimate: the syllabus may not state a date, and we never invent one. */
  dueAt: isoDateTime.nullable().default(null),
  pointsPossible: z.number().nonnegative().nullable().default(null),
  gradingCategoryId: z.string().nullable().default(null),
  /** Share of its grading category this item represents, when points are unknown. */
  categorySharePercent: z.number().min(0).max(100).nullable().default(null),
  estimatedMinutes: z.number().int().positive().nullable().default(null),
  remainingMinutes: z.number().int().nonnegative().nullable().default(null),
  cognitiveDemand: cognitiveDemand.default("medium"),
  divisibility: divisibility.default("divisible"),
  locationRequirement: locationRequirement.default("anywhere"),
  status: workStatus.default("not_started"),
  sourceConfidence: confidenceStatus.default("confirmed"),
  /** Explicit student preference, -2..2. User edits always outrank inference. */
  userPriority: z.number().int().min(-2).max(2).default(0),
});
export type WorkItem = z.infer<typeof workItem>;

export const dependency = z.object({
  id: z.string(),
  predecessorWorkItemId: z.string(),
  successorWorkItemId: z.string(),
  dependencyType: dependencyType.default("finish_to_start"),
});
export type Dependency = z.infer<typeof dependency>;

export const workSession = z.object({
  id: z.string(),
  workItemId: z.string(),
  planVersionId: z.string(),
  startAt: isoDateTime,
  endAt: isoDateTime,
  status: sessionStatus.default("planned"),
  /** Locked sessions never move automatically (docs/04 §12). */
  locked: z.boolean().default(false),
  acceptedByUser: z.boolean().default(false),
  actualMinutes: z.number().int().nonnegative().nullable().default(null),
  outcomeCode: outcomeCode.nullable().default(null),
});
export type WorkSession = z.infer<typeof workSession>;

export const gradeResult = z.object({
  id: z.string(),
  workItemId: z.string(),
  /** Null means "not graded yet" — never treat as zero (docs/04 §7). */
  pointsEarned: z.number().nullable(),
  pointsPossible: z.number().positive().nullable(),
  letterGrade: z.string().nullable().default(null),
  postedAt: isoDateTime.nullable().default(null),
  confirmationStatus: gradeConfirmation.default("confirmed"),
  /** Set when the grade came from a screenshot import. */
  sourceDocumentId: z.string().nullable().default(null),
  /** True when the course's drop rule excludes this result from the grade. */
  dropped: z.boolean().default(false),
});
export type GradeResult = z.infer<typeof gradeResult>;

export const planningRisk = z.object({
  level: riskLevel,
  workItemId: z.string().nullable(),
  /** Machine-readable; rendered through theme-language. */
  code: z.string(),
  detail: z.string(),
});
export type PlanningRisk = z.infer<typeof planningRisk>;

export const recommendation = z.object({
  workSessionId: z.string(),
  workItemId: z.string(),
  rank: z.number().int().nonnegative(),
  reasonCodes: z.array(z.string()),
  /** What the student gives up by taking this recommendation, if anything. */
  tradeoffCode: z.string().nullable().default(null),
});
export type Recommendation = z.infer<typeof recommendation>;

export const planVersion = z.object({
  id: z.string(),
  termId: z.string(),
  versionNumber: z.number().int().positive(),
  horizonStart: isoDate,
  horizonEnd: isoDate,
  generationReason: z.string(),
  algorithmVersion: z.string(),
  status: z.enum(["proposed", "accepted", "superseded"]).default("proposed"),
  createdAt: isoDateTime,
});
export type PlanVersion = z.infer<typeof planVersion>;

export const auditEvent = z.object({
  id: z.string(),
  userId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  actorType: z.enum(["user", "system", "ai"]),
  createdAt: isoDateTime,
});
export type AuditEvent = z.infer<typeof auditEvent>;
