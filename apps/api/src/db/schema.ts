import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * D1 (SQLite) schema. Mirrors docs/05-data-model-and-api.md §2.
 *
 * Conventions:
 *  - Timestamps are ISO-8601 UTC strings, so they sort lexically and survive JSON round-trips.
 *  - Nullable means genuinely unknown. No sentinel defaults — "unknown" is a real state.
 *  - JSON blobs are text columns; the domain package validates them on read.
 */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("America/New_York"),
  theme: text("theme").notNull().default("plain"),
  reducedMotion: integer("reduced_motion", { mode: "boolean" }).notNull().default(false),
  detailMode: text("detail_mode").notNull().default("standard"),
  /**
   * The student's own OpenRouter key, encrypted (see `secrets.ts`). Null means "use whatever the
   * deployment was configured with", which is how a self-hosted single-user install works.
   */
  openrouterKeyEncrypted: text("openrouter_key_encrypted"),
  /** Chosen from `MODEL_CHOICES`. Null falls back to the app's default. */
  extractionModel: text("extraction_model"),
  coachModel: text("coach_model"),
  createdAt: text("created_at").notNull(),
});

/** Server-side sessions. The cookie holds only the random token's hash lookup key. */
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("auth_sessions_token_hash_idx").on(t.tokenHash)],
);

/** Single-use magic-link tokens. Deleted on redemption. */
export const loginTokens = sqliteTable(
  "login_tokens",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("login_tokens_token_hash_idx").on(t.tokenHash)],
);

export const terms = sqliteTable(
  "terms",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First day of instruction. */
    startDate: text("start_date").notNull(),
    /** Last day of instruction. Finals may follow it — see `calendarJson`. */
    endDate: text("end_date").notNull(),
    /**
     * Breaks, the finals window, and whether this school's syllabi number break weeks.
     *
     * A JSON column rather than a `term_breaks` table because nothing queries into it: it is
     * read whole, every time, by the code that resolves a week number or expands a recurrence.
     * `{}` parses to the empty calendar, which behaves exactly as a two-date term always did.
     */
    calendarJson: text("calendar_json").notNull().default("{}"),
    status: text("status").notNull().default("planning"),
    planningPreferencesJson: text("planning_preferences_json").notNull().default("{}"),
  },
  (t) => [index("terms_user_idx").on(t.userId)],
);

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    termId: text("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    instructor: text("instructor"),
    credits: real("credits"),
    colorToken: text("color_token").notNull().default("slate"),
    expectedWeeklyMinutes: integer("expected_weekly_minutes"),
    targetGrade: real("target_grade"),
    gradingConfidence: text("grading_confidence").notNull().default("unknown"),
  },
  (t) => [index("courses_term_idx").on(t.termId)],
);

export const gradingCategories = sqliteTable(
  "grading_categories",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    weightPercent: real("weight_percent"),
    dropRuleJson: text("drop_rule_json"),
    confidenceStatus: text("confidence_status").notNull().default("unknown"),
  },
  (t) => [index("grading_categories_course_idx").on(t.courseId)],
);

export const meetingPatterns = sqliteTable(
  "meeting_patterns",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /** Comma-separated day numbers, e.g. "1,3". SQLite has no array type. */
    daysOfWeek: text("days_of_week").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    location: text("location"),
    effectiveStart: text("effective_start"),
    effectiveEnd: text("effective_end"),
  },
  (t) => [index("meeting_patterns_course_idx").on(t.courseId)],
);

