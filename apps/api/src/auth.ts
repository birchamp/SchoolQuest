import { eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { newId } from "@schoolquest/domain";
import { authSessions, loginTokens, users } from "./db/schema.js";
import type { AppBindings, Env } from "./env.js";

/**
 * Passwordless email sign-in.
 *
 * Only hashes of both the login token and the session token are stored, so a database
 * dump does not hand over live credentials. The raw token exists in the emailed URL and
 * in the cookie, nowhere else.
 */

const LOGIN_TOKEN_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 60;
export const SESSION_COOKIE = "sq_session";

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/**
 * Issues a magic link. Always resolves successfully, even for an unknown address, so the
 * endpoint cannot be used to discover which emails have accounts.
 */
export async function requestLoginLink(
  env: Env,
  email: string,
): Promise<{ url: string; emailed: boolean }> {
  const db = drizzle(env.DB);
  const normalized = email.trim().toLowerCase();

  const token = randomToken();
  const tokenHash = await hashToken(token, env.AUTH_SECRET);

  // Opportunistic cleanup keeps the table from growing without a cron job.
  await db.delete(loginTokens).where(lt(loginTokens.expiresAt, new Date().toISOString()));

  await db.insert(loginTokens).values({
    id: newId("session"),
    email: normalized,
    tokenHash,
    expiresAt: isoIn(LOGIN_TOKEN_TTL_MINUTES * 60_000),
    createdAt: new Date().toISOString(),
  });

  const url = `${env.APP_URL}/auth/callback?token=${token}`;
  const emailed = await sendLoginEmail(env, normalized, url);
  return { url, emailed };
}

async function sendLoginEmail(env: Env, email: string, url: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    // Local development: the link is returned to the caller and logged instead.
    console.log(`[auth] magic link for ${email}: ${url}`);
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${env.APP_NAME} <login@${new URL(env.APP_URL).hostname}>`,
      to: [email],
      subject: `Your ${env.APP_NAME} sign-in link`,
      text: `Sign in to ${env.APP_NAME}:\n\n${url}\n\nThis link expires in ${LOGIN_TOKEN_TTL_MINUTES} minutes. If you did not request it, you can ignore this email.`,
    }),
  });

  if (!response.ok) {
    console.error(`[auth] Resend failed: ${response.status} ${await response.text()}`);
    return false;
  }
  return true;
}

/** Redeems a magic-link token, creating the user on first sign-in. */
export async function redeemLoginToken(
  env: Env,
  token: string,
): Promise<{ sessionToken: string; userId: string } | null> {
  const db = drizzle(env.DB);
  const tokenHash = await hashToken(token, env.AUTH_SECRET);

  const [record] = await db.select().from(loginTokens).where(eq(loginTokens.tokenHash, tokenHash));
  if (!record) return null;

  // Single use: consume it whether or not it turns out to be expired.
  await db.delete(loginTokens).where(eq(loginTokens.id, record.id));
  if (record.expiresAt < new Date().toISOString()) return null;

  let [user] = await db.select().from(users).where(eq(users.email, record.email));
  if (!user) {
    const created = {
      id: newId("user"),
      email: record.email,
      displayName: null,
      timezone: "America/New_York",
      theme: "plain",
      reducedMotion: false,
      detailMode: "standard",
      // A new account inherits the deployment's key and default models; the settings screen is
      // where a student replaces either.
      openrouterKeyEncrypted: null,
      extractionModel: null,
      coachModel: null,
      createdAt: new Date().toISOString(),
    };
    await db.insert(users).values(created);
    user = created;
  }

  const sessionToken = randomToken();
  await db.insert(authSessions).values({
    id: newId("session"),
    userId: user.id,
    tokenHash: await hashToken(sessionToken, env.AUTH_SECRET),
    expiresAt: isoIn(SESSION_TTL_DAYS * 24 * 60 * 60_000),
    createdAt: new Date().toISOString(),
  });

  return { sessionToken, userId: user.id };
}

export function setSessionCookie(c: { header: (k: string, v: string) => void }, token: string, env: Env) {
  setCookie(c as never, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https"),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

/**
 * Rejects the request unless it carries a live session.
 *
 * Also accepts `Authorization: Bearer <token>` so the Tauri desktop shell, which does not
 * always share the browser cookie jar, can authenticate the same way.
 */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const bearer = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "Not signed in" }, 401);

  const db = drizzle(c.env.DB);
  const tokenHash = await hashToken(token, c.env.AUTH_SECRET);
  const [session] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash));

  if (!session) return c.json({ error: "Not signed in" }, 401);
  if (session.expiresAt < new Date().toISOString()) {
    await db.delete(authSessions).where(eq(authSessions.id, session.id));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ error: "Session expired" }, 401);
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user) return c.json({ error: "Not signed in" }, 401);

  c.set("userId", user.id);
  c.set("userEmail", user.email);
  await next();
};

export async function signOut(env: Env, token: string): Promise<void> {
  const db = drizzle(env.DB);
  await db
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, await hashToken(token, env.AUTH_SECRET)));
}
