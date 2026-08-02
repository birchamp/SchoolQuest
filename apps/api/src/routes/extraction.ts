import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@schoolquest/domain";
import {
  AiProviderError,
  createOpenRouterProvider,
  extractSyllabus,
  ExtractionError,
  parseWeekday,
  resolveWeekdayForClaim,
  toDueAt,
  WEEKDAY_NAMES,
  type ValidatedAssignment,
} from "@schoolquest/ai";
import {
  courses,
  extractionClaims,
  gradingCategories,
  meetingPatterns,
  sourceDocuments,
  terms,
  workItems,
} from "../db/schema.js";
import { getDb, insertInChunks, serializeDays, type Db } from "../db/repo.js";
import type { AppBindings } from "../env.js";

export const extractionRoute = new Hono<AppBindings>();

/** Rows per INSERT; claims carry many columns, so keep batches small for D1. */
const CLAIM_INSERT_BATCH = 6;

/**
 * Loads a document only if the signed-in user owns it, walking
 * document -> course -> term -> user.
 */
async function loadOwnedDocument(db: Db, documentId: string, userId: string) {
  const [row] = await db
    .select({ document: sourceDocuments, course: courses, term: terms })
    .from(sourceDocuments)
    .innerJoin(courses, eq(courses.id, sourceDocuments.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(sourceDocuments.id, documentId), eq(terms.userId, userId)));
  return row ?? null;
}

const extractBody = z.object({
  pages: z
    .array(z.object({ page: z.number().int().positive(), text: z.string() }))
    .min(1)
    .max(60),
});

/**
 * Runs extraction over page text the client pulled out of the PDF.
 *
 * The client sends text rather than the Worker parsing the stored PDF because the Workers
 * free plan allows 10ms CPU per request — nowhere near enough to parse a PDF. Waiting on
 * the model is I/O, which does not count against that budget, so the split works.
 *
 * Nothing here writes to confirmed academic records. Every claim lands in
 * `extraction_claims` with review_status "pending" and waits for a human.
 */
extractionRoute.post("/documents/:id/extract", async (c) => {
  const db = getDb(c.env.DB);
  const documentId = c.req.param("id");

  const owned = await loadOwnedDocument(db, documentId, c.get("userId"));
  if (!owned) return c.json({ error: "Document not found" }, 404);

  if (!c.env.OPENROUTER_API_KEY) {
    return c.json({ error: "Extraction is not configured: OPENROUTER_API_KEY is missing." }, 503);
  }

  const parsed = extractBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await db
    .update(sourceDocuments)
    .set({ processingStatus: "processing" })
    .where(eq(sourceDocuments.id, documentId));

  const provider = createOpenRouterProvider({
    apiKey: c.env.OPENROUTER_API_KEY,
    defaultModel: c.env.OPENROUTER_EXTRACTION_MODEL,
    appUrl: c.env.APP_URL,
    appName: c.env.APP_NAME,
    ...(c.env.OPENROUTER_BASE_URL ? { baseUrl: c.env.OPENROUTER_BASE_URL } : {}),
  });

  let outcome;
  try {
    outcome = await extractSyllabus(provider, {
      pages: parsed.data.pages,
      termStartDate: owned.term.startDate,
      termEndDate: owned.term.endDate,
      courseName: owned.course.name,
    });
  } catch (error) {
    await db
      .update(sourceDocuments)
      .set({ processingStatus: "failed" })
      .where(eq(sourceDocuments.id, documentId));

    if (error instanceof ExtractionError) {
      console.error("[extract]", error.message, error.cause);
      return c.json({ error: error.message }, 422);
    }
    if (error instanceof AiProviderError) {
      console.error("[extract] provider error", error.message);
      return c.json(
        {
          error: "The extraction service is unreachable right now. Your file is saved — try again.",
          retryable: error.retryable,
        },
        502,
      );
    }
    throw error;
  }

  // Re-running extraction replaces the previous batch rather than stacking duplicates.
  await db.delete(extractionClaims).where(eq(extractionClaims.sourceDocumentId, documentId));

  const rows = buildClaimRows(documentId, outcome);
  await insertInChunks(rows, CLAIM_INSERT_BATCH, (batch) =>
    db.insert(extractionClaims).values(batch),
  );

  await db
    .update(sourceDocuments)
    .set({ processingStatus: "extracted" })
    .where(eq(sourceDocuments.id, documentId));

  return c.json({
    documentId,
    pagesProcessed: outcome.pagesProcessed,
    model: outcome.model,
    counts: {
      assignments: outcome.result.assignments.length,
      rejected: outcome.result.rejected.length,
      questions: outcome.result.clarificationQuestions.length,
    },
    // Rejected claims are reported, never hidden — a silent drop looks like a clean read.
    rejected: outcome.result.rejected,
    warnings: outcome.result.warnings,
    claims: rows.map(toClaimView),
  });
});

