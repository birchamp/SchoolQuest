import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { detailMode, themeName } from "@schoolquest/domain";
import { CEILINGS, coachModelId, defaultReaderId, MODELS } from "@schoolquest/ai";
import { getReaderCatalog, readerListFor } from "./model-catalog.js";
import { decryptSecret, encryptSecret, keyHint } from "./secrets.js";
import { redeemLoginToken, requestLoginLink, requireAuth, SESSION_COOKIE, setSessionCookie, signOut } from "./auth.js";
import { getDb } from "./db/repo.js";
import { users } from "./db/schema.js";
import { coachRoute } from "./routes/coach.js";
import { documentsRoute } from "./routes/documents.js";
import { extractionRoute } from "./routes/extraction.js";
import { plansRoute } from "./routes/plans.js";
import { reviewRoute } from "./routes/review.js";
import { sessionsRoute } from "./routes/sessions.js";
import { termsRoute } from "./routes/terms.js";
import type { AppBindings } from "./env.js";

const app = new Hono<AppBindings>();

/**
 * CORS is restricted to the configured web origin plus the Tauri desktop origins.
 * Credentials are allowed because the browser PWA authenticates by cookie.
 */
app.use("*", async (c, next) => {
  const allowed = [c.env.APP_URL, "tauri://localhost", "http://tauri.localhost"];
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : allowed[0]!),
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })(c, next);
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    app: c.env.APP_NAME,
    aiConfigured: Boolean(c.env.OPENROUTER_API_KEY),
    // Reported separately because they are deliberately different tiers, and a
    // misconfigured override is otherwise invisible until a syllabus reads badly.
    coachModel: c.env.OPENROUTER_COACH_MODEL ?? MODELS.COACH,
    extractionModel: c.env.OPENROUTER_EXTRACTION_MODEL ?? MODELS.EXTRACTION,
  }),
);

// --- Auth (unauthenticated) ---------------------------------------------------

app.post("/api/auth/login", async (c) => {
  const body = z
    .object({ email: z.string().email() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "A valid email address is required." }, 400);

  const { url, emailed } = await requestLoginLink(c.env, body.data.email);
  // The link is only echoed back when there is no mail provider, i.e. local development.
  return c.json({ ok: true, emailed, ...(emailed ? {} : { devLoginUrl: url }) });
});

app.post("/api/auth/callback", async (c) => {
  const body = z.object({ token: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Missing token" }, 400);

  const result = await redeemLoginToken(c.env, body.data.token);
  if (!result) return c.json({ error: "That sign-in link has expired or was already used." }, 401);

  setSessionCookie(c as never, result.sessionToken, c.env);
  // Also returned for the desktop shell, which authenticates by bearer token.
  return c.json({ ok: true, sessionToken: result.sessionToken });
});

app.post("/api/auth/logout", async (c) => {
  const token =
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ??
    c.req.header("Cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token) await signOut(c.env, token);
  return c.json({ ok: true });
});

// --- Authenticated ------------------------------------------------------------

app.use("/api/*", requireAuth);

app.get("/api/me", async (c) => {
  const db = getDb(c.env.DB);
  const [user] = await db.select().from(users).where(eq(users.id, c.get("userId")));
  const { openrouterKeyEncrypted, ...safe } = user!;

  /**
   * The key never comes back out, not even to the person who set it.
   *
   * A field that renders a live credential into the DOM is a field that ends up in a screenshot,
   * a screen share, or a bug report. What a student actually needs is to recognise *which* key
   * is stored and to be able to replace it, and a hint gives them both.
   */
  const stored = openrouterKeyEncrypted
    ? await decryptSecret(openrouterKeyEncrypted, c.env.AUTH_SECRET)
    : null;

  // Live from OpenRouter (cached) and pruned to recent models, so the picker never shows a model
  // that has been retired or a generation nobody should still be choosing.
  const catalog = await getReaderCatalog(c.env);
  const readerList = await readerListFor(c.env, CEILINGS.reader);

  return c.json({
    user: {
      ...safe,
      openrouterKeyHint: stored ? keyHint(stored) : null,
      // Whether this deployment has its own key, which decides whether a student *must* supply one.
      providerConfigured: Boolean(stored ?? c.env.OPENROUTER_API_KEY),
    },
    // Named rather than inferred: the client used to assume the first entry, and the list is
    // ordered by price while the default is chosen for accuracy. Those stopped agreeing the
    // moment extraction went back to the strongest reader.
    defaultExtractionModel:
      c.env.OPENROUTER_EXTRACTION_MODEL ?? defaultReaderId(readerList) ?? MODELS.EXTRACTION,
    // The reader list is live from OpenRouter, so it can never offer a deprecated model. The
    // coach is not in this list -- it is chosen for the student -- and is named separately only
    // so the settings screen can say which one is answering and what it costs.
    models: readerList,
    coachModel: coachModelId(catalog),
  });
});

const profileBody = z.object({
  displayName: z.string().nullable().optional(),
  timezone: z.string().optional(),
  theme: themeName.optional(),
  reducedMotion: z.boolean().optional(),
  detailMode: detailMode.optional(),
  /**
   * The student's OpenRouter key. Empty string clears it, which is the only way back to the
   * deployment's own key once one has been set.
   */
  openrouterKey: z.string().max(400).optional(),
  /**
   * Validated by shape, not against a fixed list. The choices are live from OpenRouter now,
   * so an enum of hardcoded ids would reject exactly the models the picker just offered. A
   * `provider/model` slug from a trusted family is the real constraint; a since-retired pick
   * simply errors on use, which is the signal to re-pick.
   */
  extractionModel: z
    .string()
    .regex(/^(google|anthropic|openai|x-ai)\/[\w.:-]+$/)
    .nullable()
    .optional(),
  coachModel: z
    .string()
    .regex(/^(google|anthropic|openai|x-ai)\/[\w.:-]+$/)
    .nullable()
    .optional(),
});

app.patch("/api/me", async (c) => {
  const parsed = profileBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { openrouterKey, ...profile } = parsed.data;
  const patch: Record<string, unknown> = { ...profile };

  if (openrouterKey !== undefined) {
    const trimmed = openrouterKey.trim();
    if (trimmed === "") {
      patch["openrouterKeyEncrypted"] = null;
    } else if (!trimmed.startsWith("sk-or-")) {
      // Caught here rather than at the first extraction, which would fail twenty pages later
      // with a provider error the student cannot act on.
      return c.json({ error: "An OpenRouter key starts with \"sk-or-\". Check you copied all of it." }, 400);
    } else {
      patch["openrouterKeyEncrypted"] = await encryptSecret(trimmed, c.env.AUTH_SECRET);
    }
  }

  const db = getDb(c.env.DB);
  const [user] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, c.get("userId")))
    .returning();
  const { openrouterKeyEncrypted, ...safe } = user!;
  return c.json({ user: { ...safe, openrouterKeyHint: openrouterKeyEncrypted ? keyHint(openrouterKey ?? "") : null } });
});

app.route("/api", termsRoute);
app.route("/api", plansRoute);
app.route("/api", sessionsRoute);
app.route("/api", reviewRoute);
app.route("/api", coachRoute);
app.route("/api", documentsRoute);
app.route("/api", extractionRoute);

app.onError((error, c) => {
  console.error("[api]", error);
  // Never leak internals to the client; the Worker log has the detail.
  return c.json({ error: "Something went wrong on our end." }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
