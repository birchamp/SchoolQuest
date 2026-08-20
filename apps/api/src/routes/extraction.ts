import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { newId, termCalendar } from "@schoolquest/domain";
import {
  AiProviderError,
  createOpenRouterProvider,
  extractSyllabus,
  ExtractionError,
  isWithinTerm,
  parseStatedDate,
  calibrateWeeks,
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
import { getDb, insertInChunks, parseDays, serializeDays, type Db } from "../db/repo.js";
import { NO_PROVIDER_MESSAGE, providerForUser } from "../provider-for-user.js";
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

  const provider_ = await providerForUser(db, c.env, c.get("userId"));
  if (!provider_.apiKey) return c.json({ error: NO_PROVIDER_MESSAGE }, 503);

  /**
   * No syllabus is read before the term's calendar is known. A refusal, not a warning.
   *
   * A syllabus does not contain a calendar — it points at one. "Week 14", "each Tuesday in
   * class", "finals week" and "the Friday before break" are all references to dates the document
   * does not hold, and reading them against an empty calendar does not fail loudly. It produces
   * a date, silently, off by however much the guess was wrong: Problem Set 6 onto Thanksgiving,
   * sixteen weekly responses where fifteen weeks exist, an exam placed inside spring break.
   *
   * That ordering was already argued in the UI, where the calendar card sits first and upload is
   * discouraged without it — but discouraged is not prevented, and the wrong dates it produces
   * are the kind nobody notices until the deadline has passed. So the API refuses, which is the
   * only place the rule actually holds regardless of which client is calling.
   */
  const calendar = termCalendar.parse(JSON.parse(owned.term.calendarJson || "{}"));
  if (calendar.exceptions.length === 0) {
    return c.json(
      {
        error:
          "This term has no academic calendar yet, so a syllabus cannot be read against it. " +
          "Add the term's breaks and finals week first — every \"Week 12\" and \"finals week\" " +
          "in a syllabus is a date that only the calendar knows.",
        code: "TERM_CALENDAR_REQUIRED",
      },
      409,
    );
  }

  const parsed = extractBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await db
    .update(sourceDocuments)
    .set({ processingStatus: "processing" })
    .where(eq(sourceDocuments.id, documentId));

  const provider = createOpenRouterProvider({
    apiKey: provider_.apiKey,
    defaultModel: provider_.extractionModel,
    appUrl: c.env.APP_URL,
    appName: c.env.APP_NAME,
    ...(c.env.OPENROUTER_BASE_URL ? { baseUrl: c.env.OPENROUTER_BASE_URL } : {}),
  });

  // Days the course is already known to meet -- from an earlier read, a pasted timetable, or the
  // student typing them in. Passed to extraction so a rule stated per class session ("a quiz every
  // class") is dated even when this syllabus omits the meeting times, and so it does not ask for
  // times the app already has.
  const existingMeetings = await db
    .select({ daysOfWeek: meetingPatterns.daysOfWeek })
    .from(meetingPatterns)
    .where(eq(meetingPatterns.courseId, owned.course.id));
  const knownMeetingDays = [
    ...new Set(existingMeetings.flatMap((m) => parseDays(m.daysOfWeek))),
  ].sort((a, b) => a - b);

  let outcome;
  try {
    outcome = await extractSyllabus(provider, {
      pages: parsed.data.pages,
      termStartDate: owned.term.startDate,
      termEndDate: owned.term.endDate,
      termCalendar: calendar,
      courseName: owned.course.name,
      ...(knownMeetingDays.length > 0 ? { knownMeetingDays } : {}),
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

  const calendar = termCalendar.parse(JSON.parse(owned.term.calendarJson || "{}"));

  /**
   * What this document means by "Week N", worked out before any claim is resolved.
   *
   * Read back off the anchor claims the extraction stored. A syllabus counting from a Monday the
   * term row does not know about is the ordinary case, not the exotic one — and it produced a
   * date inside spring break on a real document.
   */
  const anchorRows = (
    await db.select().from(extractionClaims).where(eq(extractionClaims.sourceDocumentId, documentId))
  ).filter((claim) => claim.claimType === "schedule_anchor");
  const calibration = calibrateWeeks(
    anchorRows.map((row) => {
      const payload = JSON.parse(row.payloadJson) as {
        weekNumber: number;
        raw: string | null;
        isBreak: boolean;
      };
      return {
        ...payload,
        evidence: { page: row.pageNumber ?? 1, excerpt: row.sourceExcerpt ?? "" },
      };
    }),
    { startDate: owned.term.startDate, endDate: owned.term.endDate, calendar },
  );

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

    const result = resolveWeekdayForClaim(payload.dueDate.raw, weekday, {
      startDate: owned.term.startDate,
      endDate: owned.term.endDate,
      calendar: calendar,
      ...(calibration.weekOneMonday !== null ? { calibration } : {}),
    });
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

      case "week_number_ambiguous":
        // The term has a break before this week and nobody has said whether this school's
        // syllabi keep counting through it. Both readings are a week apart and defensible.
        // This is the exact shape that put MAT 205's Problem Set 6 in Thanksgiving week when
        // it was silently one answer.
        if (!issues.includes("WEEK_NUMBER_AMBIGUOUS")) issues.push("WEEK_NUMBER_AMBIGUOUS");
        issues.push("AMBIGUOUS_DATE");
        reason =
          `"${payload.dueDate.raw}" is after a break. Counting break weeks gives ` +
          `${result.alternativeIso ?? "another date"}; not counting them gives ${result.iso}. ` +
          `Planned from ${result.iso} — check which your syllabus means.`;
        break;

      case "not_a_class_day":
        // The answer resolves onto a day inside a break, so whatever it describes it is not a
        // class meeting.
        if (!issues.includes("DATE_IN_BREAK")) issues.push("DATE_IN_BREAK");
        issues.push("AMBIGUOUS_DATE");
        reason = "That lands inside a break, when there is no class.";
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


const answerQuestionBody = z.object({
  /** The clarification question claim being answered. */
  questionClaimId: z.string(),
  /** What the student typed. May be anything, including "I don't know". */
  answer: z.string().min(1).max(400),
});

/**
 * Applies a student's answer to a clarification question.
 *
 * ## Why this exists
 *
 * Answering a question used to do nothing. The review screen took the text, PATCHed it onto
 * the question claim, flipped `reviewStatus` to "answered", removed it from the screen — and
 * left the underlying claim exactly as broken as before. Nothing anywhere read `payload.answer`.
 * Only the weekday buttons acted, and only on `relative_date` questions.
 *
 * That made every review step a guaranteed pass: the questions disappear, the screen goes
 * clean, and the plan is unchanged. On a corpus of twenty real syllabuses it is the single
 * most costly false pass, because clarification is the app's whole answer to the ambiguity it
 * correctly detects.
 *
 * ## What an answer is allowed to do
 *
 * Set a date on the claims the question is about, and nothing else. `parseStatedDate` reads a
 * date and refuses everything else, so "I don't know", "ask the professor" and "sometime in
 * week 3" are recorded as text and change no deadline — a wrong date the student appears to
 * have confirmed is worse than the missing one it replaced.
 *
 * The result is reported back rather than assumed. A screen that says "noted, this did not
 * change anything" is honest; one that silently accepts is how the dead end survived.
 */
extractionRoute.post("/documents/:id/extraction/answer", async (c) => {
  const db = getDb(c.env.DB);
  const documentId = c.req.param("id");

  const owned = await loadOwnedDocument(db, documentId, c.get("userId"));
  if (!owned) return c.json({ error: "Document not found" }, 404);

  const parsed = answerQuestionBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const claims = await db
    .select()
    .from(extractionClaims)
    .where(eq(extractionClaims.sourceDocumentId, documentId));

  const question = claims.find(
    (x) => x.id === parsed.data.questionClaimId && x.claimType === "clarification_question",
  );
  if (!question) return c.json({ error: "Question not found" }, 404);

  const qPayload = JSON.parse(question.payloadJson) as {
    kind?: string;
    relatesToTitle?: string | null;
    relatesToTitles?: string[];
  };

  await db
    .update(extractionClaims)
    .set({
      payloadJson: JSON.stringify({ ...qPayload, answer: parsed.data.answer }),
      reviewStatus: "answered",
    })
    .where(eq(extractionClaims.id, question.id));

  // A grouped question names every title it collapsed; a single one names just the one.
  const titles = new Set(
    [...(qPayload.relatesToTitles ?? []), qPayload.relatesToTitle ?? null].filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    ),
  );

  const iso = parseStatedDate(parsed.data.answer, Number(owned.term.startDate.slice(0, 4)));
  if (iso === null || titles.size === 0) {
    return c.json({
      recorded: true,
      applied: [],
      // Said plainly so the screen can repeat it. Recording an answer that changes nothing is
      // a legitimate outcome; pretending it changed something is not.
      note:
        titles.size === 0
          ? "Recorded. This question is not about a specific assignment, so nothing was re-dated."
          : "Recorded, but no date was found in that answer, so nothing was re-dated.",
    });
  }

  const outsideTerm = !isWithinTerm(iso, owned.term.startDate, owned.term.endDate);
  const applied: { claimId: string; title: string; dueDate: string }[] = [];

  for (const claim of claims) {
    if (claim.claimType !== "assignment") continue;
    const payload = JSON.parse(claim.payloadJson) as ClaimAssignmentPayload & {
      issues?: string[];
      confidenceStatus?: string;
    };
    if (!titles.has(payload.title)) continue;

    const issues = (payload.issues ?? []).filter(
      (issue) => issue !== "AMBIGUOUS_DATE" && issue !== "MISSING_DATE",
    );
    if (outsideTerm && !issues.includes("DATE_OUTSIDE_TERM")) issues.push("DATE_OUTSIDE_TERM");

    await db
      .update(extractionClaims)
      .set({
        payloadJson: JSON.stringify({
          ...payload,
          dueDate: { ...payload.dueDate, iso, ambiguity: "none" as const },
          issues,
          // The student typed this date, so it is theirs rather than a reading of the page —
          // but the item it belongs to is still a machine's reading, which is why this is not
          // "confirmed". The same reasoning the confirm route uses.
          confidenceStatus: outsideTerm ? "low_inference" : "high_inference",
          answeredByStudent: parsed.data.answer,
        }),
      })
      .where(eq(extractionClaims.id, claim.id));

    applied.push({ claimId: claim.id, title: payload.title, dueDate: iso });
  }

  return c.json({
    recorded: true,
    applied,
    note:
      applied.length === 0
        ? "Recorded, but nothing matching that question was found to re-date."
        : outsideTerm
          ? `Dated ${applied.length} item${applied.length === 1 ? "" : "s"} to ${iso}, which falls outside your term — check the year.`
          : `Dated ${applied.length} item${applied.length === 1 ? "" : "s"} to ${iso}.`,
  });
});

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

  /**
   * The course now knows how its grade is built, so say so.
   *
   * Without this the flag never moved off its `"unknown"` default for any course created by
   * ingest — only the manual add-a-course form ever set it — so a term with every category
   * stored, weighted and accepted still read as a term nobody knew the grading for. Measured on
   * the ingested-semester fixture: five courses, all their categories present, all five
   * `"unknown"`.
   *
   * `high_inference`, not `confirmed`: the student accepted the claim, but a model did the
   * reading. That is the same standing the categories themselves get two lines above, and the
   * same one the confirm route gives a dated work item.
   */
  if (categoryIdByName.size > 0) {
    await db
      .update(courses)
      .set({ gradingConfidence: "high_inference" })
      .where(and(eq(courses.id, courseId), eq(courses.gradingConfidence, "unknown")));
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
      /**
       * Accepting an item in review is the human confirmation the whole screen exists to get.
       *
       * The student is shown each date beside the exact line it was read from and asked to
       * uncheck anything wrong; clicking through is affirming what is left. So a solid date --
       * one the validator read straight off the page with no doubt about it (`high_inference`)
       * -- becomes `confirmed` here, and stops being flagged "date unconfirmed" on every screen.
       * A genuinely doubtful date (`low_inference`: read from a stale year, resolved outside the
       * term, or not found in the source) keeps its flag even when accepted, because accepting
       * that the assignment exists is not the same as vouching for a date the document itself
       * casts doubt on -- that is what its clarification question is for. No resolved date at all
       * stays `unknown`.
       */
      sourceConfidence:
        dueAt === null
          ? "unknown"
          : payload.confidenceStatus === "low_inference"
            ? "low_inference"
            : "confirmed",
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

  /**
   * Week headers are stored so the *document's* numbering survives the request that read it.
   *
   * "Week 10" cannot be resolved when it is extracted — the student has not yet said which
   * weekday their work is due — so by the time the answer arrives the only thing that knows this
   * syllabus numbers its break as week 9 is a claim row.
   */
  for (const anchor of result.scheduleAnchors) {
    rows.push({
      ...base,
      id: newId("extractionClaim"),
      claimType: "schedule_anchor",
      payloadJson: JSON.stringify({
        weekNumber: anchor.weekNumber,
        raw: anchor.raw,
        isBreak: anchor.isBreak,
      }),
      pageNumber: anchor.evidence.page,
      sourceExcerpt: anchor.evidence.excerpt,
      confidence: 1,
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
      // The line the question came from, on the same two columns every other claim uses, so
      // anything reading claims generically shows a question's source without knowing it is a
      // question. The full set stays in the payload; these two are the first of them.
      pageNumber: question.evidence?.[0]?.page ?? null,
      sourceExcerpt: question.evidence?.[0]?.excerpt ?? null,
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
