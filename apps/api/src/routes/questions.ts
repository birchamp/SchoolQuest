import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@schoolquest/domain";
import {
  applyEffortAnswer,
  buildEffortSurvey,
  buildOpenQuestions,
  type PendingClarification,
  type PendingPolicy,
} from "@schoolquest/planning-engine";
import { auditEvents, extractionClaims, sourceDocuments, workItems } from "../db/schema.js";
import { assertTermOwner, getDb, loadTermSnapshot } from "../db/repo.js";
import { policyClaimDisplay, questionClaimDisplay } from "../db/claim-payloads.js";
import { parseJsonColumn } from "../lib/json-column.js";
import type { AppBindings } from "../env.js";

/** What nobody has answered about a term yet: the open-questions index and the effort survey. */
export const questionsRoute = new Hono<AppBindings>();

// --- How long things take ----------------------------------------------------

/**
 * `entityType` for the record that a question was handed to the instructor.
 *
 * Kept in `audit_events` rather than a table of its own because that is exactly what it is:
 * an event, with a date, that happened once. "I asked my professor on 3 September" is history,
 * not state, and the screen only needs the latest one per question.
 */
const EFFORT_ASK_ENTITY = "effort_question";

/**
 * Everything nobody has answered about this term, in one list per course.
 *
 * The pieces already existed and were scattered: clarification questions live inside whichever
 * document review raised them, undated work is only visible in the assignments table, unweighted
 * categories are visible nowhere, and extracted policies were stored and never rendered at all
 * (docs/10-syllabus-gotchas.md §5.4). Five courses meant seven screens.
 *
 * Reads only. Answering still happens where answering happens — this is the index, not a second
 * way to write the same records, which would be two sources of truth for the same claim.
 */
questionsRoute.get("/terms/:id/open-questions", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) return c.json({ error: "Term not found" }, 404);

  const snapshot = await loadTermSnapshot(db, id);
  const courseIds = snapshot.courses.map((course) => course.id);

  const documents = courseIds.length
    ? await db.select().from(sourceDocuments).where(inArray(sourceDocuments.courseId, courseIds))
    : [];
  const courseByDocument = new Map(documents.map((d) => [d.id, d.courseId]));
  const claims = documents.length
    ? await db
        .select()
        .from(extractionClaims)
        .where(inArray(extractionClaims.sourceDocumentId, documents.map((d) => d.id)))
    : [];

  const clarifications: PendingClarification[] = [];
  const policies: PendingPolicy[] = [];

  for (const claim of claims) {
    // "pending" is the only unanswered state; accepted, answered and rejected are all settled.
    if (claim.reviewStatus !== "pending") continue;
    const courseId = courseByDocument.get(claim.sourceDocumentId);
    if (!courseId) continue;

    if (claim.claimType === "clarification_question") {
      // An index, so an unreadable claim is skipped (it has no question) rather than failing it.
      const payload = parseJsonColumn(
        questionClaimDisplay,
        claim.payloadJson,
        {},
        "extraction_claims.payload_json",
      );
      if (!payload.question) continue;
      clarifications.push({
        id: claim.id,
        courseId,
        question: payload.question,
        why: payload.why ?? "",
        relatesToTitles: payload.relatesToTitles ?? (payload.relatesToTitle ? [payload.relatesToTitle] : []),
        // Claims written before questions carried evidence simply have none, which is a question
        // with no quote rather than an error.
        ...(payload.evidence?.length ? { evidence: payload.evidence } : {}),
      });
      continue;
    }

    if (claim.claimType === "policy") {
      const payload = parseJsonColumn(policyClaimDisplay, claim.payloadJson, {}, "extraction_claims.payload_json");
      if (!payload.summary) continue;
      policies.push({ id: claim.id, courseId, kind: payload.kind ?? "other", summary: payload.summary });
    }
  }

  return c.json(
    buildOpenQuestions({
      courses: snapshot.courses,
      workItems: snapshot.workItems,
      gradingCategories: snapshot.gradingCategories,
      clarifications,
      policies,
    }),
  );
});

