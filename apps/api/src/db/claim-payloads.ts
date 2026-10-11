import { z } from "zod";
import { extractedAssignment, extractedDate } from "@schoolquest/ai";

/**
 * Shapes of `extraction_claims.payload_json`, one per `claim_type`.
 *
 * Written by `buildClaimRows` in routes/extraction.ts from the validated extraction, then edited
 * in place by the review routes (a student's corrected date, a weekday answer, a typed answer).
 * They were read back with `JSON.parse(...) as T`; see lib/json-column.ts for why that changed and
 * which call sites throw versus fall back.
 *
 * The write-path schemas `.passthrough()`: a payload is read, adjusted, and stored back whole, and
 * keys these schemas do not name (`evidenceVerified`, `recurrence`, `answer`, ...) are still part
 * of the record. They also name no more than the routes actually read, because a student's PATCH
 * may store any object, and a schema stricter than the code that uses it would refuse claims the
 * routes handled before.
 */

/** An assignment claim, as promoted by confirm and re-dated by the answer routes. */
export const assignmentClaimPayload = z
  .object({
    title: z.string(),
    type: extractedAssignment.shape.type,
    dueDate: extractedDate.passthrough(),
    pointsPossible: z.number().nullable().default(null),
    category: z.string().nullable().default(null),
    isMajorProject: z.boolean().default(false),
    issues: z.array(z.string()).optional(),
    duplicateOf: z.string().nullable().optional(),
    confidenceStatus: z.string().optional(),
  })
  .passthrough();
export type AssignmentClaimPayload = z.infer<typeof assignmentClaimPayload>;

export const gradingCategoryClaimPayload = z
  .object({
    name: z.string(),
    weightPercent: z.number().nullable(),
    dropLowest: z.number().nullable().optional(),
  })
  .passthrough();

export const meetingPatternClaimPayload = z
  .object({
    daysOfWeek: z.array(z.number()),
    startTime: z.string(),
    endTime: z.string(),
    location: z.string().nullable().default(null),
  })
  .passthrough();

/** A week header, read back to calibrate what this document means by "Week N". */
export const scheduleAnchorClaimPayload = z.object({
  weekNumber: z.number(),
  raw: z.string().nullable(),
  isBreak: z.boolean().default(false),
});

/** A clarification question, as the answer routes read and rewrite it. */
export const questionClaimPayload = z
  .object({
    kind: z.string().optional(),
    relatesToTitle: z.string().nullable().optional(),
    relatesToTitles: z.array(z.string()).optional(),
    /** "registrar_window" marks the question the resolve-weekday route raises itself. */
    source: z.string().optional(),
  })
  .passthrough();

/**
 * A clarification question as the open-questions index displays it.
 *
 * Every field is caught individually: on a display path one odd field should cost that field, not
 * the question. A question with no readable `question` text is skipped by the route, as before.
 */
export const questionClaimDisplay = z.object({
  question: z.string().optional().catch(undefined),
  why: z.string().optional().catch(undefined),
  relatesToTitle: z.string().nullable().optional().catch(undefined),
  relatesToTitles: z.array(z.string()).optional().catch(undefined),
  evidence: z
    .array(z.object({ page: z.number(), excerpt: z.string() }))
    .optional()
    .catch(undefined),
});

/** A policy claim as the open-questions index displays it. */
export const policyClaimDisplay = z.object({
  kind: z.string().optional().catch(undefined),
  summary: z.string().optional().catch(undefined),
});
