export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;

  // Vars (wrangler.toml)
  APP_NAME: string;
  APP_URL: string;
  OPENROUTER_COACH_MODEL?: string;
  OPENROUTER_EXTRACTION_MODEL?: string;

  // Secrets (wrangler secret put)
  OPENROUTER_API_KEY: string;
  AUTH_SECRET: string;
  RESEND_API_KEY?: string;
}

/** Request-scoped values every authenticated route can rely on. */
export interface AppVariables {
  userId: string;
  userEmail: string;
}

export type AppBindings = { Bindings: Env; Variables: AppVariables };
