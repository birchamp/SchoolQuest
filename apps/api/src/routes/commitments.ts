import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@schoolquest/domain";
import { availabilityRules, commitments } from "../db/schema.js";
import { assertTermOwner, getDb, insertInChunks, serializeDays } from "../db/repo.js";
import { loadOwnedCommitment } from "../db/ownership.js";
import { isoDate, timeOfDay } from "../lib/validation.js";
import type { AppBindings } from "../env.js";

/** The student's week outside class: standing commitments and the availability grid. */
export const commitmentsRoute = new Hono<AppBindings>();

const commitmentBody = z.object({
  title: z.string().min(1),
  commitmentType: z.string(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  startTime: timeOfDay,
  endTime: timeOfDay,
  specificDate: isoDate.nullable().optional(),
  flexibility: z.enum(["fixed", "flexible", "optional"]).default("fixed"),
});

commitmentsRoute.post("/terms/:termId/commitments", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = commitmentBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const commitment = {
    id: newId("commitment"),
    termId,
    title: parsed.data.title,
    commitmentType: parsed.data.commitmentType,
    daysOfWeek: serializeDays(parsed.data.daysOfWeek),
    startTime: parsed.data.startTime,
    endTime: parsed.data.endTime,
    specificDate: parsed.data.specificDate ?? null,
    flexibility: parsed.data.flexibility,
    locked: parsed.data.flexibility === "fixed",
  };
  await db.insert(commitments).values(commitment);
  return c.json({ commitment }, 201);
});

const availabilityBody = z.object({
  rules: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: timeOfDay,
      endTime: timeOfDay,
      energyLevel: z.enum(["low", "medium", "high"]).default("medium"),
      location: z
        .enum(["anywhere", "desk", "library", "lab", "campus", "quiet"])
        .default("anywhere"),
      hardness: z.enum(["hard", "soft"]).default("soft"),
    }),
  ),
});

/** Replaces the whole availability grid — it is edited as a single grid in the UI. */
commitmentsRoute.put("/terms/:termId/availability-rules", async (c) => {
  const db = getDb(c.env.DB);
  const termId = c.req.param("termId");
  if (!(await assertTermOwner(db, termId, c.get("userId")))) {
    return c.json({ error: "Term not found" }, 404);
  }

  const parsed = availabilityBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await db.delete(availabilityRules).where(eq(availabilityRules.termId, termId));
  const rows = parsed.data.rules.map((r) => ({
    id: newId("availabilityRule"),
    termId,
    dayOfWeek: r.dayOfWeek,
    startTime: r.startTime,
    endTime: r.endTime,
    energyLevel: r.energyLevel,
    location: r.location,
    hardness: r.hardness,
  }));
  // A full grid can be dozens of rules; chunk to stay under D1's parameter cap.
  await insertInChunks(rows, 10, (batch) => db.insert(availabilityRules).values(batch));

  return c.json({ ok: true, count: parsed.data.rules.length });
});

/**
 * Changing or removing a standing commitment.
 *
 * Commitments could be created and never touched again. A shift that moves to a different
 * evening — which is the single commonest change in a student's term — could only be handled
 * by adding a second one and living with the first, so the planner kept protecting an hour
 * nobody needed and the week quietly lost time to a shift that had ended weeks ago.
 */
const commitmentPatch = commitmentBody.partial();

commitmentsRoute.patch("/commitments/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const owned = await loadOwnedCommitment(db, id, c.get("userId"));
  if (!owned) return c.json({ error: "Commitment not found" }, 404);

  const parsed = commitmentPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch["title"] = parsed.data.title;
  if (parsed.data.commitmentType !== undefined) patch["commitmentType"] = parsed.data.commitmentType;
  if (parsed.data.daysOfWeek !== undefined) patch["daysOfWeek"] = serializeDays(parsed.data.daysOfWeek);
  if (parsed.data.startTime !== undefined) patch["startTime"] = parsed.data.startTime;
  if (parsed.data.endTime !== undefined) patch["endTime"] = parsed.data.endTime;
  if (parsed.data.specificDate !== undefined) patch["specificDate"] = parsed.data.specificDate;
  if (parsed.data.flexibility !== undefined) {
    patch["flexibility"] = parsed.data.flexibility;
    patch["locked"] = parsed.data.flexibility === "fixed";
  }
  if (Object.keys(patch).length === 0) return c.json({ commitment: owned });

  const start = (patch["startTime"] as string) ?? owned.startTime;
  const end = (patch["endTime"] as string) ?? owned.endTime;
  if (end <= start) return c.json({ error: "A commitment must end after it starts." }, 400);

  const [updated] = await db
    .update(commitments)
    .set(patch)
    .where(eq(commitments.id, id))
    .returning();
  return c.json({ commitment: updated });
});

commitmentsRoute.delete("/commitments/:id", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  if (!(await loadOwnedCommitment(db, id, c.get("userId")))) {
    return c.json({ error: "Commitment not found" }, 404);
  }

  await db.delete(commitments).where(eq(commitments.id, id));
  return c.json({ ok: true });
});
