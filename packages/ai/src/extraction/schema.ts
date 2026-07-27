import { z } from "zod";

/**
 * Syllabus extraction contract (docs/06-ai-system-spec.md §3).
 *
 * Every claim the model makes must carry evidence: the page it came from and the literal
 * text it was reading. That evidence is not decoration — the validator checks the quoted
 * excerpt actually appears on that page, which is what stops a fluent model from
 * inventing a deadline that reads perfectly plausibly.
 */

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
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
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
  evidence: evidence,
  confidence: z.number().min(0).max(1),
});
export type ExtractedAssignment = z.infer<typeof extractedAssignment>;

export const extractedMeetingPattern = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  location: z.string().nullable(),
  evidence: evidence,
  confidence: z.number().min(0).max(1),
});
export type ExtractedMeetingPattern = z.infer<typeof extractedMeetingPattern>;

export const extractedGradingCategory = z.object({
  name: z.string().min(1),
  weightPercent: z.number().min(0).max(100).nullable(),
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
        required: ["name", "weightPercent", "dropLowest", "evidence", "confidence"],
        properties: {
          name: { type: "string" },
          weightPercent: { type: ["number", "null"] },
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