/** The questions still worth asking, with anything already handed off marked as such. */
questionsRoute.get("/terms/:id/effort-survey", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const userId = c.get("userId");
  if (!(await assertTermOwner(db, id, userId))) return c.json({ error: "Term not found" }, 404);

  const snapshot = await loadTermSnapshot(db, id);
  const survey = buildEffortSurvey({
    workItems: snapshot.workItems,
    courses: snapshot.courses,
    gradingCategories: snapshot.gradingCategories,
  });

  const asks = (
    await db.select().from(auditEvents).where(eq(auditEvents.userId, userId))
  ).filter((event) => event.entityType === EFFORT_ASK_ENTITY);
  // Latest event per question wins, so asking and then un-asking reads correctly.
  const askedAt = new Map<string, string>();
  for (const event of asks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (event.action === "asked_instructor") askedAt.set(event.entityId, event.createdAt);
    else askedAt.delete(event.entityId);
  }

  return c.json({
    ...survey,
    questions: survey.questions.map((q) => ({ ...q, askedInstructorAt: askedAt.get(q.id) ?? null })),
  });
});

const effortAnswersBody = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        /**
         * Minutes per item; `0` for "this needs no time"; `null` for "I don't know — I'll ask".
         *
         * Three distinct answers, and zero used to be rejected outright by `.positive()`, which
         * left the student's only honest options a duration they knew was wrong or a question
         * for an instructor who cannot answer it either. Attendance marks and in-class quizzes
         * really do cost nothing to plan for.
         */
        minutes: z.number().int().nonnegative().max(24 * 60).nullable(),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * Applies the student's answers about how long their work takes.
 *
 * One answer writes a whole family, which is the entire point: thirteen quizzes settled by one
 * choice rather than thirteen. The survey is rebuilt from current data on every call rather
 * than trusting ids sent by the client, so an answer can only ever reach items that the server
 * itself just decided were unestimated — a stale question id from a screen left open overnight
 * resolves to nothing instead of overwriting work that has since been estimated by hand.
 *
 * A null answer is not a failure to answer. It records that the student does not know, which is
 * true for a first-year facing their first lab report, and hands them the sentence to send. The
 * estimate stays assumed, because that is the honest state until somebody actually knows.
 */
questionsRoute.post("/terms/:id/effort-answers", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const userId = c.get("userId");
  if (!(await assertTermOwner(db, id, userId))) return c.json({ error: "Term not found" }, 404);

  const parsed = effortAnswersBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const snapshot = await loadTermSnapshot(db, id);
  const survey = buildEffortSurvey({
    workItems: snapshot.workItems,
    courses: snapshot.courses,
    gradingCategories: snapshot.gradingCategories,
  });
  const byId = new Map(survey.questions.map((q) => [q.id, q]));

  const applied: { questionId: string; itemsUpdated: number; minutes: number | null }[] = [];
  const unknown: string[] = [];
  const now = new Date().toISOString();

  for (const answer of parsed.data.answers) {
    const question = byId.get(answer.questionId);
    if (!question) {
      unknown.push(answer.questionId);
      continue;
    }

    if (answer.minutes === null) {
      await db.insert(auditEvents).values({
        id: newId("auditEvent"),
        userId,
        entityType: EFFORT_ASK_ENTITY,
        entityId: question.id,
        action: "asked_instructor",
        beforeJson: null,
        afterJson: JSON.stringify({ question: question.askProfessor, itemCount: question.itemCount }),
        actorType: "user",
        createdAt: now,
      });
      applied.push({ questionId: question.id, itemsUpdated: 0, minutes: null });
      continue;
    }

    const writes = applyEffortAnswer(question, answer.minutes, snapshot.workItems);
    for (const write of writes) {
      await db
        .update(workItems)
        .set({ estimatedMinutes: write.estimatedMinutes, remainingMinutes: write.remainingMinutes })
        .where(eq(workItems.id, write.workItemId));
    }
    applied.push({ questionId: question.id, itemsUpdated: writes.length, minutes: answer.minutes });
  }

  // Rebuilt after the writes so the caller can show the grounding move without a second call.
  const after = await loadTermSnapshot(db, id);
  const remaining = buildEffortSurvey({
    workItems: after.workItems,
    courses: after.courses,
    gradingCategories: after.gradingCategories,
  });

  return c.json({
    applied,
    // Reported rather than dropped: a question id the server does not recognise means the
    // screen is out of date, and silently doing nothing would look like it worked.
    unknownQuestionIds: unknown,
    groundedFraction: remaining.groundedFraction,
    questionsLeft: remaining.questions.length,
  });
});
