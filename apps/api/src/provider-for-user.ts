import { eq } from "drizzle-orm";
import { MODELS } from "@schoolquest/ai";
import { users } from "./db/schema.js";
import { decryptSecret } from "./secrets.js";
import type { Db } from "./db/repo.js";
import type { Env } from "./env.js";

/**
 * Whose key pays for this call, and which model it asks for.
 *
 * The student's own settings win over the deployment's, and the fallback matters as much as the
 * preference: a self-hosted install where one person set `OPENROUTER_API_KEY` in `wrangler.toml`
 * and never opens the settings screen must keep working exactly as it did. So a null column is
 * "use whatever this deployment was configured with", not "fail".
 *
 * Kept in one place because there are three call sites — extraction, the coach, and the calendar
 * reader — and a fourth added later that forgot to check the user's key would silently spend the
 * host's money instead of theirs. That is the kind of bug nobody notices until a bill arrives.
 */
export interface ResolvedProvider {
  apiKey: string | null;
  extractionModel: string;
  coachModel: string;
  /** True when the key came from the signed-in student rather than the deployment. */
  usingOwnKey: boolean;
}

export async function providerForUser(
  db: Db,
  env: Env,
  userId: string,
): Promise<ResolvedProvider> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  const own = user?.openrouterKeyEncrypted
    ? await decryptSecret(user.openrouterKeyEncrypted, env.AUTH_SECRET)
    : null;

  return {
    // `decryptSecret` returns null for a row sealed under a previous AUTH_SECRET, which is
    // indistinguishable from having no key — and falling back is the right answer for both.
    apiKey: own ?? env.OPENROUTER_API_KEY ?? null,
    extractionModel: user?.extractionModel ?? env.OPENROUTER_EXTRACTION_MODEL ?? MODELS.EXTRACTION,
    coachModel: user?.coachModel ?? env.OPENROUTER_COACH_MODEL ?? MODELS.COACH,
    usingOwnKey: own !== null,
  };
}

/**
 * The message shown when there is no key at all, anywhere.
 *
 * Names the screen to go to, because "Extraction is not configured" is a sentence about the
 * server written for whoever deployed it, and the person reading it is a student holding a PDF.
 */
export const NO_PROVIDER_MESSAGE =
  "No OpenRouter key is set, so nothing can read your syllabus yet. Add your key under Setup → " +
  "AI and model, then try the upload again.";
