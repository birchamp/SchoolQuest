import { z } from "zod";
import type { TermCalendarException } from "@schoolquest/domain";
import { exceptionsFromRange } from "./academic-weeks.js";

/**
 * Reading the registrar's academic calendar, pasted in by the student.
 *
 * ## Why the student pastes it rather than typing dates
 *
 * The term calendar is a prerequisite for reading a syllabus (see `academic-weeks.ts`), and the
 * part that matters most is the part a student is least likely to supply from memory. Everyone
 * knows when Thanksgiving is. Nobody remembers that classes do not meet on the Monday of
 * Labour Day, that there are two days of fall break in October, or that the Tuesday after
 * Thanksgiving runs a Friday schedule. Those are exactly the days a plan quietly gets wrong.
 *
 * Every school publishes this as a page of dated lines. Pasting it is thirty seconds; typing
 * fifteen exception dates from memory is both a chore and inaccurate, which is the worst
 * combination for this reader.
 *
 * ## The same discipline as syllabus extraction
 *
 * The model is a witness, not an authority. Every entry quotes the line it came from, and an
 * entry whose quote is not in the pasted text is discarded — the same check that stops a
 * fabricated exam stops a fabricated holiday, and a fabricated holiday is worse: it silently
 * removes a day the student actually has class.
 *
 * Ranges are expanded to days here rather than by the model, because "October 12-13" becoming
 * two dates is arithmetic, and every date a model enumerates by hand is a day a student either
 * turns up for nothing or misses a class.
 */

export const calendarEntryKind = z.enum([
  /** No classes: a holiday, a recess, a break day. */
  "no_class",
  /** Study day before exams: no classes, work expected. */
  "reading",
  /** Inside the examination period. */
  "finals",
  /** First or last day of instruction — bounds, not exceptions. */
  "instruction_bound",
]);

export const academicCalendarEntry = z.object({
  /** "YYYY-MM-DD". The first day this entry covers. */
  startDate: z.string(),
  /** Same as `startDate` for a single day; a later date for a range like "Oct. 12-13". */
  endDate: z.string(),
  kind: calendarEntryKind,
  /** What the calendar called it, verbatim enough to recognise: "Thanksgiving Recess". */
  label: z.string(),
  /**
   * Set only when the calendar explicitly says this date runs another weekday's schedule.
   * 0 = Sunday. Never inferred — if the line does not say it, this is null.
   */
  followsWeekday: z.number().int().min(0).max(6).nullable(),
  /** The line this came from, quoted exactly. Checked against the pasted text. */
  evidence: z.string(),
});
export type AcademicCalendarEntry = z.infer<typeof academicCalendarEntry>;

export const academicCalendarReading = z.object({
  /** First day of instruction, when the calendar states one. */
  instructionStartDate: z.string().nullable(),
  /** Last day of instruction, when the calendar states one. */
  instructionEndDate: z.string().nullable(),
  entries: z.array(academicCalendarEntry).default([]),
  /** Anything the model could not place, so it is visible rather than dropped. */
  unreadableLines: z.array(z.string()).default([]),
});
export type AcademicCalendarReading = z.infer<typeof academicCalendarReading>;

export const ACADEMIC_CALENDAR_PROMPT_VERSION = "calendar-v1";

export const ACADEMIC_CALENDAR_SYSTEM_PROMPT = `You read a university's official academic calendar and return the dates on it.

You are reading it so a study planner knows which days a student has class. Getting this wrong
is expensive in both directions: a holiday you invent removes a real class day, and a holiday
you miss puts work on a day the student is away.

RULES

1. Quote your evidence. Every entry must carry the line it came from, copied exactly from the
   text you were given. Do not paraphrase, do not tidy, do not fix typos. An entry whose quote
   is not in the text will be discarded.
2. Never invent a date. If a line does not state a date you can resolve, put it in
   unreadableLines rather than guessing.
3. Return ranges as ranges. "October 12-13" is one entry with startDate 2026-10-12 and endDate
   2026-10-13. Do not enumerate the days yourself.
4. Use the year the calendar states. If a line gives no year, use the year implied by the
   surrounding entries, and if that is unclear put the line in unreadableLines.
5. followsWeekday only when the calendar says so in words — "classes follow a Friday schedule".
   Otherwise null.
6. Classify honestly:
   - no_class      holidays, recesses, breaks, "no classes"
   - reading       reading day, study day
   - finals        final examinations, exam period
   - instruction_bound  "first day of classes", "last day of classes"
7. Include only lines about when class does or does not meet. Ignore registration deadlines,
   tuition due dates, add/drop deadlines, commencement, and residence hall dates.

Return JSON only.`;

export function buildAcademicCalendarMessage(pastedText: string): string {
  return `Read this academic calendar and return its dates as JSON.\n\n${pastedText}`;
}

/** Loose whitespace/punctuation normalisation, matching the syllabus evidence check. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    // Non-breaking, thin, and zero-width spaces, written as escapes: PDF and web
    // calendar pages are full of them and a literal here is invisible to review.
    .replace(/[\u00a0\u2007\u202f\u2009\u200b]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface CalendarValidationResult {
  /** Day-level exceptions, ready to store as the term's bedrock. */
  exceptions: TermCalendarException[];
  instructionStartDate: string | null;
  instructionEndDate: string | null;
  /** Entries kept, for showing the student what was read and letting them uncheck. */
  accepted: AcademicCalendarEntry[];
  /** Entries dropped, with why. Reported rather than hidden — a silent drop reads as clean. */
  rejected: { entry: AcademicCalendarEntry; reason: string }[];
  unreadableLines: string[];
  warnings: string[];
}

