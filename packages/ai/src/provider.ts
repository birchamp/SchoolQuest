import { z } from "zod";

/**
 * Provider abstraction. Everything above this layer talks in messages and JSON schemas,
 * never in vendor-specific request shapes, so swapping models is a config change
 * (docs/08-coding-agent-handoff.md §1).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** When set, the provider must return JSON conforming to this schema. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  temperature?: number;
  /** Overrides the provider's default model for this one call. */
  model?: string;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export interface AiProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/**
 * Model defaults.
 *
 * The split is driven by how often each call runs, not by which job "feels" harder.
 *
 * **Coach and guard: cheap.** A coach turn is short and grounded in plan data the engine
 * already computed, so the model is summarizing, not reasoning from scratch. These run
 * many times a day. At roughly $0.20/M in and $0.50/M out, a turn costs a fraction of a
 * cent, and a semester of heavy use stays in single-dollar territory.
 *
 * **Extraction: strong.** A syllabus is read once per course per semester — call it five
 * times a term. At ~8k in and ~4k out that is about four cents per syllabus on a frontier
 * model against half a cent on a cheap one: a difference of pennies per semester. What it
 * buys is the correctness of every date the student's entire plan is built on, and
 * extraction mistakes are the expensive kind, because they propagate silently into the
 * schedule. Paying ten times almost nothing for that is not a close call.
 *
 * Both are overridable per environment via OPENROUTER_COACH_MODEL and
 * OPENROUTER_EXTRACTION_MODEL, so this is a default rather than a commitment.
 */
export const MODELS = {
  /** Coach chat and disruption parsing. */
  COACH: "x-ai/grok-4.1-fast",
  /** Topic guardrail — smallest, cheapest classification call. */
  GUARD: "x-ai/grok-4.1-fast",
  /**
   * Syllabus and screenshot extraction. Deliberately the strong model, and the cost of that
   * choice is measured: a five-course semester read three times comes to about 33 cents, against
   * 3 cents on the fast tier (`centsPerSemester` in models.ts, from the real corpus). Thirty
   * cents a term is not a reason to give a student a worse reader for the one job where a
   * mistake costs them a deadline.
   */
  EXTRACTION: "x-ai/grok-4.5",
} as const;

const openRouterResponse = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

export interface OpenRouterOptions {
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
  /** Sent as HTTP-Referer/X-Title; OpenRouter uses these for attribution. */
  appUrl?: string;
  appName?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenRouterProvider(options: OpenRouterOptions): AiProvider {
  const baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
  const defaultModel = options.defaultModel ?? MODELS.COACH;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: "openrouter",
    defaultModel,

    async complete(request) {
      const body: Record<string, unknown> = {
        model: request.model ?? defaultModel,
        messages: request.messages,
        max_tokens: request.maxTokens ?? 800,
        temperature: request.temperature ?? 0.3,
      };

      if (request.jsonSchema) {
        body["response_format"] = {
          type: "json_schema",
          json_schema: {
            name: request.jsonSchema.name,
            strict: true,
            schema: request.jsonSchema.schema,
          },
        };
      }

      const response = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...(options.appUrl ? { "HTTP-Referer": options.appUrl } : {}),
          ...(options.appName ? { "X-Title": options.appName } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new AiProviderError(
          `OpenRouter request failed (${response.status}): ${detail.slice(0, 400)}`,
          response.status,
          // 429 and 5xx are worth retrying; 4xx generally is not.
          response.status === 429 || response.status >= 500,
        );
      }

      const parsed = openRouterResponse.safeParse(await response.json());
      if (!parsed.success) {
        throw new AiProviderError("OpenRouter returned an unexpected response shape");
      }

      const content = parsed.data.choices[0]!.message.content;
      if (content === null) throw new AiProviderError("OpenRouter returned empty content");

      return {
        text: content,
        model: parsed.data.model ?? String(body["model"]),
        usage: {
          promptTokens: parsed.data.usage?.prompt_tokens ?? 0,
          completionTokens: parsed.data.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
