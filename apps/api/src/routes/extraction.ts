import { Hono } from "hono";
import { and, eq, getTableColumns, inArray, sql, type Table } from "drizzle-orm";
import { z } from "zod";
import { newId, termCalendar } from "@schoolquest/domain";
import {
  extractSyllabus,
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
  workItems,
} from "../db/schema.js";
import { getDb, serializeDays, type Db } from "../db/repo.js";
import {
  asExtractedDate,
  assignmentClaimPayload,
  gradingCategoryClaimPayload,
  meetingPatternClaimPayload,
  questionClaimPayload,
  scheduleAnchorClaimPayload,
} from "../db/claim-payloads.js";
import { loadOwnedClaim, loadOwnedDocument } from "../db/ownership.js";
import { aiErrorResponse } from "../lib/ai-errors.js";
import { jsonObject, parseJsonColumn, requireJsonColumn } from "../lib/json-column.js";
import { openRouterFor } from "../lib/openrouter.js";
import { NO_PROVIDER_MESSAGE, providerForUser } from "../provider-for-user.js";
import { studentZone } from "../student-zone.js";
import { rateLimitPerUser } from "../rate-limit.js";
import type { AppBindings } from "../env.js";

export const extractionRoute = new Hono<AppBindings>();

/**
 * Stored claim payloads are read with `requireJsonColumn` throughout this file: every read here is
 * followed by a write -- a rewrite of the claim, or its promotion into real records -- and a
 * corrupt payload must stop that rather than be written back as defaults. Only `toClaimView`,
 * which renders, falls back. See lib/json-column.ts.
 */
const PAYLOAD = "extraction_claims.payload_json";
const CALENDAR = "terms.calendar_json";

const extractBody = z.object({
  pages: z
    .array(z.object({ page: z.number().int().positive(), text: z.string() }))
    .min(1)
    .max(60),
});

/**
 * How much page text one extraction request may carry.
 *
 * The model is only ever shown the first 24 non-blank pages at 6,000 characters each
 * (`preparePages` in @schoolquest/ai), so anything past that is parsed and held in memory for
 * nothing. The caps are still far above it, because the web reader sends whatever the file held:
 * a dense PDF page runs 3,000-6,000 characters, and a .docx with no forced page breaks arrives as
 * a single "page" holding the whole document, which for a long course packet is well over 100,000.
 * What they stop is a body nobody's syllabus produces.
 */
const MAX_PAGE_CHARS = 200_000;
const MAX_TOTAL_CHARS = 600_000;

