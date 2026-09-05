export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;

  // Vars (wrangler.toml)
  APP_NAME: string;
  APP_URL: string;
  OPENROUTER_COACH_MODEL?: string;
  /** Override the API origin — for gateways, proxies, or a local mock in testing. */
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_EXTRACTION_MODEL?: string;

  /**
   * "true" only for a local run. Set by the dev scripts (`wrangler dev --var DEV_MODE:true`),
   * never in wrangler.toml, so a deployed Worker can only have it if someone put it there.
   */
  DEV_MODE?: string;

  // Secrets (wrangler secret put)
  OPENROUTER_API_KEY: string;
  AUTH_SECRET: string;
  RESEND_API_KEY?: string;
}

/**
 * Whether this Worker is a local development run.
 *
 * This used to be inferred from "no mail provider configured", which is also true of a public
 * deployment that simply never set one up -- and that inference unlocked three things at once:
 * sign-in links returned to the caller, error detail in 500 bodies, and a client-chosen clock.
 * An explicit flag is the only signal that cannot be true by accident. The dev runner sets it;
 * `pnpm dev:api` sets it; nothing else does.
 */
export function isDevMode(env: Pick<Env, "DEV_MODE">): boolean {
  return env.DEV_MODE === "true" || env.DEV_MODE === "1";
}

/** Request-scoped values every authenticated route can rely on. */
export interface AppVariables {
  userId: string;
  userEmail: string;
}

export type AppBindings = { Bindings: Env; Variables: AppVariables };
