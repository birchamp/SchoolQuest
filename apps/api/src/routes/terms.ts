import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { newId, planningPreferences, termCalendar } from "@schoolquest/domain";
import { courses, meetingPatterns, sourceDocuments, terms, workItems } from "../db/schema.js";
import { assertTermOwner, getDb, loadTermSnapshot } from "../db/repo.js";
import { jsonObject, parseJsonColumn, requireJsonColumn } from "../lib/json-column.js";
import { isoDate } from "../lib/validation.js";
import type { AppBindings } from "../env.js";

/**
 * Terms themselves: create, list, edit, archive, and the two read-everything views (readiness and
 * snapshot) the client renders a term from. What lives under a term -- its calendar, courses,
 * commitments, open questions -- has a route file of its own.
 */
export const termsRoute = new Hono<AppBindings>();

const termBody = z.object({
  name: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  planningPreferences: planningPreferences.partial().optional(),
  /** Breaks, finals, and the week-numbering convention. See `termCalendar` in the domain. */
  calendar: termCalendar.partial().optional(),
});

termsRoute.get("/terms", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(terms).where(eq(terms.userId, c.get("userId")));
  // A display path: one term with an unreadable column shows defaults for it rather than taking
  // the whole term list -- and with it the app's first screen -- down with a 500.
  return c.json({
    terms: rows.map((t) => ({
      ...t,
      planningPreferences: parseJsonColumn(
        planningPreferences,
        t.planningPreferencesJson || "{}",
        planningPreferences.parse({}),
        "terms.planning_preferences_json",
      ),
      calendar: parseJsonColumn(
        termCalendar,
        t.calendarJson || "{}",
        termCalendar.parse({}),
        "terms.calendar_json",
      ),
    })),
  });
});

termsRoute.post("/terms", async (c) => {
  const parsed = termBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  // FR-1: a term cannot end before it starts.
  if (parsed.data.endDate < parsed.data.startDate) {
    return c.json({ error: "A term cannot end before it starts." }, 400);
  }

  const db = getDb(c.env.DB);
  const term = {
    id: newId("term"),
    userId: c.get("userId"),
    name: parsed.data.name,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    status: "active",
    calendarJson: JSON.stringify(termCalendar.parse(parsed.data.calendar ?? {})),
    planningPreferencesJson: JSON.stringify(
      planningPreferences.parse(parsed.data.planningPreferences ?? {}),
    ),
  };

  await db.insert(terms).values(term);
  return c.json({ term }, 201);
});

termsRoute.patch("/terms/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = termBody.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const patch: Record<string, unknown> = {};
  if (parsed.data.name) patch["name"] = parsed.data.name;
  if (parsed.data.startDate) patch["startDate"] = parsed.data.startDate;
  if (parsed.data.endDate) patch["endDate"] = parsed.data.endDate;
  if (parsed.data.calendar) {
    const [existing] = await db.select().from(terms).where(eq(terms.id, id));
    // Merged rather than replaced, so a screen that only knows about breaks cannot wipe the
    // finals window a different screen set.
    patch["calendarJson"] = JSON.stringify(
      termCalendar.parse({
        // Thrown on, not defaulted: merging into `{}` would silently drop the finals window.
        ...requireJsonColumn(jsonObject, existing!.calendarJson || "{}", "terms.calendar_json"),
        ...parsed.data.calendar,
      }),
    );
  }
  if (parsed.data.planningPreferences) {
    const [existing] = await db.select().from(terms).where(eq(terms.id, id));
    patch["planningPreferencesJson"] = JSON.stringify(
      planningPreferences.parse({
        ...requireJsonColumn(
          jsonObject,
          existing!.planningPreferencesJson || "{}",
          "terms.planning_preferences_json",
        ),
        ...parsed.data.planningPreferences,
      }),
    );
  }

  const [updated] = await db.update(terms).set(patch).where(eq(terms.id, id)).returning();
  return c.json({ term: updated });
});

termsRoute.post("/terms/:id/archive", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }
  await db.update(terms).set({ status: "archived" }).where(eq(terms.id, id));
  return c.json({ ok: true });
});

/**
 * Bring an archived term back as the active one. Archiving never deleted anything -- it only set
 * this flag -- so reopening is just flipping it back. Exactly one term is active at a time, so
 * whatever is active now is archived in the same move; the app then loads the reopened term.
 */
termsRoute.post("/terms/:id/unarchive", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }
  await db
    .update(terms)
    .set({ status: "archived" })
    .where(and(eq(terms.userId, c.get("userId")), eq(terms.status, "active")));
  await db.update(terms).set({ status: "active" }).where(eq(terms.id, id));
  return c.json({ ok: true });
});

/** Everything the client needs to render a term in one round trip. */
termsRoute.get("/terms/:id/readiness", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const [termRow] = await db.select().from(terms).where(eq(terms.id, id));
  const courseRows = await db.select().from(courses).where(eq(courses.termId, id));
  const courseIds = courseRows.map((course) => course.id);

  const documents = courseIds.length
    ? await db.select().from(sourceDocuments).where(inArray(sourceDocuments.courseId, courseIds))
    : [];
  const patterns = courseIds.length
    ? await db.select().from(meetingPatterns).where(inArray(meetingPatterns.courseId, courseIds))
    : [];
  const items = courseIds.length
    ? await db.select().from(workItems).where(inArray(workItems.courseId, courseIds))
    : [];

  // courseId is nullable on work items -- term-level work belongs to no class -- so rows
  // without one are simply not counted against any course.
  const countBy = (rows: { courseId: string | null }[]) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.courseId) continue;
      counts.set(row.courseId, (counts.get(row.courseId) ?? 0) + 1);
    }
    return counts;
  };
  const syllabi = countBy(documents.filter((d) => d.type === "syllabus"));
  const meetings = countBy(patterns);
  const work = countBy(items);

  // Only counted, so an unreadable calendar counts as none rather than failing the screen.
  const calendar = parseJsonColumn(
    z.object({ exceptions: z.array(z.unknown()).optional() }),
    termRow?.calendarJson || "{}",
    {},
    "terms.calendar_json",
  );

  return c.json({
    calendarEntries: calendar.exceptions?.length ?? 0,
    courses: courseRows.map((course) => ({
      id: course.id,
      name: course.name,
      code: course.code,
      colorToken: course.colorToken,
      syllabusCount: syllabi.get(course.id) ?? 0,
      hasMeetingTimes: (meetings.get(course.id) ?? 0) > 0,
      workItemCount: work.get(course.id) ?? 0,
      // "unknown" is the default until a syllabus or the student says otherwise.
      gradingKnown: course.gradingConfidence !== "unknown",
    })),
  });
});

termsRoute.get("/terms/:id/snapshot", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }
  return c.json(await loadTermSnapshot(db, id));
});
