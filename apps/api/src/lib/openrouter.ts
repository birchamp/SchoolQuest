import { createOpenRouterProvider, type AiProvider } from "@schoolquest/ai";
import type { Env } from "../env.js";

/**
 * The OpenRouter client for one request, built from the deployment's settings.
 *
 * Four routes built this by hand with the same five lines, and the one detail that matters --
 * honouring `OPENROUTER_BASE_URL`, which is how the e2e mock and any gateway are reached -- is the
 * kind a fifth copy forgets. The key and model come from `providerForUser`, which decides whose
 * key pays; this only turns that answer into a client.
 */
export function openRouterFor(
  env: Pick<Env, "APP_URL" | "APP_NAME" | "OPENROUTER_BASE_URL">,
  apiKey: string,
  model: string,
): AiProvider {
  return createOpenRouterProvider({
    apiKey,
    defaultModel: model,
    appUrl: env.APP_URL,
    appName: env.APP_NAME,
    ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
  });
}
