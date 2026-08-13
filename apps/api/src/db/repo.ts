import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import {
  computeCourseStanding,
  planningPreferences,
  type AvailabilityRule,
  type Commitment,
  type Course,
  type CourseStanding,
  type Dependency,
  type GradeResult,
  type GradingCategory,
  type MeetingPattern,
  type WorkItem,
  type WorkSession,
} from "@schoolquest/domain";
import type { PlanningInput } from "@schoolquest/planning-engine";
import {
  availabilityRules,
  commitments,
  courses,
  dependencies,
  gradeResults,
  gradingCategories,
  meetingPatterns,
  terms,
  workItems,
  workSessions,
} from "./schema.js";

export type Db = DrizzleD1Database<Record<string, never>>;

export function getDb(d1: D1Database): Db {
  return drizzle(d1);
}

/**
 * D1 caps the number of bound parameters in a single statement, so a multi-row INSERT of
 * a whole week's sessions or availability grid fails with "too many SQL variables".
 * Chunking by row count keeps every statement under the ceiling.
 */
export async function insertInChunks<T>(
  rows: T[],
  chunkSize: number,
  run: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await run(rows.slice(i, i + chunkSize));
  }
}

/** SQLite has no arrays; day lists are stored as "1,3". */
function parseDays(value: string): number[] {
  return value
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export function serializeDays(days: number[]): string {
  return days.join(",");
}

/** Confirms a term belongs to the signed-in user before anything else touches it. */
export async function assertTermOwner(db: Db, termId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: terms.id })
    .from(terms)
    .where(and(eq(terms.id, termId), eq(terms.userId, userId)));
  return Boolean(row);
}

/**
 * Total focused time actually logged against this term, and how many sessions produced it.
 *
 * This is the one progression number that is always available. Point values are rare in
 * real syllabi — one work item in fifty-six carried a `pointsPossible` across the five-course
 * test semester — but a student who sat down and worked has always earned the minutes, and
 * the figure only ever goes up. Summed in SQL rather than in the Worker: the free plan
 * allows 10ms of CPU per request, and D1 does aggregation for free.
 */
export async function loadEffortTotals(
  db: Db,
  termId: string,
): Promise<{ effortMinutes: number; sessionsCompleted: number }> {
  const [row] = await db
    .select({
      // `actualMinutes` is null for sessions completed before it was recorded; those
      // still count as sessions, they just contribute no time.
      effortMinutes: sql<number>`coalesce(sum(${workSessions.actualMinutes}), 0)`,
      sessionsCompleted: sql<number>`count(*)`,
    })
    .from(workSessions)
    .innerJoin(workItems, eq(workItems.id, workSessions.workItemId))
    .innerJoin(courses, eq(courses.id, workItems.courseId))
    .where(and(eq(courses.termId, termId), eq(workSessions.status, "completed")));

  return {
    effortMinutes: Math.round(Number(row?.effortMinutes ?? 0)),
    sessionsCompleted: Number(row?.sessionsCompleted ?? 0),
  };
}

export interface TermSnapshot {
  courses: Course[];
  gradingCategories: GradingCategory[];
  meetingPatterns: MeetingPattern[];
  commitments: Commitment[];
  availabilityRules: AvailabilityRule[];
  workItems: WorkItem[];
  dependencies: Dependency[];
  grades: GradeResult[];
  existingSessions: WorkSession[];
  standings: Record<string, CourseStanding>;
  preferences: PlanningInput["preferences"];
  /** Last day of the term. Undated work is paced across what is left of it. */
  termEndDate: string;
  /** First day of instruction. Week numbers on the term map are counted from it. */
  termStartDate: string;
}

/**
 * Loads everything the planning engine needs for one term in a bounded number of queries.
 * D1 charges per row read, so this fans out by id sets rather than per-course loops.
 */