/** The review queue for one document. */
extractionRoute.get("/documents/:id/extraction", async (c) => {
  const db = getDb(c.env.DB);
  const documentId = c.req.param("id");

  const owned = await loadOwnedDocument(db, documentId, c.get("userId"));
  if (!owned) return c.json({ error: "Document not found" }, 404);

  const claims = await db
    .select()
    .from(extractionClaims)
    .where(eq(extractionClaims.sourceDocumentId, documentId));

  return c.json({
    document: owned.document,
    course: owned.course,
    claims: claims.map(toClaimView),
  });
});

const patchClaimBody = z.object({
  /** Replacement values for the claim's payload; the student's edit wins over the model. */
  payload: z.record(z.unknown()).optional(),
  reviewStatus: z.enum(["pending", "accepted", "rejected", "answered"]).optional(),
});

/** Corrects or accepts/rejects a single claim. User edits always outrank inference. */
extractionRoute.patch("/extraction-claims/:id", async (c) => {
  const db = getDb(c.env.DB);
  const claimId = c.req.param("id");

  const [row] = await db
    .select({ claim: extractionClaims })
    .from(extractionClaims)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, extractionClaims.sourceDocumentId))
    .innerJoin(courses, eq(courses.id, sourceDocuments.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(extractionClaims.id, claimId), eq(terms.userId, c.get("userId"))));
  if (!row) return c.json({ error: "Claim not found" }, 404);

  const parsed = patchClaimBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const payload = parsed.data.payload
    ? { ...(JSON.parse(row.claim.payloadJson) as Record<string, unknown>), ...parsed.data.payload }
    : (JSON.parse(row.claim.payloadJson) as Record<string, unknown>);

  const [updated] = await db
    .update(extractionClaims)
    .set({
      payloadJson: JSON.stringify(payload),
      ...(parsed.data.reviewStatus ? { reviewStatus: parsed.data.reviewStatus } : {}),
    })
    .where(eq(extractionClaims.id, claimId))
    .returning();

  return c.json({ claim: toClaimView(updated!) });
});

const resolveWeekdayBody = z.object({
  /** "Wednesday", "wed", or 0-6. */
  weekday: z.union([z.string(), z.number()]),
  /** Restrict to specific claims; omitted means every unresolved week-range claim. */
  claimIds: z.array(z.string()).optional(),
});

/**
 * Applies one weekday answer to every assignment still listed by week range.
 *
 * This is the other half of a clarification question. A syllabus schedules thirteen
 * quizzes by week and states the weekday once in prose; the extractor is forbidden from
 * joining those facts, so the student is asked. Asking without then acting on the answer
 * leaves them to fix thirteen dates by hand, which is the work the app exists to remove.
 *
 * The resolution is arithmetic over text already in the document, not a second guess:
 * the range came from the syllabus and the weekday came from the student.
 */
