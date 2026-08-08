import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { newId } from "@schoolquest/domain";
import { courses, sourceDocuments, terms } from "../db/schema.js";
import { getDb } from "../db/repo.js";
import type { AppBindings } from "../env.js";

export const documentsRoute = new Hono<AppBindings>();

/**
 * Syllabus and grade-screenshot upload.
 *
 * This is the half of the product that belongs on the desktop app: the PWA can read the
 * plan, but uploading a syllabus PDF is a sit-down task with a real file picker.
 *
 * The bytes go to R2 and a SourceDocument row records them. Extraction into
 * ExtractionClaims is Phase 2 (docs/07-mvp-roadmap.md) and deliberately not wired here —
 * nothing writes to confirmed academic records without human review.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  // Word. Real students have a mix -- one instructor posts a PDF, the next posts the .docx --
  // and the client reads both into page text before anything reaches here.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strips path components and anything that could confuse a Content-Disposition header. */
function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/]/g, "_")
      .replace(/[\r\n"]/g, "")
      .replace(/[^\w.\- ]/g, "")
      .slice(0, 200) || "upload"
  );
}

documentsRoute.post("/courses/:courseId/documents", async (c) => {
  const db = getDb(c.env.DB);
  const courseId = c.req.param("courseId");
  const userId = c.get("userId");

  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(courses.id, courseId), eq(terms.userId, userId)));
  if (!course) return c.json({ error: "Course not found" }, 404);

  // Hono's parseBody types file entries as File; workers-types' FormData.get() does not.
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.["file"];
  if (!file || typeof file === "string") {
    return c.json({ error: "Expected a 'file' field containing an upload." }, 400);
  }

  if (file.size > MAX_BYTES) {
    return c.json({ error: `Files must be under ${MAX_BYTES / 1024 / 1024} MB.` }, 413);
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return c.json({ error: `Unsupported file type: ${file.type || "unknown"}` }, 415);
  }

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const documentType = form["type"] === "grade_screenshot" ? "grade_screenshot" : "syllabus";

  // Namespacing by user keeps one account's objects unreachable from another's key guesses.
  const storageKey = `${userId}/${courseId}/${sha256}`;
  await c.env.DOCUMENTS.put(storageKey, bytes, {
    httpMetadata: { contentType: file.type },
    // No original filename in R2 metadata; the sanitized name lives in D1 instead.
    customMetadata: { courseId, documentType },
  });

  const document = {
    id: newId("sourceDocument"),
    courseId,
    type: documentType,
    storageKey,
    filename: sanitizeFilename(file.name),
    mimeType: file.type,
    sha256,
    // Extraction is a later phase; the row records what we have, not a promise to parse it.
    processingStatus: "pending",
    uploadedAt: new Date().toISOString(),
  };

  await db.insert(sourceDocuments).values(document);
  return c.json({ document }, 201);
});

documentsRoute.get("/courses/:courseId/documents", async (c) => {
  const db = getDb(c.env.DB);
  const courseId = c.req.param("courseId");

  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(courses.id, courseId), eq(terms.userId, c.get("userId"))));
  if (!course) return c.json({ error: "Course not found" }, 404);

  const documents = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.courseId, courseId));
  return c.json({ documents });
});

/** Streams a stored document back. Ownership is re-checked on every read. */
documentsRoute.get("/documents/:id/file", async (c) => {
  const db = getDb(c.env.DB);
  const [row] = await db
    .select({ document: sourceDocuments })
    .from(sourceDocuments)
    .innerJoin(courses, eq(courses.id, sourceDocuments.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(sourceDocuments.id, c.req.param("id")), eq(terms.userId, c.get("userId"))));

  if (!row) return c.json({ error: "Document not found" }, 404);

  const object = await c.env.DOCUMENTS.get(row.document.storageKey);
  if (!object) return c.json({ error: "File is no longer stored" }, 410);

  return new Response(object.body, {
    headers: {
      "Content-Type": row.document.mimeType,
      "Content-Disposition": `inline; filename="${row.document.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

/** Deleting a document removes the stored bytes as well as the row (docs/05 §8). */
documentsRoute.delete("/documents/:id", async (c) => {
  const db = getDb(c.env.DB);
  const [row] = await db
    .select({ document: sourceDocuments })
    .from(sourceDocuments)
    .innerJoin(courses, eq(courses.id, sourceDocuments.courseId))
    .innerJoin(terms, eq(terms.id, courses.termId))
    .where(and(eq(sourceDocuments.id, c.req.param("id")), eq(terms.userId, c.get("userId"))));

  if (!row) return c.json({ error: "Document not found" }, 404);

  await c.env.DOCUMENTS.delete(row.document.storageKey);
  await db.delete(sourceDocuments).where(eq(sourceDocuments.id, row.document.id));
  return c.json({ ok: true });
});
