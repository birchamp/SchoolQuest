import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { termCalendar } from "@schoolquest/domain";
import { breaksFromCalendar, finalsWindow, readAcademicCalendar } from "@schoolquest/ai";
import { terms } from "../db/schema.js";
import { assertTermOwner, getDb } from "../db/repo.js";
import { aiErrorResponse } from "../lib/ai-errors.js";
import { jsonObject, parseJsonColumn, requireJsonColumn } from "../lib/json-column.js";
import { openRouterFor } from "../lib/openrouter.js";
import { NO_PROVIDER_MESSAGE, providerForUser } from "../provider-for-user.js";
import { rateLimitPerUser } from "../rate-limit.js";
import type { AppBindings } from "../env.js";

export const calendarRoute = new Hono<AppBindings>();

// --- The academic calendar -----------------------------------------------------

/**
 * The term's calendar as the interface needs it: the stored exceptions plus the views derived
 * from them.
 *
 * Derived here rather than in the client so the bedrock has exactly one implementation. A
 * screen recomputing "which runs are breaks" from day records would be a second answer to a
 * question that already has one.
 */
calendarRoute.get("/terms/:id/calendar", async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) return c.json({ error: "Term not found" }, 404);

  const [term] = await db.select().from(terms).where(eq(terms.id, id));
  // A view, so an unreadable calendar reads as an empty one -- which is also what prompts the
  // student to paste it again -- rather than as a 500.
  const calendar = parseJsonColumn(
    termCalendar,
    term!.calendarJson || "{}",
    termCalendar.parse({}),
    "terms.calendar_json",
  );
  const window = { termStartDate: term!.startDate, termEndDate: term!.endDate, calendar };

  return c.json({
    startDate: term!.startDate,
    endDate: term!.endDate,
    calendar,
    breaks: breaksFromCalendar(window),
    finals: finalsWindow(window),
    /** Days running another weekday's schedule — not a break, and easy to miss. */
    scheduleSwaps: calendar.exceptions
      .filter((e) => e.followsWeekday !== null)
      .map((e) => ({ date: e.date, label: e.label, followsWeekday: e.followsWeekday })),
  });
});

const calendarPasteBody = z.object({
  /** The registrar's calendar page, pasted as text. */
  text: z.string().min(20).max(20_000),
});

/**
 * Reads a pasted academic calendar into the term's day-level bedrock.
 *
 * The student pastes the registrar's page; the model reads it; every entry is checked against
 * the text it claims to have come from before anything is stored. An invented holiday silently
 * deletes a day the student really does have class, so the evidence check matters more here
 * than it does for a syllabus.
 *
 * Nothing is written until the reading validates. A term whose calendar cannot be read keeps
 * the one it had.
 */
calendarRoute.post("/terms/:id/calendar/paste", rateLimitPerUser("calendarPaste"), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  if (!(await assertTermOwner(db, id, c.get("userId")))) return c.json({ error: "Term not found" }, 404);

  const resolved = await providerForUser(db, c.env, c.get("userId"));
  if (!resolved.apiKey) return c.json({ error: NO_PROVIDER_MESSAGE }, 503);

  const parsed = calendarPasteBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const [existing] = await db.select().from(terms).where(eq(terms.id, id));
  const provider = openRouterFor(c.env, resolved.apiKey, resolved.extractionModel);

  let result;
  try {
    result = await readAcademicCalendar(provider, {
      text: parsed.data.text,
      termStartDate: existing!.startDate,
      termEndDate: existing!.endDate,
    });
  } catch (error) {
    const answer = aiErrorResponse(c, error, {
      unreachable: "The reader is unreachable right now. Nothing was changed — try again.",
    });
    if (answer) return answer;
    throw error;
  }

  const calendar = termCalendar.parse({
    // Merged, so the finals window and week numbering survive; thrown on rather than defaulted,
    // because merging into `{}` would drop them without a word.
    ...requireJsonColumn(jsonObject, existing!.calendarJson || "{}", "terms.calendar_json"),
    exceptions: result.exceptions,
    source: "pasted_calendar",
  });

  const patch: Record<string, unknown> = { calendarJson: JSON.stringify(calendar) };
  // The calendar's own instruction bounds outrank whatever was typed during onboarding, but
  // only where a quoted entry supports them.
  if (result.instructionStartDate) patch["startDate"] = result.instructionStartDate;
  if (result.instructionEndDate) patch["endDate"] = result.instructionEndDate;

  const [updated] = await db.update(terms).set(patch).where(eq(terms.id, id)).returning();

  return c.json({
    term: { ...updated, calendar },
    /** Contiguous no-class runs, so the screen can show "Fall Break, 12-13 October". */
    breaks: breaksFromCalendar({
      termStartDate: updated!.startDate,
      termEndDate: updated!.endDate,
      calendar,
    }),
    finals: finalsWindow({
      termStartDate: updated!.startDate,
      termEndDate: updated!.endDate,
      calendar,
    }),
    accepted: result.accepted,
    // Reported, never hidden: a discarded line is the student's cue to add it by hand.
    rejected: result.rejected,
    unreadableLines: result.unreadableLines,
    warnings: result.warnings,
  });
});