extractionRoute.post("/documents/:id/extraction/resolve-weekday", async (c) => {
  const db = getDb(c.env.DB);
  const documentId = c.req.param("id");

  const owned = await loadOwnedDocument(db, documentId, c.get("userId"));
  if (!owned) return c.json({ error: "Document not found" }, 404);

  const parsed = resolveWeekdayBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const weekday = parseWeekday(parsed.data.weekday);
  if (weekday === null) {
    return c.json(
      { error: `"${parsed.data.weekday}" is not a day of the week I recognize.` },
      400,
    );
  }

  const restrictTo = parsed.data.claimIds ? new Set(parsed.data.claimIds) : null;
  const claims = (
    await db
      .select()
      .from(extractionClaims)
      .where(eq(extractionClaims.sourceDocumentId, documentId))
  ).filter((claim) => claim.claimType === "assignment" && (!restrictTo || restrictTo.has(claim.id)));

  const resolved: {
    claimId: string;
    title: string;
    dueDate: string;
    needsAttention: boolean;
    reason: string | null;
  }[] = [];
  const unresolved: { title: string; reason: string }[] = [];
  /** Items dated into a finals window, which need a question raised rather than an answer. */
  const registrarPending: string[] = [];

  for (const claim of claims) {
    const payload = JSON.parse(claim.payloadJson) as ClaimAssignmentPayload & {
      issues?: string[];
      confidenceStatus?: string;
    };
    // Only items still missing a date are candidates; an already-dated item is left alone.
    if (payload.dueDate.iso !== null) continue;
    if (payload.dueDate.raw === null) continue;

    const result = resolveWeekdayForClaim(payload.dueDate.raw, weekday, owned.term);
    if (result === null) {
      unresolved.push({
        title: payload.title,
        reason: `${WEEKDAY_NAMES[weekday]} is not inside "${payload.dueDate.raw}"`,
      });
      continue;
    }

    // Drop the date issues this answer settles, and keep any that it does not.
    const issues = (payload.issues ?? []).filter(
      (issue) => issue !== "AMBIGUOUS_DATE" && issue !== "MISSING_DATE",
    );

    let reason: string | null = null;
    switch (result.basis) {
      case "registrar_window":
        // The span is after the last day of instruction, so there is no class meeting for the
        // student's weekday to name. The date stands as the earliest day it could be — enough
        // to plan revision against — and the real question goes back on the board below.
        if (!issues.includes("DATE_SET_BY_REGISTRAR")) issues.push("DATE_SET_BY_REGISTRAR");
        issues.push("AMBIGUOUS_DATE");
        registrarPending.push(payload.title);
        reason =
          `Finals week: the exact day is set by the registrar, not by class. ` +
          `Planned from ${result.iso}, the earliest it could be.`;
        break;

      case "stale_year":
        // Resolving a range does not launder the year it was printed with. Greek's finals row
        // reads "Dec. 16-19, 2025" in a 2026 term, and answering "Wednesday" would otherwise
        // turn a known-stale date into one the student appears to have confirmed.
        if (!issues.includes("DATE_OUTSIDE_TERM")) issues.push("DATE_OUTSIDE_TERM");
        reason = "This falls outside the term — the syllabus may be a previous year's.";
        break;

      case "class_meeting":
        break;
    }

    await db
      .update(extractionClaims)
      .set({
        payloadJson: JSON.stringify({
          ...payload,
          dueDate: {
            ...payload.dueDate,
            iso: result.iso,
            ambiguity: result.basis === "class_meeting" ? ("none" as const) : payload.dueDate.ambiguity,
          },
          issues,
          // Never "confirmed". The student answered a weekday; the row it was applied to is
          // still a machine's reading of the page, so this cannot come out more trusted than
          // the same item does through the confirm route, which writes `high_inference` for
          // exactly that reason. Marking these settled is what let a registrar-scheduled final
          // exam show up as a fact.
          confidenceStatus: result.basis === "class_meeting" ? "high_inference" : "low_inference",
          resolvedFromWeekday: WEEKDAY_NAMES[weekday],
        }),
      })
      .where(eq(extractionClaims.id, claim.id));

    resolved.push({
      claimId: claim.id,
      title: payload.title,
      dueDate: result.iso,
      needsAttention: result.basis !== "class_meeting",
      reason,
    });
  }

  // A finals window is not something the student can answer from memory and not something the
  // document knows — the registrar publishes it later. That makes it a question worth carrying
  // rather than a warning to read once, so it joins the others on the review screen.
  if (registrarPending.length > 0) {
    await raiseRegistrarQuestion(db, documentId, registrarPending);
  }

  // Mark the questions this answered so the review screen stops asking.
  const questions = (
    await db
      .select()
      .from(extractionClaims)
      .where(eq(extractionClaims.sourceDocumentId, documentId))
  ).filter((claim) => claim.claimType === "clarification_question");

  for (const question of questions) {
    const payload = JSON.parse(question.payloadJson) as { kind?: string };
    if (payload.kind !== "relative_date") continue;
    await db
      .update(extractionClaims)
      .set({
        payloadJson: JSON.stringify({ ...payload, answer: WEEKDAY_NAMES[weekday] }),
        reviewStatus: "answered",
      })
      .where(eq(extractionClaims.id, question.id));
  }

  return c.json({
    weekday: WEEKDAY_NAMES[weekday],
    resolved,
    // Reported rather than silently skipped: a Monday answer against a Tue-Fri week means
    // the student has misremembered, and they need to see that.
    unresolved,
  });
});

