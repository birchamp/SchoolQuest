import type { TermCalendar } from "@schoolquest/domain";
import type { AiProvider } from "../provider.js";
import {
  buildExtractionUserMessage,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM_PROMPT,
  type DocumentPage,
} from "./prompt.js";
import {
  syllabusExtraction,
  SYLLABUS_EXTRACTION_JSON_SCHEMA,
  type SyllabusExtraction,
} from "./schema.js";
import { reconcileExtractions, type ReconciledExtraction } from "./reconcile.js";
import { planFollowUps, type OpenIssue } from "./followup.js";
import { validateExtraction, type ValidationResult } from "./validate.js";
import {
  academicCalendarReading,
  ACADEMIC_CALENDAR_JSON_SCHEMA,
  ACADEMIC_CALENDAR_PROMPT_VERSION,
  ACADEMIC_CALENDAR_SYSTEM_PROMPT,
  buildAcademicCalendarMessage,
  validateAcademicCalendar,
  type CalendarValidationResult,
} from "./academic-calendar.js";
import {
  buildCourseListMessage,
  courseListReading,
  COURSE_LIST_JSON_SCHEMA,
  COURSE_LIST_PROMPT_VERSION,
  COURSE_LIST_SYSTEM_PROMPT,
  validateCourseList,
  type CourseListValidationResult,
} from "./course-list.js";

export interface ExtractionRequest {
  pages: DocumentPage[];
  termStartDate?: string;
  termEndDate?: string;
  /** Breaks, finals and the week-numbering convention, when the term has supplied one. */
  termCalendar?: TermCalendar;
  courseName?: string;
  model?: string;
  /**
   * How many independent readings to take of this document. One by default.
   *
   * A second reading misses different things than the first, so the union recovers assignments a
   * single pass drops — and the disagreement between them is a measurement rather than a guess.
   * Costs a full extraction each, so callers choose; `reconcileExtractions` does the merging and
   * cannot itself hallucinate, because it is set arithmetic over claim identities.
   */
  passes?: number;
  /**
   * Go back to the document with narrow questions about what the first reading left unsettled.
   *
   * The questions are chosen in code by `planFollowUps` from the issues the validator actually
   * raised, never by asking the model what to ask next — which is what stops the loop deciding
   * for itself that it is finished.
   */
  followUps?: boolean;
}

export interface ExtractionOutcome {
  result: ValidationResult;
  /** Present when more than one pass ran: what the readings agreed and disagreed about. */
  reconciled?: ReconciledExtraction;
  /** What a second look could still settle, in the order it is worth asking. */
  openIssues?: OpenIssue[];
  /** Recorded on every claim so a bad batch can be traced back (docs/08 §6). */
  promptVersion: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  /** Pages actually sent, after trimming empties and applying the page cap. */
  pagesProcessed: number;
}

/**
 * Syllabi are long and mostly boilerplate. This caps what gets sent so a 40-page course
 * packet cannot blow the context window or the budget; the schedule and grading tables
 * that matter are essentially always in the first stretch of the document.
 */
const MAX_PAGES = 24;
const MAX_CHARS_PER_PAGE = 6000;

export class ExtractionError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * Runs one extraction pass and validates the result.
 *
 * The model call is schema-constrained, but nothing it returns is trusted on the strength
 * of that alone — `validateExtraction` re-checks every claim against the source text
 * before anything reaches the review queue.
 */
export async function extractSyllabus(
  provider: AiProvider,
  request: ExtractionRequest,
): Promise<ExtractionOutcome> {
  const pages = preparePages(request.pages);
  if (pages.length === 0) {
    throw new ExtractionError(
      "No readable text was found in this document. Scanned PDFs need OCR, which is not supported yet.",
    );
  }

  /**
   * Read the document `passes` times and merge.
   *
   * Temperature stays at zero — this is a reading task and creativity is purely a fabrication
   * risk — so repeated passes are not a sampling trick. They differ because the same model given
   * twenty pages does not attend to them identically twice, and the disagreement that produces is
   * the signal worth having: an item found every time is a different kind of fact from one found
   * once, and the student is entitled to know which they are looking at.
   */
  const passes = Math.max(1, Math.min(request.passes ?? 1, 5));
  const readings: SyllabusExtraction[] = [];
  let lastCompletion: Awaited<ReturnType<AiProvider["complete"]>> | null = null;

  for (let pass = 0; pass < passes; pass += 1) {
    const completion = await readOnce(provider, request, pages);
    lastCompletion = completion.completion;
    readings.push(completion.parsed);
  }

  const reconciled = readings.length > 1 ? reconcileExtractions(readings) : null;
  const parsed = reconciled ? reconciled.extraction : readings[0]!;
  const completion = lastCompletion!;

  const result = validateExtraction(parsed, {
    pages,
    ...(request.termStartDate ? { termStartDate: request.termStartDate } : {}),
    ...(request.termEndDate ? { termEndDate: request.termEndDate } : {}),
    ...(request.termCalendar ? { termCalendar: request.termCalendar } : {}),
  });

  const openIssues =
    request.followUps === false
      ? []
      : planFollowUps({
          validation: result,
          ...(reconciled ? { reconciled } : {}),
          pages,
        });

  return {
    result,
    ...(reconciled ? { reconciled } : {}),
    openIssues,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    model: completion.model,
    usage: completion.usage,
    pagesProcessed: pages.length,
  };
}

