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

/**
 * When a meal normally happens, and how much of it to hold open.
 *
 * `earliest`/`latest` bound the hour it could reasonably move to on a busy day; `anchor` is
 * where it lands when nothing is in the way. Keeping the window separate from the anchor is
 * what lets the scheduler slide lunch to 13:10 on the day of a noon lab instead of either
 * cancelling it or planning over the top of the lab.
 *
 * These are defaults, not assertions about this student. A meal the student has actually
 * entered as a commitment always takes precedence, and removing a window here is how "I do
 * not stop for breakfast" is said.
 */
export const mealWindow = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  earliest: timeOfDay,
  latest: timeOfDay,
  anchor: timeOfDay,
  minutes: z.number().int().positive(),
});
export type MealWindow = z.infer<typeof mealWindow>;

export const DEFAULT_MEAL_WINDOWS: MealWindow[] = [
  { key: "breakfast", label: "Breakfast", earliest: "06:30", latest: "09:30", anchor: "08:00", minutes: 20 },
  { key: "lunch", label: "Lunch", earliest: "11:00", latest: "14:00", anchor: "12:15", minutes: 40 },
  { key: "dinner", label: "Dinner", earliest: "17:00", latest: "20:00", anchor: "18:15", minutes: 45 },
];

export const planningPreferences = z.object({
  /** Hard ceiling on scheduled academic minutes in a single day. */
  maxDailyAcademicMinutes: z.number().int().positive().default(300),
  preferredSessionMinutes: z.number().int().positive().default(45),
  minSessionMinutes: z.number().int().positive().default(20),
  maxSessionMinutes: z.number().int().positive().default(120),
  /** Recovery time held after each block. Zero packs the day back-to-back. */
  breakMinutes: z.number().int().nonnegative().default(10),
  /** Meal times the scheduler holds open. An empty list opts out of all of them. */
  mealWindows: z.array(mealWindow).default(DEFAULT_MEAL_WINDOWS),
  /** Days the scheduler must leave empty unless the user explicitly overrides. */
  protectedDaysOfWeek: z.array(dayOfWeek).default([]),
  /** Days of slack the scheduler reserves before a high-value deadline. */
  deadlineBufferDays: z.number().int().nonnegative().default(1),
});
export type PlanningPreferences = z.infer<typeof planningPreferences>;

/**
 * What one day of the term is.
 *
 * Day granularity rather than ranges because real academic calendars are not made of weeks.
 * A single Monday for Labor Day, one Wednesday afternoon before Thanksgiving, two days of
 * fall break, a reading day before finals — a range list can encode all of those, but only by
 * pretending they are the same kind of thing as a week-long break, and the moment you ask
 * "does this class meet on the 7th" you want a day, not a range.
 */
export const termDayKind = z.enum([
  /** An ordinary class day. The default for anything not listed as an exception. */
  "instruction",
  /** Holiday or break: no classes. Deadlines outside class hours may still stand. */
  "no_class",
  /** Reading/study day: no classes, and work is very much expected. */
  "reading",
  /** Inside the exam period. */
  "finals",
]);
export type TermDayKind = z.infer<typeof termDayKind>;

/**
 * A day that departs from ordinary instruction.
 *
 * Stored as exceptions rather than one row per day: a 110-day term is ~15 exceptions and 95
 * unremarkable Mondays, and storing the 95 buys nothing. The *bedrock* is still by day —
 * `termDays()` materialises every date in the term from these — so everything downstream reads
 * days and nothing has to reason about ranges.
 */
export const termCalendarException = z.object({
  date: isoDate,
  /** Never "instruction": an exception is by definition a departure from it. */
  kind: z.enum(["no_class", "reading", "finals"]),
  /** What the academic calendar called it: "Thanksgiving Recess", "Labor Day". */
  label: z.string().nullable().default(null),
  /**
   * Set when the calendar says this date runs another weekday's class schedule — "Tuesday,
   * November 24: classes follow a Friday schedule". Real calendars do this after a break to
   * even out contact hours, and a class that meets Fridays does meet that Tuesday.
   */
  followsWeekday: dayOfWeek.nullable().default(null),
});
export type TermCalendarException = z.infer<typeof termCalendarException>;

/**
 * A stretch of the term with no class meetings, derived from the day calendar for display.
 *
 * Dates are inclusive, so a Monday-to-Friday break is `2026-11-23` to `2026-11-27`.
 */
export const termBreak = z.object({
  name: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
});
export type TermBreak = z.infer<typeof termBreak>;

/**
 * The academic calendar the whole term is read against — the bedrock.
 *
 * This is a *prerequisite* for reading a syllabus, not something a syllabus tells you. A
 * syllabus says "Week 14", "each Tuesday in class", "finals week"; every one of those points
 * at dates the syllabus does not contain, and getting them wrong is silent.
 *
 * Three mechanisms need it and all three were measurably wrong without it:
 *
 * - **Week numbers.** "Problem Set 6 due Week 14" resolved to Thanksgiving week, for work due
 *   at the beginning of class.
 * - **Recurrence.** "A response is due each Tuesday in class" produced sixteen instances, one
 *   of them on a Tuesday with no class. Fifteen is right.
 * - **Finals.** An exam after the last day of instruction is ordinary, not suspicious, and the
 *   day inside finals week is the registrar's to set.
 *
 * The normal form is **days**, materialised by `termDays()`. Everything a student or a pasted
 * academic calendar supplies is normalised into `exceptions` first, so no consumer ever has to
 * know which shape the information arrived in.
 *
 * Every field is optional and an empty calendar behaves exactly as the two-date term always
 * did — less certain, and now able to say so.
 */
export const termCalendar = z.object({
  /** Days that are not ordinary instruction. Everything else in the term is. */
  exceptions: z.array(termCalendarException).default([]),
  /**
   * Whether this school's syllabi keep counting week numbers through a break.
   *
   * A weak signal, kept as a last resort. Two of the three real syllabi checked number one
   * break and skip another *inside the same document*, so no per-term value is right for them
   * — see `docs/10-syllabus-gotchas.md` §3.7. Prefer calibrating against the week/date pairs a
   * document prints for itself. `null` means nobody has said, which makes a bare "Week N"
   * after a break an open question rather than a confident guess.
   */
  breaksTakeWeekNumbers: z.boolean().nullable().default(null),
  /** Where this came from, so the interface can say how much to trust it. */
  source: z.enum(["pasted_calendar", "manual", "unknown"]).default("unknown"),
});
export type TermCalendar = z.infer<typeof termCalendar>;

export const EMPTY_TERM_CALENDAR: TermCalendar = {
  exceptions: [],
  breaksTakeWeekNumbers: null,
  source: "unknown",
};

export const term = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  /** First day of instruction. */
  startDate: isoDate,
  /** Last day of instruction — not the last day of the term, which finals may follow. */
  endDate: isoDate,
  calendar: termCalendar.default(EMPTY_TERM_CALENDAR),
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