/**
 * Puts the registrar's finals date back on the review screen as an open question.
 *
 * Kind is `missing_date`, not `relative_date`, and the difference matters on screen: a
 * relative-date question renders weekday buttons, which is exactly the wrong control here —
 * the student clicking one is what created the problem. A missing-date question renders a
 * free-text box they can fill in when the registrar publishes, and "I don't know yet" stays a
 * real answer in the meantime.
 *
 * Rewritten in place rather than appended, so answering a weekday twice does not stack up
 * duplicate questions on the screen.
 */
async function raiseRegistrarQuestion(db: Db, documentId: string, titles: string[]) {
  const question = {
    question:
      titles.length === 1
        ? `What day is "${titles[0]}" actually on?`
        : `What days are these ${titles.length} finals-week items actually on?`,
    why:
      "The syllabus gives finals week rather than a day, because the registrar sets it. " +
      "Until then this is planned from the first day of that week, which is the earliest it " +
      "could be — worth asking your instructor if they know yet.",
    relatesToTitle: titles[0] ?? null,
    ...(titles.length > 1 ? { relatesToTitles: titles } : {}),
    kind: "missing_date" as const,
    /** Marks this as ours so a second weekday answer replaces it instead of adding another. */
    source: "registrar_window" as const,
  };

  const existing = (
    await db
      .select()
      .from(extractionClaims)
      .where(eq(extractionClaims.sourceDocumentId, documentId))
  ).find((claim) => {
    if (claim.claimType !== "clarification_question") return false;
    return (JSON.parse(claim.payloadJson) as { source?: string }).source === "registrar_window";
  });

  if (existing) {
    await db
      .update(extractionClaims)
      .set({ payloadJson: JSON.stringify(question), reviewStatus: "pending" })
      .where(eq(extractionClaims.id, existing.id));
    return;
  }

  await db.insert(extractionClaims).values({
    id: newId("extractionClaim"),
    sourceDocumentId: documentId,
    claimType: "clarification_question",
    payloadJson: JSON.stringify(question),
    pageNumber: null,
    sourceExcerpt: null,
    confidence: null,
    reviewStatus: "pending",
    promptVersion: "resolve-weekday",
    model: "none",
  });
}

const confirmBody = z.object({
  /** Claim ids the student accepted. Anything omitted is left alone, not silently applied. */
  acceptedClaimIds: z.array(z.string()),
});

/**
 * Promotes accepted claims into real records.
 *
 * This is the only path from extraction into the plan, and it runs on an explicit list of
 * ids the student ticked. Confirmed work items are marked `high_inference` rather than
 * `confirmed`: the student vouched for the item existing, but the underlying reading was
 * still a machine's, and the planner should stay slightly conservative until a date has
 * actually been edited or verified.
 */
