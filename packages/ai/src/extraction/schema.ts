import { z } from "zod";

/**
 * Syllabus extraction contract (docs/06-ai-system-spec.md §3).
 *
 * Every claim the model makes must carry evidence: the page it came from and the literal
 * text it was reading. That evidence is not decoration — the validator checks the quoted
 * excerpt actually appears on that page, which is what stops a fluent model from
 * inventing a deadline that reads perfectly plausibly.
 */

/**
 * A 24-hour "HH:MM" time, coerced from whatever the model wrote.
 *
 * Syllabi state times as "9:30-10:50 am" and "6:00-9:00 PM", and a model quoting them
 * faithfully returns "9:30 am". Rejecting that outright discards the entire extraction —
 * a whole syllabus lost to a missing leading zero. Real model output did exactly this, so
 * the schema now normalizes before it validates.
 */
export const timeString = z.preprocess(
  (value) => (typeof value === "string" ? normalizeTime(value) : value),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
);

/** "9:30 am" -> "09:30", "6:00 PM" -> "18:00", "9:30" -> "09:30". */
export function normalizeTime(raw: string): string {
  const match = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*([ap])\.?\s*m?\.?\s*$/i.exec(raw);
  if (match) {
    let hour = Number(match[1]);
    const minute = match[2]!;
    const meridiem = match[3]!.toLowerCase();
    // 12 AM is midnight and 12 PM is noon — the one case a naive +12 gets wrong.
    if (meridiem === "p" && hour !== 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  const bare = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*$/.exec(raw);
  if (bare) return `${bare[1]!.padStart(2, "0")}:${bare[2]}`;

  // Unrecognized: hand it back untouched so the regex reports a real validation error.
  return raw.trim();
}

/** A calendar date the model read verbatim. Never a date it computed or assumed. */
export const extractedDate = z.object({
  /** ISO date, ONLY when an explicit calendar date appears in the document. */
  iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  /** The literal text: "October 18", "Week 5", "the Friday before break". */
  raw: z.string().nullable(),
  /**
   * Time of day, ONLY when stated. A syllabus that says "due October 18" with no time
   * must leave this null — 11:59 PM is a convention, not a fact (docs/06 §4).
   */
  time: timeString.nullable(),
  ambiguity: z
    .enum([
      "none",
      /** "Week 5" — needs the term calendar to resolve. */
      "relative_week",
      /** "October 18" with no year stated. */
      "no_year",
      /** The schedule table and the prose disagree. */
      "conflicting",
      /** Referenced but no date given anywhere. */
      "missing",
      /** "the Friday before spring break" and similar. */
      "relative_event",
      /**
       * Computed by `expandRecurrence` from a rule the document stated, not read off the page.
       *
       * Never produced by the model — it is set by our own code after extraction, and it exists
       * so the validator can tell a date it derived from a date the model invented. Those look
       * identical to `dateAppearsInSource`, which finds neither on the page, and without this the
       * validator strips every occurrence it just generated.
       */
      "derived_recurrence",
    ])
    .default("none"),
});
export type ExtractedDate = z.infer<typeof extractedDate>;

export const evidence = z.object({
  page: z.number().int().positive(),
  /** Copied verbatim from the page. The validator rejects claims whose excerpt is absent. */
  excerpt: z.string().min(1),
});
export type Evidence = z.infer<typeof evidence>;


/**
 * A week header the document prints, with whatever it printed beside it.
 *
 * Read, not computed — which is the whole point. Every syllabus that dates its work by week
 * number is counting from a start it never states, and two of them count differently: one
 * numbers the break week, the next skips it. Resolving "Week 10" against the term's own week 10
 * is therefore a coin flip, and it lands silently.
 *
 * Real cases, all from documents in the corpus:
 *   "Week 9, March 13-19 . . . Spring Break"  — numbers the break, and prints its dates
 *   "Week 9 Spring break"                     — numbers the break, prints no dates at all
 *   "Week 10, March 20–26" then "Week 10, March 27–April 2"  — the same number twice
 *   ...and no Week 16 anywhere in the same document
 *
 * Given these, `calibrateWeeks` can work out what *this* document's week 1 was and whether it
 * counts breaks, instead of assuming. The model's job is to copy down what is printed; working
 * out the offset is arithmetic and belongs in code.
 */
export const scheduleAnchor = z.object({
  /** The number as printed. Zero is real: one syllabus starts at "Week 0". */
  weekNumber: z.number().int().min(0).max(60),
  /** The date or range printed beside it, verbatim. Null when the row gives none. */
  raw: z.string().nullable(),
  /** True when the row marks the week as a break, holiday or reading period. */
  isBreak: z.boolean().default(false),
  evidence: evidence,
});
export type ScheduleAnchor = z.infer<typeof scheduleAnchor>;

export const extractedAssignment = z.object({
  title: z.string().min(1),
  type: z.enum([
    "reading",
    "quiz",
    "problem_set",
    "paper",
    "presentation",
    "group_project",
    "exam",
    "lab",
    "discussion",
    "other",
  ]),
  dueDate: extractedDate,
  /** Points as stated. Distinct from a percentage weight — never conflate them (docs/06 §4). */
  pointsPossible: z.number().nonnegative().nullable(),
  /** The grading category name as written in the syllabus, for later matching. */
  category: z.string().nullable(),
  /** True when the syllabus frames this as a major project or exam worth decomposing. */
  isMajorProject: z.boolean().default(false),
  /**
   * Set when the syllabus states the work as a *rule* rather than listing it.
   *
   * "A short response is due each Tuesday", "a weekly fitness log ... there are 14 logs". The
   * model reads the rule and does not enumerate; `expandRecurrence` turns it into instances
   * against the real term dates. That split is deliberate and is the same one `resolve-dates`
   * uses for "Week 3": reading is the model's job and calendar arithmetic is not.
   *
   * Recall against the fixture syllabuses was 67% without this, and every single miss was work
   * stated this way — fourteen fitness logs and sixteen reading responses arriving as one
   * undated item each, which on a student's screen looks like one small thing rather than
   * thirty. Work listed row by row in a schedule table was already captured perfectly, so this
   * is the whole of the gap.
   */
  recurrence: z
    .object({
      frequency: z.literal("weekly"),
      /** 0 = Sunday. Null when the syllabus gives a count but never names a day. */
      dayOfWeek: z.number().int().min(0).max(6).nullable(),
      /**
       * True when the rule is "once per class session" rather than once a week.
       *
       * A class meeting twice a week with a quiz each time produces two a week, and `dayOfWeek`
       * cannot say so -- it holds one day. A real syllabus did exactly this and the app asked
       * "which day of the week?", a question with no correct answer, so the student entered
       * every quiz of the term by hand.
       *
       * Nothing is guessed from it. The days come from the course's own meeting pattern, which
       * the same syllabus states and the same extraction already reads.
       */
      everyClassMeeting: z.boolean().default(false),
      /** Stated outright ("There are 14 logs"). Null when only the rule is given. */
      count: z.number().int().positive().max(60).nullable(),
      /** How many the syllabus says are dropped, which does not reduce what must be done. */
      dropLowest: z.number().int().nonnegative().nullable().default(null),
    })
    .nullable()
    .default(null),
  evidence: evidence,
  confidence: z.number().min(0).max(1),
});
export type ExtractedAssignment = z.infer<typeof extractedAssignment>;

export const extractedMeetingPattern = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  startTime: timeString,
  endTime: timeString,
  location: z.string().nullable(),
  evidence: evidence,
  confidence: z.number().min(0).max(1),
});
export type ExtractedMeetingPattern = z.infer<typeof extractedMeetingPattern>;