export const commitments = sqliteTable(
  "commitments",
  {
    id: text("id").primaryKey(),
    termId: text("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    commitmentType: text("commitment_type").notNull(),
    daysOfWeek: text("days_of_week").notNull().default(""),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    specificDate: text("specific_date"),
    flexibility: text("flexibility").notNull().default("fixed"),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("commitments_term_idx").on(t.termId)],
);

export const availabilityRules = sqliteTable(
  "availability_rules",
  {
    id: text("id").primaryKey(),
    termId: text("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    energyLevel: text("energy_level").notNull().default("medium"),
    location: text("location").notNull().default("anywhere"),
    hardness: text("hardness").notNull().default("soft"),
  },
  (t) => [index("availability_rules_term_idx").on(t.termId)],
);

export const workItems = sqliteTable(
  "work_items",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    parentWorkItemId: text("parent_work_item_id"),
    title: text("title").notNull(),
    description: text("description"),
    workType: text("work_type").notNull(),
    availableAt: text("available_at"),
    dueAt: text("due_at"),
    pointsPossible: real("points_possible"),
    gradingCategoryId: text("grading_category_id"),
    categorySharePercent: real("category_share_percent"),
    estimatedMinutes: integer("estimated_minutes"),
    remainingMinutes: integer("remaining_minutes"),
    cognitiveDemand: text("cognitive_demand").notNull().default("medium"),
    divisibility: text("divisibility").notNull().default("divisible"),
    locationRequirement: text("location_requirement").notNull().default("anywhere"),
    status: text("status").notNull().default("not_started"),
    sourceConfidence: text("source_confidence").notNull().default("confirmed"),
    userPriority: integer("user_priority").notNull().default(0),
  },
  (t) => [
    index("work_items_course_idx").on(t.courseId),
    index("work_items_parent_idx").on(t.parentWorkItemId),
    index("work_items_due_idx").on(t.dueAt),
  ],
);

export const dependencies = sqliteTable(
  "dependencies",
  {
    id: text("id").primaryKey(),
    predecessorWorkItemId: text("predecessor_work_item_id").notNull(),
    successorWorkItemId: text("successor_work_item_id").notNull(),
    dependencyType: text("dependency_type").notNull().default("finish_to_start"),
  },
  (t) => [index("dependencies_successor_idx").on(t.successorWorkItemId)],
);

export const planVersions = sqliteTable(
  "plan_versions",
  {
    id: text("id").primaryKey(),
    termId: text("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    horizonStart: text("horizon_start").notNull(),
    horizonEnd: text("horizon_end").notNull(),
    generationReason: text("generation_reason").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    status: text("status").notNull().default("proposed"),
    summaryJson: text("summary_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("plan_versions_term_idx").on(t.termId, t.versionNumber)],
);

export const workSessions = sqliteTable(
  "work_sessions",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    planVersionId: text("plan_version_id").notNull(),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    status: text("status").notNull().default("planned"),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    acceptedByUser: integer("accepted_by_user", { mode: "boolean" }).notNull().default(false),
    actualMinutes: integer("actual_minutes"),
    outcomeCode: text("outcome_code"),
    reasonCodesJson: text("reason_codes_json").notNull().default("[]"),
    tradeoffCode: text("tradeoff_code"),
  },
  (t) => [
    index("work_sessions_plan_idx").on(t.planVersionId),
    index("work_sessions_item_idx").on(t.workItemId),
    index("work_sessions_start_idx").on(t.startAt),
  ],
);

export const gradeResults = sqliteTable(
  "grade_results",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    /** Null means not graded yet. Never written as 0 to mean "pending". */
    pointsEarned: real("points_earned"),
    pointsPossible: real("points_possible"),
    letterGrade: text("letter_grade"),
    postedAt: text("posted_at"),
    confirmationStatus: text("confirmation_status").notNull().default("confirmed"),
    sourceDocumentId: text("source_document_id"),
    dropped: integer("dropped", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("grade_results_item_idx").on(t.workItemId)],
);

/** Uploaded syllabi and grade screenshots. The bytes live in R2 under `storageKey`. */
export const sourceDocuments = sqliteTable(
  "source_documents",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    processingStatus: text("processing_status").notNull().default("pending"),
    uploadedAt: text("uploaded_at").notNull(),
  },
  (t) => [index("source_documents_course_idx").on(t.courseId)],
);

/**
 * AI extraction output, kept strictly separate from confirmed records. Nothing here
 * affects the plan until a human confirms it (docs/05 §1).
 */
export const extractionClaims = sqliteTable(
  "extraction_claims",
  {
    id: text("id").primaryKey(),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    claimType: text("claim_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    pageNumber: integer("page_number"),
    sourceExcerpt: text("source_excerpt"),
    confidence: real("confidence"),
    reviewStatus: text("review_status").notNull().default("pending"),
    resolvedEntityType: text("resolved_entity_type"),
    resolvedEntityId: text("resolved_entity_id"),
    /** Prompt and model version, so a bad extraction batch can be traced. */
    promptVersion: text("prompt_version"),
    model: text("model"),
  },
  (t) => [index("extraction_claims_document_idx").on(t.sourceDocumentId)],
);

export const coachMessages = sqliteTable(
  "coach_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** ALLOW / OFF_TOPIC / DO_MY_WORK / DISTRESS — lets the gate be tuned from real traffic. */
    guardVerdict: text("guard_verdict"),
    actionsJson: text("actions_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("coach_messages_user_idx").on(t.userId, t.createdAt)],
);

/**
 * What took the time instead, and what the student decided to do about it.
 *
 * One table carries two kinds of row, because they are two halves of the same conversation.
 * A `reported` row is the student naming something that displaced a block. A `resolution`
 * row is their answer about a repeating slot — one-off, not free, or made into a commitment
 * — and exists so the same question is never asked twice.
 *
 * `slotKey` is what ties them to the pattern the planning engine finds: weekday plus start
 * time, e.g. "4:17:00". `occurrences` records how many times the slot had come up when the
 * answer was given, so a slot dismissed as a one-off can be raised again if it keeps
 * happening — the answer was about that week, not a promise about the term.
 */
export const interruptions = sqliteTable(
  "interruptions",
  {
    id: text("id").primaryKey(),
    termId: text("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    /** "reported" — the student named it. "resolution" — the student answered about a slot. */
    kind: text("kind").notNull(),
    slotKey: text("slot_key").notNull(),
    /** Set when the interruption displaced a specific block. */
    workSessionId: text("work_session_id"),
    title: text("title"),
    commitmentType: text("commitment_type"),
    startAt: text("start_at"),
    endAt: text("end_at"),
    /** The student's own answer to "does this happen every week?", when they gave one. */
    recurring: integer("recurring", { mode: "boolean" }),
    /** For resolution rows: "one_off" | "promoted" | "dismissed". */
    resolution: text("resolution"),
    occurrences: integer("occurrences").notNull().default(0),
    promotedCommitmentId: text("promoted_commitment_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("interruptions_term_idx").on(t.termId, t.slotKey)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    actorType: text("actor_type").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_events_user_idx").on(t.userId, t.createdAt)],
);
