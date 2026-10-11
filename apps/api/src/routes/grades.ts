import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { newId } from "@schoolquest/domain";
import { gradeResults, workItems } from "../db/schema.js";
import { getDb } from "../db/repo.js";
import { loadOwnedWorkItem } from "../db/ownership.js";
import { gradeBody, resolveGradeEntry } from "../grade-entry.js";
import type { AppBindings } from "../env.js";

export const gradesRoute = new Hono<AppBindings>();

/**
 * Recording what a piece of work actually scored.
 *
 * Nothing could do this before. Grades were in the schema, the seed loaded three of them,
 * and `computeCourseStanding` knew how to weight them — but no route existed to enter one,
 * so in practice every student's standing was permanently unknown. That was survivable while
 * nothing depended on it; it stops being survivable the moment the dashboard tells a student
 * their results are unrecorded, because naming a problem with no way to fix it is worse than
 * staying quiet about it.
 *
 * A result replaces any earlier one for the same item rather than accumulating. A grade is a
 * fact about a piece of work, not an event log, and a corrected mark should read as the
 * correction it is.
 *
 * `passFail` records a Pass/Fail outcome instead of a score. It is stored with no points and the
 * outcome as the letter, so it marks the work as having a result without moving the percentage.
 */
gradesRoute.put("/work-items/:id/grade", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const existing = await loadOwnedWorkItem(db, id, c.get("userId"));
  if (!existing) return c.json({ error: "Work item not found" }, 404);

  const parsed = gradeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const resolved = resolveGradeEntry(parsed.data, existing.pointsPossible);
  if ("error" in resolved) return c.json({ error: resolved.error }, 400);
  const { pointsEarned, pointsPossible, letterGrade } = resolved.entry;

  await db.delete(gradeResults).where(eq(gradeResults.workItemId, id));
  const [grade] = await db
    .insert(gradeResults)
    .values({
      id: newId("gradeResult"),
      workItemId: id,
      pointsEarned,
      pointsPossible,
      letterGrade,
      postedAt: new Date().toISOString(),
      confirmationStatus: parsed.data.confirmationStatus,
      sourceDocumentId: null,
      dropped: false,
    })
    .returning();

  // Recording a result means the work is done, whatever the item still said.
  if (existing.status !== "completed" && existing.status !== "submitted") {
    await db.update(workItems).set({ status: "completed" }).where(eq(workItems.id, id));
  }

  return c.json({ grade }, 201);
});

/**
 * Clears a recorded result -- for a grade entered on the wrong item, or one the student wants to
 * take back until the real number arrives. The item drops from "done" to "handed in", so the
 * score box comes back and the row is waiting on a result again rather than claiming to have one.
 */
gradesRoute.delete("/work-items/:id/grade", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const existing = await loadOwnedWorkItem(db, id, c.get("userId"));
  if (!existing) return c.json({ error: "Work item not found" }, 404);

  await db.delete(gradeResults).where(eq(gradeResults.workItemId, id));
  if (existing.status === "completed") {
    await db.update(workItems).set({ status: "submitted" }).where(eq(workItems.id, id));
  }
  return c.json({ ok: true });
});
