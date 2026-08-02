import type { TermCalendar } from "@schoolquest/domain";
import { MODELS, type AiProvider } from "../provider.js";
import {
  buildExtractionUserMessage,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SYSTEM_PROMPT,
  type DocumentPage,
} from "./prompt.js";
import { syllabusExtraction, SYLLABUS_EXTRACTION_JSON_SCHEMA } from "./schema.js";
import { validateExtraction, type ValidationResult } from "./validate.js";

export interface ExtractionRequest {
  pages: DocumentPage[];
  termStartDate?: string;
  termEndDate?: string;
  /** Breaks, finals and the week-numbering convention, when the term has supplied one. */
  termCalendar?: TermCalendar;
  courseName?: string;
  model?: string;
}

export interface ExtractionOutcome {
  result: ValidationResult;
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

  const completion = await provider.complete({
    model: request.model ?? MODELS.EXTRACTION,
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
      ...(request.termCalendar ? { termCalendar: request.termCalendar } : {}),
          ...(request.termCalendar ? { termCalendar: request.termCalendar } : {}),
          ...(request.courseName ? { courseName: request.courseName } : {}),
        }),
      },
    ],
  });

  let parsed;
  try {
    parsed = syllabusExtraction.parse(JSON.parse(completion.text));
  } catch (cause) {
    throw new ExtractionError("The extraction result did not match the expected schema.", cause);
  }

  return {
    result: validateExtraction(parsed, {
      pages,
      ...(request.termStartDate ? { termStartDate: request.termStartDate } : {}),
      ...(request.termEndDate ? { termEndDate: request.termEndDate } : {}),
      ...(request.termCalendar ? { termCalendar: request.termCalendar } : {}),
    }),
    promptVersion: EXTRACTION_PROMPT_VERSION,
    model: completion.model,
    usage: completion.usage,
    pagesProcessed: pages.length,
  };
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