export const extractedGradingCategory = z.object({
  name: z.string().min(1),
  weightPercent: z.number().min(0).max(100).nullable(),
  /**
   * Points, when the syllabus weights by points rather than percentages.
   *
   * "Class Participation: Maximum of 20 points; Midterm: 40; Final: 40" is a complete grading
   * scheme — 20/40/40 of 100 — and with nowhere to put the numbers it came back as three
   * nulls and the student was told "No weight was found… the rest add up to 0%". A false
   * alarm on a document that states its weights fully.
   */
  pointsPossible: z.number().nonnegative().nullable().default(null),
  /** e.g. 1 when the syllabus says "lowest quiz dropped". */
  dropLowest: z.number().int().nonnegative().nullable(),
  evidence: evidence,
  confidence: z.number().min(0).max(1),
});
export type ExtractedGradingCategory = z.infer<typeof extractedGradingCategory>;

export const extractedCourseFacts = z.object({
  name: z.string().nullable(),
  code: z.string().nullable(),
  instructor: z.string().nullable(),
  evidence: evidence.nullable(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedCourseFacts = z.infer<typeof extractedCourseFacts>;

export const extractedPolicy = z.object({
  kind: z.enum(["late_work", "attendance", "materials", "academic_integrity", "other"]),
  summary: z.string().min(1),
  evidence: evidence,
  confidence: z.number().min(0).max(1),
});
export type ExtractedPolicy = z.infer<typeof extractedPolicy>;

/**
 * A question for the student, asked only when the answer materially changes the plan
 * (docs/06 §4). "What is the professor's email" is not a planning question.
 */
export const clarificationQuestion = z.object({
  question: z.string().min(1),
  /** Why the plan needs this, in the student's terms. */
  why: z.string().min(1),
  /** Set when the question is about one specific extracted assignment. */
  relatesToTitle: z.string().nullable(),
  /**
   * Set by the validator when several identical questions are collapsed into one.
   * Not part of the model's contract — a syllabus listing thirteen quizzes by week should
   * produce one question, not thirteen (docs/02-prd.md FR-4: a minimal set, grouped).
   */
  relatesToTitles: z.array(z.string()).optional(),
  /**
   * The lines from the syllabus this question came from, quoted exactly.
   *
   * Set by the validator, never by the model. A question is easier to answer next to the text
   * that raised it -- "which Tuesday?" means nothing on its own and is obvious beside the row
   * that says "Weekly response due each Tuesday in class" -- and it also lets a student catch
   * the app having misread something, which is the failure mode nothing else surfaces.
   *
   * Derived rather than asked for: the excerpts are copied from claims that already passed the
   * evidence check against the document, so a quote here cannot be a fabrication even when the
   * question that carries it was invented by the model.
   */
  evidence: z
    .array(z.object({ page: z.number().int(), excerpt: z.string() }))
    .optional(),
  kind: z.enum([
    "missing_date",
    "relative_date",
    "meeting_times",
    "effort_estimate",
    "optional_or_dropped",
    "conflicting_information",
    "other",
  ]),
});
export type ClarificationQuestion = z.infer<typeof clarificationQuestion>;

export const syllabusExtraction = z.object({
  courseFacts: extractedCourseFacts,
  /** Every "Week N" header the schedule prints, so the app can calibrate rather than assume. */
  scheduleAnchors: z.array(scheduleAnchor).default([]),
  meetingPatterns: z.array(extractedMeetingPattern).default([]),
  gradingCategories: z.array(extractedGradingCategory).default([]),
  assignments: z.array(extractedAssignment).default([]),
  policies: z.array(extractedPolicy).default([]),
  clarificationQuestions: z.array(clarificationQuestion).default([]),
});
export type SyllabusExtraction = z.infer<typeof syllabusExtraction>;

/** Shared JSON Schema fragments so the provider constrains output rather than being asked to. */
const dateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["iso", "raw", "time", "ambiguity"],
  properties: {
    iso: { type: ["string", "null"] },
    raw: { type: ["string", "null"] },
    time: { type: ["string", "null"] },
    ambiguity: {
      type: "string",
      enum: ["none", "relative_week", "no_year", "conflicting", "missing", "relative_event"],
    },
  },
} as const;

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["page", "excerpt"],
  properties: {
    page: { type: "integer" },
    excerpt: { type: "string" },
  },
} as const;

export const SYLLABUS_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "courseFacts",
    "scheduleAnchors",
    "meetingPatterns",
    "gradingCategories",
    "assignments",
    "policies",
    "clarificationQuestions",
  ],
  properties: {
    courseFacts: {
      type: "object",
      additionalProperties: false,
      required: ["name", "code", "instructor", "evidence", "confidence"],
      properties: {
        name: { type: ["string", "null"] },
        code: { type: ["string", "null"] },
        instructor: { type: ["string", "null"] },
        evidence: { ...evidenceSchema, type: ["object", "null"] },
        confidence: { type: "number" },
      },
    },
    scheduleAnchors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["weekNumber", "raw", "isBreak", "evidence"],
        properties: {
          weekNumber: { type: "integer" },
          raw: { type: ["string", "null"] },
          isBreak: { type: "boolean" },
          evidence: evidenceSchema,
        },
      },
    },
    meetingPatterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["daysOfWeek", "startTime", "endTime", "location", "evidence", "confidence"],
        properties: {
          daysOfWeek: { type: "array", items: { type: "integer" } },
          startTime: { type: "string" },
          endTime: { type: "string" },
          location: { type: ["string", "null"] },
          evidence: evidenceSchema,
          confidence: { type: "number" },
        },
      },
    },
    gradingCategories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "weightPercent", "pointsPossible", "dropLowest", "evidence", "confidence"],
        properties: {
          name: { type: "string" },
          weightPercent: { type: ["number", "null"] },
          pointsPossible: { type: ["number", "null"] },
          dropLowest: { type: ["integer", "null"] },
          evidence: evidenceSchema,
          confidence: { type: "number" },
        },
      },
    },
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "type",
          "dueDate",
          "pointsPossible",
          "category",
          "isMajorProject",
          "recurrence",
          "evidence",
          "confidence",
        ],
        properties: {
          title: { type: "string" },
          type: {
            type: "string",
            enum: [
              "reading",
              "quiz",
              "problem_set",
              "paper",
              "presentation",
              "group_project",
              "exam",
              "lab",
              "discussion",
              "other",
            ],
          },
          dueDate: dateSchema,
          pointsPossible: { type: ["number", "null"] },
          category: { type: ["string", "null"] },
          isMajorProject: { type: "boolean" },
          recurrence: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["frequency", "dayOfWeek", "everyClassMeeting", "count", "dropLowest"],
            properties: {
              frequency: { type: "string", enum: ["weekly"] },
              dayOfWeek: { type: ["number", "null"] },
              everyClassMeeting: { type: "boolean" },
              count: { type: ["number", "null"] },
              dropLowest: { type: ["number", "null"] },
            },
          },
          evidence: evidenceSchema,
          confidence: { type: "number" },
        },
      },
    },
    policies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "summary", "evidence", "confidence"],
        properties: {
          kind: {
            type: "string",
            enum: ["late_work", "attendance", "materials", "academic_integrity", "other"],
          },
          summary: { type: "string" },
          evidence: evidenceSchema,
          confidence: { type: "number" },
        },
      },
    },
    clarificationQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "why", "relatesToTitle", "kind"],
        properties: {
          question: { type: "string" },
          why: { type: "string" },
          relatesToTitle: { type: ["string", "null"] },
          kind: {
            type: "string",
            enum: [
              "missing_date",
              "relative_date",
              "meeting_times",
              "effort_estimate",
              "optional_or_dropped",
              "conflicting_information",
              "other",
            ],
          },
        },
      },
    },
  },
} as const;