/** One reading of the whole document, parsed against the schema. */
async function readOnce(
  provider: AiProvider,
  request: ExtractionRequest,
  pages: DocumentPage[],
) {
  const completion = await provider.complete({
    // Unset unless pinned: the provider's default is the model the Worker resolved for this
    // student, and a constant here would override that on every call.
    ...(request.model ? { model: request.model } : {}),
    // Extraction is a reading task; creativity here is purely a fabrication risk.
    temperature: 0,
    maxTokens: 8000,
    jsonSchema: {
      name: "syllabus_extraction",
      schema: SYLLABUS_EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildExtractionUserMessage(pages, {
          ...(request.termStartDate ? { termStartDate: request.termStartDate } : {}),
          ...(request.termEndDate ? { termEndDate: request.termEndDate } : {}),
          // The calendar is deliberately *not* in the prompt. The model is forbidden from
          // doing date arithmetic; breaks and week numbers are resolved after it answers,
          // by `academic-weeks.ts`, over text the document really contains.
          ...(request.courseName ? { courseName: request.courseName } : {}),
        }),
      },
    ],
  });

  try {
    return { completion, parsed: syllabusExtraction.parse(JSON.parse(completion.text)) };
  } catch (cause) {
    throw new ExtractionError("The extraction result did not match the expected schema.", cause);
  }
}

/** Drops blank pages, truncates very long ones, and caps the total. */
function preparePages(pages: DocumentPage[]): DocumentPage[] {
  return pages
    .filter((p) => p.text.trim().length > 0)
    .slice(0, MAX_PAGES)
    .map((p) => ({
      page: p.page,
      text: p.text.length > MAX_CHARS_PER_PAGE ? p.text.slice(0, MAX_CHARS_PER_PAGE) : p.text,
    }));
}

/**
 * Reads a pasted academic calendar into day-level exceptions.
 *
 * Same discipline as syllabus extraction and for a sharper reason: an invented holiday deletes
 * a day the student really does have class, and nothing on screen would look wrong.
 * `validateAcademicCalendar` discards any entry whose quoted line is not in the pasted text.
 */
export async function readAcademicCalendar(
  provider: AiProvider,
  request: {
    text: string;
    termStartDate?: string;
    termEndDate?: string;
    model?: string;
  },
): Promise<CalendarValidationResult & { promptVersion: string; model: string }> {
  const text = request.text.trim();
  if (text.length === 0) {
    throw new ExtractionError("There was no calendar text to read.");
  }

  const completion = await provider.complete({
    // Unset unless pinned: the provider's default is the model the Worker resolved for this
    // student, and a constant here would override that on every call.
    ...(request.model ? { model: request.model } : {}),
    // A reading task. Creativity here is purely a fabrication risk.
    temperature: 0,
    maxTokens: 4000,
    jsonSchema: {
      name: "academic_calendar",
      schema: ACADEMIC_CALENDAR_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
    messages: [
      { role: "system", content: ACADEMIC_CALENDAR_SYSTEM_PROMPT },
      { role: "user", content: buildAcademicCalendarMessage(text) },
    ],
  });

  let parsed;
  try {
    parsed = academicCalendarReading.parse(JSON.parse(completion.text));
  } catch (cause) {
    throw new ExtractionError("The calendar reading did not match the expected schema.", cause);
  }

  return {
    ...validateAcademicCalendar(parsed, {
      pastedText: text,
      ...(request.termStartDate ? { termStartDate: request.termStartDate } : {}),
      ...(request.termEndDate ? { termEndDate: request.termEndDate } : {}),
    }),
    promptVersion: ACADEMIC_CALENDAR_PROMPT_VERSION,
    model: completion.model,
  };
}

/**
 * Reads a pasted course list into classes with their meeting times.
 *
 * Same discipline as the calendar, defending a specific failure: an invented meeting time books
 * study sessions on top of a lecture every week of the term, and nothing on screen looks wrong.
 * `validateCourseList` discards any course whose quoted row is not in the pasted text, and drops
 * meeting times that do not parse or that end before they start.
 */
export async function readCourseList(
  provider: AiProvider,
  request: { text: string; model?: string },
): Promise<CourseListValidationResult & { promptVersion: string; model: string }> {
  const text = request.text.trim();
  if (text.length === 0) {
    throw new ExtractionError("There was no course list to read.");
  }

  const completion = await provider.complete({
    // Unset unless pinned: the provider's default is the model the Worker resolved for this
    // student, and a constant here would override that on every call.
    ...(request.model ? { model: request.model } : {}),
    // A reading task. Creativity here is purely a fabrication risk.
    temperature: 0,
    maxTokens: 4000,
    jsonSchema: {
      name: "course_list",
      schema: COURSE_LIST_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
    messages: [
      { role: "system", content: COURSE_LIST_SYSTEM_PROMPT },
      { role: "user", content: buildCourseListMessage(text) },
    ],
  });

  let parsed;
  try {
    parsed = courseListReading.parse(JSON.parse(completion.text));
  } catch (cause) {
    throw new ExtractionError("The course list reading did not match the expected schema.", cause);
  }

  return {
    ...validateCourseList(parsed, { pastedText: text }),
    promptVersion: COURSE_LIST_PROMPT_VERSION,
    model: completion.model,
  };
}