/** A sentence for the student when the text is over a cap, or null when it fits. */
function pagesTooLarge(pages: { page: number; text: string }[]): string | null {
  const long = pages.find((p) => p.text.length > MAX_PAGE_CHARS);
  if (long) {
    return (
      `Page ${long.page} holds ${long.text.length.toLocaleString("en-US")} characters of text, ` +
      `more than the ${MAX_PAGE_CHARS.toLocaleString("en-US")} one page may carry. ` +
      "Upload just the syllabus rather than the whole course packet."
    );
  }
  const total = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    return (
      `This document holds ${total.toLocaleString("en-US")} characters of text, more than the ` +
      `${MAX_TOTAL_CHARS.toLocaleString("en-US")} a syllabus can be read from at once. ` +
      "Upload just the syllabus rather than the whole course packet."
    );
  }
  return null;
}

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
extractionRoute.post("/documents/:id/extract", rateLimitPerUser("syllabusExtract"), async (c) => {
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
  const calendar = requireJsonColumn(termCalendar, owned.term.calendarJson || "{}", CALENDAR);
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
  const tooLarge = pagesTooLarge(parsed.data.pages);
  if (tooLarge) return c.json({ error: tooLarge, code: "PAGE_TEXT_TOO_LARGE" }, 413);

  await db
    .update(sourceDocuments)
    .set({ processingStatus: "processing" })
    .where(eq(sourceDocuments.id, documentId));

  const provider = openRouterFor(c.env, provider_.apiKey, provider_.extractionModel);

  let outcome;
  try {
    outcome = await extractSyllabus(provider, {
      pages: parsed.data.pages,
      termStartDate: owned.term.startDate,
      termEndDate: owned.term.endDate,
      termCalendar: calendar,
      courseName: owned.course.name,
    });
  } catch (error) {
    await db
      .update(sourceDocuments)
      .set({ processingStatus: "failed" })
      .where(eq(sourceDocuments.id, documentId));

    const answer = aiErrorResponse(c, error, {
      unreachable: "The extraction service is unreachable right now. Your file is saved — try again.",
      logTag: "extract",
    });
    if (answer) return answer;
    throw error;
  }

  /**
   * Re-running extraction replaces the previous batch rather than stacking duplicates.
   *
   * One transaction: deleting first and inserting after, as separate statements, meant a failure
   * between the two left the document with no claims at all -- the old reading gone and the new
   * one never written.
   */
  const rows = buildClaimRows(documentId, outcome);
  await db.batch([
    db.delete(extractionClaims).where(eq(extractionClaims.sourceDocumentId, documentId)),
    ...insertStatements(rows, extractionClaims, (batch) =>
      db.insert(extractionClaims).values(batch),
    ),
    db
      .update(sourceDocuments)
      .set({ processingStatus: "extracted" })
      .where(eq(sourceDocuments.id, documentId)),
  ]);

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

  const claim = await loadOwnedClaim(db, claimId, c.get("userId"));
  if (!claim) return c.json({ error: "Claim not found" }, 404);

  const parsed = patchClaimBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const stored = requireJsonColumn(jsonObject, claim.payloadJson, PAYLOAD);
  const payload = parsed.data.payload ? { ...stored, ...parsed.data.payload } : stored;

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

  const calendar = requireJsonColumn(termCalendar, owned.term.calendarJson || "{}", CALENDAR);

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
      const payload = requireJsonColumn(scheduleAnchorClaimPayload, row.payloadJson, PAYLOAD);
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
    const payload = requireJsonColumn(assignmentClaimPayload, claim.payloadJson, PAYLOAD);
    // Only items still missing a date are candidates; an already-dated item is left alone.
    if (payload.dueDate.iso !== null) continue;
    if (payload.dueDate.raw === null || payload.dueDate.raw === undefined) continue;

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
    const payload = requireJsonColumn(questionClaimPayload, question.payloadJson, PAYLOAD);
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
    return requireJsonColumn(questionClaimPayload, claim.payloadJson, PAYLOAD).source === "registrar_window";
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

  const qPayload = requireJsonColumn(questionClaimPayload, question.payloadJson, PAYLOAD);

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
    const payload = requireJsonColumn(assignmentClaimPayload, claim.payloadJson, PAYLOAD);
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
  const selected = (
    await db
      .select()
      .from(extractionClaims)
      .where(eq(extractionClaims.sourceDocumentId, documentId))
  ).filter((claim) => accepted.has(claim.id));

  if (selected.length === 0) return c.json({ error: "No claims were selected." }, 400);

  /**
   * Only claims still waiting for review are promoted.
   *
   * Without this a double click, or a retry after the first response was lost, ran the whole
   * promotion again: every meeting pattern and every assignment created a second time, a
   * duplicate the planner then books hours for. A claim that has already been accepted is done;
   * submitting it again is answered as a confirm that created nothing.
   */
  const claims = selected.filter((claim) => claim.reviewStatus === "pending");

  const courseId = owned.course.id;
  const created = { categories: 0, meetingPatterns: 0, workItems: 0 };
  if (claims.length === 0) return c.json({ ok: true, created });

  /**
   * Every write below goes into one `db.batch`, which D1 runs as a single transaction.
   *
   * It used to be two sequential statements per claim with nothing tying them together, so a
   * failure halfway through left some items created and their claims still pending -- and the
   * retry that followed created those items again. Now the records and the claims that point at
   * them land together or not at all.
   */
  const newCategories: (typeof gradingCategories.$inferInsert)[] = [];
  const newPatterns: (typeof meetingPatterns.$inferInsert)[] = [];
  const newItems: (typeof workItems.$inferInsert)[] = [];
  const resolved: Record<ResolvedEntityType, { claimId: string; entityId: string }[]> = {
    grading_category: [],
    meeting_pattern: [],
    work_item: [],
  };

  // --- Grading categories first: assignments reference them by name.
  const existingCategories = await db
    .select()
    .from(gradingCategories)
    .where(eq(gradingCategories.courseId, courseId));
  const categoryIdByName = new Map(
    existingCategories.map((c) => [c.name.trim().toLowerCase(), c.id]),
  );

  for (const claim of claims.filter((c) => c.claimType === "grading_category")) {
    const payload = requireJsonColumn(gradingCategoryClaimPayload, claim.payloadJson, PAYLOAD);
    const key = payload.name.trim().toLowerCase();
    if (categoryIdByName.has(key)) continue;

    const id = newId("gradingCategory");
    newCategories.push({
      id,
      courseId,
      name: payload.name,
      weightPercent: payload.weightPercent,
      dropRuleJson: payload.dropLowest ? JSON.stringify({ dropLowest: payload.dropLowest }) : null,
      confidenceStatus: "high_inference",
    });
    categoryIdByName.set(key, id);
    created.categories++;
    resolved.grading_category.push({ claimId: claim.id, entityId: id });
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
  const gradingKnown =
    categoryIdByName.size > 0
      ? [
          db
            .update(courses)
            .set({ gradingConfidence: "high_inference" })
            .where(and(eq(courses.id, courseId), eq(courses.gradingConfidence, "unknown"))),
        ]
      : [];

  // --- Meeting patterns.
  for (const claim of claims.filter((c) => c.claimType === "meeting_pattern")) {
    const payload = requireJsonColumn(meetingPatternClaimPayload, claim.payloadJson, PAYLOAD);
    const id = newId("meetingPattern");
    newPatterns.push({
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
    resolved.meeting_pattern.push({ claimId: claim.id, entityId: id });
  }

  // --- Assignments. The syllabus's dates are the student's local ones; stored as UTC.
  const timeZone = await studentZone(db, c.get("userId"));
  for (const claim of claims.filter((c) => c.claimType === "assignment")) {
    const payload = requireJsonColumn(assignmentClaimPayload, claim.payloadJson, PAYLOAD);
    const id = newId("workItem");
    const dueAt = toDueAt(asExtractedDate(payload.dueDate), timeZone);

    newItems.push({
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
    resolved.work_item.push({ claimId: claim.id, entityId: id });
  }

  const claimIds = claims.map((claim) => claim.id);
  try {
    await db.batch([
      stillPendingGuard(db, documentId, claimIds),
      db
        .update(sourceDocuments)
        .set({ processingStatus: "confirmed" })
        .where(eq(sourceDocuments.id, documentId)),
      ...insertStatements(newCategories, gradingCategories, (rows) =>
        db.insert(gradingCategories).values(rows),
      ),
      ...gradingKnown,
      ...insertStatements(newPatterns, meetingPatterns, (rows) =>
        db.insert(meetingPatterns).values(rows),
      ),
      ...insertStatements(newItems, workItems, (rows) => db.insert(workItems).values(rows)),
      ...(Object.keys(resolved) as ResolvedEntityType[]).flatMap((type) =>
        markResolved(db, type, resolved[type]),
      ),
    ]);
  } catch (error) {
    /**
     * The guard refused, or something else failed; either way nothing above was written. Which
     * one is told by looking: if another submit promoted any of these claims between our read
     * and our batch, that is the guard. Two simultaneous submits of the same list -- a double
     * click that beat the button disabling -- leave the loser with nothing left to do, which is
     * the same answer a repeat submit gets. A list that only partly overlapped is refused, so
     * the student reloads and sees what is actually still waiting.
     */
    const now = await db
      .select({ id: extractionClaims.id, reviewStatus: extractionClaims.reviewStatus })
      .from(extractionClaims)
      .where(eq(extractionClaims.sourceDocumentId, documentId));
    const stillPending = now.filter(
      (claim) => claim.reviewStatus === "pending" && claimIds.includes(claim.id),
    ).length;
    if (stillPending === claimIds.length) throw error;
    const none = { categories: 0, meetingPatterns: 0, workItems: 0 };
    if (stillPending === 0) return c.json({ ok: true, created: none });
    return c.json(
      { error: "Some of these were confirmed somewhere else meanwhile. Reload and try again." },
      409,
    );
  }

  return c.json({ ok: true, created });
});

/**
 * The first statement of the confirm batch: fails the whole batch unless every claim it is about
 * to promote is still pending *at the moment the batch runs*.
 *
 * The route filters to pending claims when the request starts, but two submits arriving together
 * both pass that read before either writes, and both batches then committed -- every assignment
 * created twice. D1 runs a batch as one transaction and one writer at a time, so a check inside
 * the batch sees the other submit's committed claims.
 *
 * SQLite has no RAISE outside a trigger, so the refusal is a constraint: when the count is wrong
 * this sets this document's claim ids to NULL, which their NOT NULL constraint rejects, and the
 * batch rolls back. When the count is right the WHERE matches no row and nothing changes. The ids travel as one JSON array so
 * a long syllabus stays under D1's bound-parameter ceiling.
 */
function stillPendingGuard(db: Db, documentId: string, claimIds: string[]) {
  const pending = sql`(
    SELECT count(*) FROM extraction_claims
    WHERE source_document_id = ${documentId}
      AND review_status = 'pending'
      AND id IN (SELECT value FROM json_each(${JSON.stringify(claimIds)}))
  )`;
  return db
    .update(extractionClaims)
    .set({ id: sql`NULL` })
    .where(
      and(eq(extractionClaims.sourceDocumentId, documentId), sql`${pending} != ${claimIds.length}`),
    );
}

/**
 * D1 refuses a statement with more than 100 bound parameters, so a multi-row INSERT has to be
 * split by the table's width: a work item binds 21 values a row, which is four rows a statement.
 */
const D1_MAX_BOUND_PARAMS = 100;

function insertStatements<Row, Statement>(
  rows: Row[],
  table: Table,
  build: (rows: Row[]) => Statement,
): Statement[] {
  const perStatement = Math.floor(D1_MAX_BOUND_PARAMS / Object.keys(getTableColumns(table)).length);
  const statements: Statement[] = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    statements.push(build(rows.slice(i, i + perStatement)));
  }
  return statements;
}

type ResolvedEntityType = "grading_category" | "meeting_pattern" | "work_item";

/**
 * Marks claims accepted and points each at the record it became.
 *
 * One UPDATE per group of claims rather than one per claim: the entity id differs per row, so it
 * is chosen by a CASE on the claim id. Each claim binds three values (twice in the CASE, once in
 * the IN list) plus two shared ones, which keeps a group of thirty under D1's ceiling.
 */
const CLAIMS_PER_RESOLVE = 30;

function markResolved(
  db: Db,
  entityType: ResolvedEntityType,
  pairs: { claimId: string; entityId: string }[],
) {
  const statements = [];
  for (let i = 0; i < pairs.length; i += CLAIMS_PER_RESOLVE) {
    const group = pairs.slice(i, i + CLAIMS_PER_RESOLVE);
    const cases = sql.join(
      group.map((p) => sql`WHEN ${p.claimId} THEN ${p.entityId}`),
      sql` `,
    );
    statements.push(
      db
        .update(extractionClaims)
        .set({
          reviewStatus: "accepted",
          resolvedEntityType: entityType,
          resolvedEntityId: sql`CASE ${extractionClaims.id} ${cases} END`,
        })
        .where(
          inArray(
            extractionClaims.id,
            group.map((p) => p.claimId),
          ),
        ),
    );
  }
  return statements;
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
    // Rendered, so an unreadable payload shows as empty rather than failing the whole queue.
    payload: parseJsonColumn(jsonObject, claim.payloadJson, {}, PAYLOAD),
    pageNumber: claim.pageNumber ?? null,
    sourceExcerpt: claim.sourceExcerpt ?? null,
    confidence: claim.confidence ?? null,
    reviewStatus: claim.reviewStatus ?? "pending",
  };
}