extractionRoute.post("/documents/:id/extraction/confirm", async (c) => {
  const db = getDb(c.env.DB);
  const documentId = c.req.param("id");

  const owned = await loadOwnedDocument(db, documentId, c.get("userId"));
  if (!owned) return c.json({ error: "Document not found" }, 404);

  const parsed = confirmBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const accepted = new Set(parsed.data.acceptedClaimIds);
  const claims = (
    await db
      .select()
      .from(extractionClaims)
      .where(eq(extractionClaims.sourceDocumentId, documentId))
  ).filter((claim) => accepted.has(claim.id));

  if (claims.length === 0) return c.json({ error: "No claims were selected." }, 400);

  const courseId = owned.course.id;
  const created = { categories: 0, meetingPatterns: 0, workItems: 0 };

  // --- Grading categories first: assignments reference them by name.
  const existingCategories = await db
    .select()
    .from(gradingCategories)
    .where(eq(gradingCategories.courseId, courseId));
  const categoryIdByName = new Map(
    existingCategories.map((c) => [c.name.trim().toLowerCase(), c.id]),
  );

  for (const claim of claims.filter((c) => c.claimType === "grading_category")) {
    const payload = JSON.parse(claim.payloadJson) as {
      name: string;
      weightPercent: number | null;
      dropLowest: number | null;
    };
    const key = payload.name.trim().toLowerCase();
    if (categoryIdByName.has(key)) continue;

    const id = newId("gradingCategory");
    await db.insert(gradingCategories).values({
      id,
      courseId,
      name: payload.name,
      weightPercent: payload.weightPercent,
      dropRuleJson: payload.dropLowest ? JSON.stringify({ dropLowest: payload.dropLowest }) : null,
      confidenceStatus: "high_inference",
    });
    categoryIdByName.set(key, id);
    created.categories++;
    await markResolved(db, claim.id, "grading_category", id);
  }

  // --- Meeting patterns.
  for (const claim of claims.filter((c) => c.claimType === "meeting_pattern")) {
    const payload = JSON.parse(claim.payloadJson) as {
      daysOfWeek: number[];
      startTime: string;
      endTime: string;
      location: string | null;
    };
    const id = newId("meetingPattern");
    await db.insert(meetingPatterns).values({
      id,
      courseId,
      daysOfWeek: serializeDays(payload.daysOfWeek),
      startTime: payload.startTime,
      endTime: payload.endTime,
      location: payload.location,
      effectiveStart: owned.term.startDate,
      effectiveEnd: owned.term.endDate,
    });
    created.meetingPatterns++;
    await markResolved(db, claim.id, "meeting_pattern", id);
  }

  // --- Assignments.
  for (const claim of claims.filter((c) => c.claimType === "assignment")) {
    const payload = JSON.parse(claim.payloadJson) as ClaimAssignmentPayload;
    const id = newId("workItem");
    const dueAt = toDueAt(payload.dueDate);

    await db.insert(workItems).values({
      id,
      courseId,
      parentWorkItemId: null,
      title: payload.title,
      description: null,
      workType: payload.isMajorProject && payload.type === "exam" ? "exam" : payload.type,
      availableAt: null,
      dueAt,
      pointsPossible: payload.pointsPossible,
      gradingCategoryId: payload.category
        ? (categoryIdByName.get(payload.category.trim().toLowerCase()) ?? null)
        : null,
      categorySharePercent: null,
      // Effort is genuinely unknown: a syllabus states what is due, not how long it takes.
      // The planner falls back to a type-based estimate and flags it as a risk.
      estimatedMinutes: null,
      remainingMinutes: null,
      cognitiveDemand: payload.isMajorProject ? "high" : "medium",
      divisibility: "divisible",
      locationRequirement: "anywhere",
      // A confirmed item with no resolved date is still unconfirmed for planning purposes.
      status: dueAt === null ? "unconfirmed" : "not_started",
      sourceConfidence: dueAt === null ? "unknown" : "high_inference",
      userPriority: 0,
    });
    created.workItems++;
    await markResolved(db, claim.id, "work_item", id);
  }

  await db
    .update(sourceDocuments)
    .set({ processingStatus: "confirmed" })
    .where(eq(sourceDocuments.id, documentId));

  return c.json({ ok: true, created });
});

async function markResolved(db: Db, claimId: string, entityType: string, entityId: string) {
  await db
    .update(extractionClaims)
    .set({ reviewStatus: "accepted", resolvedEntityType: entityType, resolvedEntityId: entityId })
    .where(eq(extractionClaims.id, claimId));
}

interface ClaimAssignmentPayload {
  title: string;
  type:
    | "reading"
    | "quiz"
    | "problem_set"
    | "paper"
    | "presentation"
    | "group_project"
    | "exam"
    | "lab"
    | "discussion"
    | "other";
  dueDate: Parameters<typeof toDueAt>[0];
  pointsPossible: number | null;
  category: string | null;
  isMajorProject: boolean;
  issues?: string[];
  duplicateOf?: string | null;
  confidenceStatus?: string;
}