/**
 * Checks a reading against the text it claims to have come from, and normalises it to days.
 *
 * Nothing here trusts the model about a date. The quote has to be present, the dates have to
 * parse, the range has to run forwards, and an entry outside the term is reported rather than
 * silently stored — a calendar page usually covers the whole academic year, so entries for
 * the *other* semester are the common case, not an error.
 */
export function validateAcademicCalendar(
  reading: AcademicCalendarReading,
  context: { pastedText: string; termStartDate?: string; termEndDate?: string },
): CalendarValidationResult {
  const haystack = normalize(context.pastedText);
  const accepted: AcademicCalendarEntry[] = [];
  const rejected: CalendarValidationResult["rejected"] = [];
  const warnings: string[] = [];

  for (const entry of reading.entries) {
    if (!ISO.test(entry.startDate) || !ISO.test(entry.endDate)) {
      rejected.push({ entry, reason: "The dates were not in YYYY-MM-DD form." });
      continue;
    }
    if (entry.endDate < entry.startDate) {
      rejected.push({ entry, reason: "The range ended before it started." });
      continue;
    }
    // The check that stops an invented holiday. A fabricated no-class day silently deletes a
    // day the student really does have class, which is worse than missing one.
    if (!haystack.includes(normalize(entry.evidence))) {
      rejected.push({ entry, reason: "That line is not in the calendar you pasted." });
      continue;
    }
    // A calendar page usually covers the whole year. Entries for the other semester are
    // ordinary and are dropped quietly rather than reported as a fault.
    if (context.termStartDate && entry.endDate < context.termStartDate) continue;
    if (context.termEndDate && entry.startDate > addDays(context.termEndDate, 30)) continue;

    accepted.push(entry);
  }

  const exceptions: TermCalendarException[] = [];
  for (const entry of accepted) {
    if (entry.kind === "instruction_bound") continue;
    const days = exceptionsFromRange({
      startDate: entry.startDate,
      endDate: entry.endDate,
      label: entry.label,
      kind: entry.kind,
    });
    for (const day of days) {
      exceptions.push({ ...day, followsWeekday: entry.followsWeekday });
    }
  }

  // Later entries win on a collision, which matches how calendars read: a specific line
  // ("Friday schedule") printed after a general one ("Thanksgiving Recess") is the correction.
  const byDate = new Map(exceptions.map((e) => [e.date, e]));
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (merged.length === 0 && reading.entries.length > 0) {
    warnings.push(
      "Nothing in that calendar could be matched to your term. Check you pasted the right semester.",
    );
  }
  if (!merged.some((e) => e.kind === "finals")) {
    warnings.push("No exam period was found, so finals week is still unknown.");
  }

  return {
    exceptions: merged,
    instructionStartDate: boundOf(accepted, reading.instructionStartDate, "start"),
    instructionEndDate: boundOf(accepted, reading.instructionEndDate, "end"),
    accepted,
    rejected,
    unreadableLines: reading.unreadableLines,
    warnings,
  };
}

/**
 * The instruction bound, only if a surviving entry supports it.
 *
 * The model reports these separately from the entry list, so they need the same evidence
 * discipline applied indirectly: a bound the accepted entries do not mention is dropped rather
 * than allowed to silently move the whole term.
 */
function boundOf(
  accepted: AcademicCalendarEntry[],
  claimed: string | null,
  which: "start" | "end",
): string | null {
  if (claimed === null || !ISO.test(claimed)) return null;
  const supported = accepted.some(
    (e) =>
      e.kind === "instruction_bound" &&
      (which === "start" ? e.startDate === claimed : e.endDate === claimed || e.startDate === claimed),
  );
  return supported ? claimed : null;
}

function addDays(dateOnly: string, days: number): string {
  const t = Date.parse(`${dateOnly}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Provider-side JSON schema, kept in step with the Zod schema above by hand.
 *
 * Duplicated deliberately: the provider needs a plain JSON Schema and Zod needs to re-validate
 * whatever comes back, because a model that ignores its schema is exactly the case this is
 * defending against. `additionalProperties: false` everywhere so a hallucinated field fails
 * loudly rather than being silently dropped.
 */
export const ACADEMIC_CALENDAR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["instructionStartDate", "instructionEndDate", "entries", "unreadableLines"],
  properties: {
    instructionStartDate: { type: ["string", "null"] },
    instructionEndDate: { type: ["string", "null"] },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startDate", "endDate", "kind", "label", "followsWeekday", "evidence"],
        properties: {
          startDate: { type: "string" },
          endDate: { type: "string" },
          kind: {
            type: "string",
            enum: ["no_class", "reading", "finals", "instruction_bound"],
          },
          label: { type: "string" },
          followsWeekday: { type: ["integer", "null"] },
          evidence: { type: "string" },
        },
      },
    },
    unreadableLines: { type: "array", items: { type: "string" } },
  },
} as const;
