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
 * `COACH` is deliberately a cheap, fast model: coach turns are short, grounded in
 * pre-computed plan data, and happen many times a day. Grok 4.1 Fast is roughly
 * $0.20/M input and $0.50/M output, which puts a typical coach turn well under a cent.
 * Override with OPENROUTER_COACH_MODEL / OPENROUTER_EXTRACTION_MODEL.
 */
export const MODELS = {
  /** Coach chat and disruption parsing. */
  COACH: "x-ai/grok-4.1-fast",
  /** Topic guardrail — smallest, cheapest classification call. */
  GUARD: "x-ai/grok-4.1-fast",
  /** Syllabus and screenshot extraction; needs stronger structured output. */
  EXTRACTION: "x-ai/grok-4.1-fast",
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