export async function loadTermSnapshot(
  db: Db,
  termId: string,
  options: { sessionsFrom?: string } = {},
): Promise<TermSnapshot> {
  const [termRow] = await db.select().from(terms).where(eq(terms.id, termId));
  if (!termRow) throw new Error(`Term ${termId} not found`);

  const courseRows = await db.select().from(courses).where(eq(courses.termId, termId));
  const courseIds = courseRows.map((c) => c.id);

  const [categoryRows, meetingRows, commitmentRows, availabilityRows] = await Promise.all([
    courseIds.length
      ? db.select().from(gradingCategories).where(inArray(gradingCategories.courseId, courseIds))
      : Promise.resolve([]),
    courseIds.length
      ? db.select().from(meetingPatterns).where(inArray(meetingPatterns.courseId, courseIds))
      : Promise.resolve([]),
    db.select().from(commitments).where(eq(commitments.termId, termId)),
    db.select().from(availabilityRules).where(eq(availabilityRules.termId, termId)),
  ]);

  const itemRows = courseIds.length
    ? await db.select().from(workItems).where(inArray(workItems.courseId, courseIds))
    : [];
  const itemIds = itemRows.map((i) => i.id);

  const [dependencyRows, gradeRows, sessionRows] = await Promise.all([
    itemIds.length
      ? db.select().from(dependencies).where(inArray(dependencies.successorWorkItemId, itemIds))
      : Promise.resolve([]),
    itemIds.length
      ? db.select().from(gradeResults).where(inArray(gradeResults.workItemId, itemIds))
      : Promise.resolve([]),
    itemIds.length
      ? db
          .select()
          .from(workSessions)
          .where(
            options.sessionsFrom
              ? and(
                  inArray(workSessions.workItemId, itemIds),
                  gte(workSessions.startAt, options.sessionsFrom),
                )
              : inArray(workSessions.workItemId, itemIds),
          )
      : Promise.resolve([]),
  ]);

  const mappedCourses: Course[] = courseRows.map((c) => ({
    id: c.id,
    termId: c.termId,
    name: c.name,
    code: c.code,
    instructor: c.instructor,
    credits: c.credits,
    colorToken: c.colorToken,
    expectedWeeklyMinutes: c.expectedWeeklyMinutes,
    targetGrade: c.targetGrade,
    gradingConfidence: c.gradingConfidence as Course["gradingConfidence"],
  }));

  const mappedCategories: GradingCategory[] = categoryRows.map((g) => ({
    id: g.id,
    courseId: g.courseId,
    name: g.name,
    weightPercent: g.weightPercent,
    dropRule: g.dropRuleJson ? (JSON.parse(g.dropRuleJson) as Record<string, unknown>) : null,
    confidenceStatus: g.confidenceStatus as GradingCategory["confidenceStatus"],
  }));

  const mappedItems: WorkItem[] = itemRows.map((w) => ({
    id: w.id,
    courseId: w.courseId,
    parentWorkItemId: w.parentWorkItemId,
    title: w.title,
    description: w.description,
    workType: w.workType as WorkItem["workType"],
    availableAt: w.availableAt,
    dueAt: w.dueAt,
    pointsPossible: w.pointsPossible,
    gradingCategoryId: w.gradingCategoryId,
    categorySharePercent: w.categorySharePercent,
    estimatedMinutes: w.estimatedMinutes,
    remainingMinutes: w.remainingMinutes,
    cognitiveDemand: w.cognitiveDemand as WorkItem["cognitiveDemand"],
    divisibility: w.divisibility as WorkItem["divisibility"],
    locationRequirement: w.locationRequirement as WorkItem["locationRequirement"],
    status: w.status as WorkItem["status"],
    sourceConfidence: w.sourceConfidence as WorkItem["sourceConfidence"],
    userPriority: w.userPriority,
  }));

  const mappedGrades: GradeResult[] = gradeRows.map((g) => ({
    id: g.id,
    workItemId: g.workItemId,
    pointsEarned: g.pointsEarned,
    pointsPossible: g.pointsPossible,
    letterGrade: g.letterGrade,
    postedAt: g.postedAt,
    confirmationStatus: g.confirmationStatus as GradeResult["confirmationStatus"],
    sourceDocumentId: g.sourceDocumentId,
    dropped: g.dropped,
  }));

  const standings: Record<string, CourseStanding> = {};
  for (const course of mappedCourses) {
    const items = mappedItems.filter((w) => w.courseId === course.id);
    const ids = new Set(items.map((w) => w.id));
    standings[course.id] = computeCourseStanding({
      workItems: items,
      grades: mappedGrades.filter((g) => ids.has(g.workItemId)),
      categories: mappedCategories.filter((c) => c.courseId === course.id),
    });
  }

  return {
    courses: mappedCourses,
    gradingCategories: mappedCategories,
    meetingPatterns: meetingRows.map((m) => ({
      id: m.id,
      courseId: m.courseId,
      daysOfWeek: parseDays(m.daysOfWeek),
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.location,
      effectiveStart: m.effectiveStart,
      effectiveEnd: m.effectiveEnd,
    })),
    commitments: commitmentRows.map((c) => ({
      id: c.id,
      termId: c.termId,
      title: c.title,
      commitmentType: c.commitmentType as Commitment["commitmentType"],
      daysOfWeek: parseDays(c.daysOfWeek),
      startTime: c.startTime,
      endTime: c.endTime,
      specificDate: c.specificDate,
      flexibility: c.flexibility as Commitment["flexibility"],
      locked: c.locked,
    })),
    availabilityRules: availabilityRows.map((a) => ({
      id: a.id,
      termId: a.termId,
      dayOfWeek: a.dayOfWeek,
      startTime: a.startTime,
      endTime: a.endTime,
      energyLevel: a.energyLevel as AvailabilityRule["energyLevel"],
      location: a.location as AvailabilityRule["location"],
      hardness: a.hardness as AvailabilityRule["hardness"],
    })),
    workItems: mappedItems,
    dependencies: dependencyRows.map((d) => ({
      id: d.id,
      predecessorWorkItemId: d.predecessorWorkItemId,
      successorWorkItemId: d.successorWorkItemId,
      dependencyType: d.dependencyType as Dependency["dependencyType"],
    })),
    grades: mappedGrades,
    existingSessions: sessionRows.map((s) => ({
      id: s.id,
      workItemId: s.workItemId,
      planVersionId: s.planVersionId,
      startAt: s.startAt,
      endAt: s.endAt,
      status: s.status as WorkSession["status"],
      locked: s.locked,
      acceptedByUser: s.acceptedByUser,
      actualMinutes: s.actualMinutes,
      outcomeCode: s.outcomeCode as WorkSession["outcomeCode"],
    })),
    standings,
    // Preferences are stored as JSON; parsing applies the schema defaults for missing keys.
    preferences: planningPreferences.parse(JSON.parse(termRow.planningPreferencesJson || "{}")),
    termEndDate: termRow.endDate,
    termStartDate: termRow.startDate,
  };
}

export function toPlanningInput(
  termId: string,
  snapshot: TermSnapshot,
  options: { horizonStart: string; horizonDays: number; now: string },
): PlanningInput {
  return {
    termId,
    horizonStart: options.horizonStart,
    horizonDays: options.horizonDays,
    now: options.now,
    preferences: snapshot.preferences,
    courses: snapshot.courses,
    gradingCategories: snapshot.gradingCategories,
    meetingPatterns: snapshot.meetingPatterns,
    commitments: snapshot.commitments,
    availabilityRules: snapshot.availabilityRules,
    workItems: snapshot.workItems,
    dependencies: snapshot.dependencies,
    existingSessions: snapshot.existingSessions,
    courseStandings: snapshot.standings,
    termEndDate: snapshot.termEndDate,
  };
}