type ClaimRow = typeof extractionClaims.$inferInsert;

/** Flattens the validated extraction into ExtractionClaim rows (docs/05 §2). */
function buildClaimRows(
  documentId: string,
  outcome: Awaited<ReturnType<typeof extractSyllabus>>,
): ClaimRow[] {
  const { result, promptVersion, model } = outcome;
  const rows: ClaimRow[] = [];

  const base = {
    sourceDocumentId: documentId,
    reviewStatus: "pending" as const,
    promptVersion,
    model,
  };

  for (const item of result.assignments) {
    rows.push({
      ...base,
      id: newId("extractionClaim"),
      claimType: "assignment",
      payloadJson: JSON.stringify(assignmentPayload(item)),
      pageNumber: item.assignment.evidence.page,
      sourceExcerpt: item.assignment.evidence.excerpt,
      confidence: item.assignment.confidence,
    });
  }

  for (const category of result.gradingCategories) {
    rows.push({
      ...base,
      id: newId("extractionClaim"),
      claimType: "grading_category",
      payloadJson: JSON.stringify({
        name: category.name,
        weightPercent: category.weightPercent,
        dropLowest: category.dropLowest,
      }),
      pageNumber: category.evidence.page,
      sourceExcerpt: category.evidence.excerpt,
      confidence: category.confidence,
    });
  }

  for (const pattern of result.meetingPatterns) {
    rows.push({
      ...base,
      id: newId("extractionClaim"),
      claimType: "meeting_pattern",
      payloadJson: JSON.stringify({
        daysOfWeek: pattern.daysOfWeek,
        startTime: pattern.startTime,
        endTime: pattern.endTime,
        location: pattern.location,
      }),
      pageNumber: pattern.evidence.page,
      sourceExcerpt: pattern.evidence.excerpt,
      confidence: pattern.confidence,
    });
  }

  if (result.courseFacts.evidence) {
    rows.push({
      ...base,
      id: newId("extractionClaim"),
      claimType: "course_fact",
      payloadJson: JSON.stringify({
        name: result.courseFacts.name,
        code: result.courseFacts.code,
        instructor: result.courseFacts.instructor,
      }),
      pageNumber: result.courseFacts.evidence.page,
      sourceExcerpt: result.courseFacts.evidence.excerpt,
      confidence: result.courseFacts.confidence,
    });
  }

  for (const policy of result.policies) {
    rows.push({
      ...base,
      id: newId("extractionClaim"),
      claimType: "policy",
      payloadJson: JSON.stringify({ kind: policy.kind, summary: policy.summary }),
      pageNumber: policy.evidence.page,
      sourceExcerpt: policy.evidence.excerpt,
      confidence: policy.confidence,
    });
  }

  // Questions are claims too, so the review UI can show and answer them in one place.
  for (const question of result.clarificationQuestions) {
    rows.push({
      ...base,
      id: newId("extractionClaim"),
      claimType: "clarification_question",
      payloadJson: JSON.stringify(question),
      pageNumber: null,
      sourceExcerpt: null,
      confidence: null,
    });
  }

  return rows;
}

function assignmentPayload(item: ValidatedAssignment) {
  return {
    title: item.assignment.title,
    type: item.assignment.type,
    dueDate: item.assignment.dueDate,
    pointsPossible: item.assignment.pointsPossible,
    category: item.assignment.category,
    isMajorProject: item.assignment.isMajorProject,
    // Carried into the payload so the review UI can explain why something needs a look.
    issues: item.issues,
    duplicateOf: item.duplicateOf,
    confidenceStatus: item.confidenceStatus,
    evidenceVerified: item.evidenceVerified,
  };
}

function toClaimView(claim: ClaimRow) {
  return {
    id: claim.id,
    claimType: claim.claimType,
    payload: JSON.parse(claim.payloadJson) as Record<string, unknown>,
    pageNumber: claim.pageNumber ?? null,
    sourceExcerpt: claim.sourceExcerpt ?? null,
    confidence: claim.confidence ?? null,
    reviewStatus: claim.reviewStatus ?? "pending",
  };
}
