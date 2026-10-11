import type { Context } from "hono";
import { AiProviderError, ExtractionError } from "@schoolquest/ai";

export interface AiErrorOptions {
  /**
   * The sentence for a provider outage. Each caller words its own, because what is safe to say
   * differs: an upload says the file is saved, a paste says nothing was changed, the coach says
   * the plan still works.
   */
  unreachable: string;
  /** When set, failures are logged under `[logTag]`, as the extraction and coach routes do. */
  logTag?: string;
  /**
   * Whether an `ExtractionError` (a reading that failed validation) is answered as a 422 with its
   * own message. True for every reader; the coach turns it off because it does not read documents.
   */
  extractionErrors?: boolean;
}

/**
 * Maps a failure from a model call to the HTTP answer the student sees, or returns null for an
 * error that is not the model's -- which the caller rethrows to reach the generic 500.
 *
 * - `AiProviderError` -> 502 with the caller's sentence and the provider's `retryable` flag. An
 *   outage is not the student's fault and not a bug in their data.
 * - `ExtractionError` -> 422 with the error's own message, which is written for the student.
 */
export function aiErrorResponse(c: Context, error: unknown, options: AiErrorOptions): Response | null {
  const { unreachable, logTag, extractionErrors = true } = options;
  if (extractionErrors && error instanceof ExtractionError) {
    if (logTag) console.error(`[${logTag}]`, error.message, error.cause);
    return c.json({ error: error.message }, 422);
  }
  if (error instanceof AiProviderError) {
    if (logTag) console.error(`[${logTag}] provider error`, error.message);
    return c.json({ error: unreachable, retryable: error.retryable }, 502);
  }
  return null;
}
