import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { detailMode, themeName } from "@schoolquest/domain";
import { MODELS } from "@schoolquest/ai";
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
  return c.json({ user });
});

const profileBody = z.object({
  displayName: z.string().nullable().optional(),
  timezone: z.string().optional(),
  theme: themeName.optional(),
  reducedMotion: z.boolean().optional(),
  detailMode: detailMode.optional(),
});

app.patch("/api/me", async (c) => {
  const parsed = profileBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const db = getDb(c.env.DB);
  const [user] = await db
    .update(users)
    .set(parsed.data)
    .where(eq(users.id, c.get("userId")))
    .returning();
  return c.json({ user });
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
