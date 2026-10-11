/**
 * What every journey under tools/e2e needs, written once: the API client, signing a fresh
 * student up through the dev login link, the pinned clock, opening the app as that student, and
 * a run that starts the servers, collects checks, reports, and fails the process on any of them.
 *
 * A journey is then only its story:
 *
 *   import { TODAY, at, check, openApp, runJourney, signUp } from "./harness.mjs";
 *
 *   await runJourney("example checks", async ({ browser }) => {
 *     const { token } = await signUp("example");
 *     const { page, go, errors, context } = await openApp(browser, token, { now: at(TODAY, "09:00") });
 *     await go("Today");
 *     check("Today has something to do", (await page.locator(".primary-action").count()) === 1);
 *     check("no page errors", errors.length === 0, errors.join(" | "));
 *     await context.close();
 *   });
 *
 * `--attach` (from servers.mjs) uses servers already running on 5173 / 8787 instead of starting
 * them. The Worker needs DEV_MODE, which the dev scripts set: it returns the sign-in link on
 * screen and honours a simulated `now`.
 */
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";
import { ATTACH, startServers, stopServers, waitForServers } from "./servers.mjs";

export { ATTACH };
export const APP = "http://127.0.0.1:5173";
export const API = "http://127.0.0.1:8787";

// --- The API ------------------------------------------------------------------------------

/** Calls the Worker and returns its JSON; any non-2xx throws with the status and the body. */
export async function api(path, method = "GET", body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * A fresh account, signed in through the dev link, so no journey sees another's data.
 * `label` goes into the address, which is how a leftover account says which journey made it.
 */
export async function signUp(label) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.edu`;
  const login = await api("/api/auth/login", "POST", { email });
  if (typeof login?.devLoginUrl !== "string") {
    throw new Error("the Worker returned no sign-in link on screen -- is DEV_MODE set?");
  }
  const { sessionToken } = await api("/api/auth/callback", "POST", {
    token: new URL(login.devLoginUrl).searchParams.get("token"),
  });
  return { token: sessionToken, email };
}

// --- The clock ----------------------------------------------------------------------------

export const DAY = 86_400_000;

/**
 * Today's date in the app's wall clock. Journeys pin the hour, never the date: the date stays
 * real so "today" agrees everywhere, and the hour is fixed so a run at 23:50 still has a today
 * to book. The app reads `sq_dev_now` and the Worker honours `now` in dev mode.
 */
export const TODAY = new Date().toISOString().slice(0, 10);

/** The ISO date `days` after `base` (an ISO date). */
export const dateFrom = (base, days) => new Date(Date.parse(`${base}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** A wall-clock instant: `at("2026-10-11", "09:00")`. */
export const at = (date, time) => `${date}T${time}:00.000Z`;

// --- The browser --------------------------------------------------------------------------

/**
 * Opens the app as the student would and waits for the shell to draw.
 *
 *   now        the simulated clock (`sq_dev_now`); null runs on the real one
 *   viewMode   "visual" or "table", set before the first paint
 *   landOn     a main-navigation button to open once the plan has settled, e.g. "Today"
 *   context    extra Playwright context options, e.g. { timezoneId: "Pacific/Honolulu" }
 *   shell      false for a student with no term yet: they land on onboarding, which has no main
 *              navigation to wait for, so only the first load is awaited
 *
 * Returns the page, its context (close it when done), the main navigation, `go(name)` to click
 * through it, and `errors`, which collects every uncaught page error for a final check.
 */
export async function openApp(
  browser,
  token,
  { now = null, viewMode, landOn, shell = true, context: contextOptions = {} } = {},
) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, ...contextOptions });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.addInitScript(
    ({ token, now, viewMode }) => {
      localStorage.setItem("sq_session_token", token);
      if (now) localStorage.setItem("sq_dev_now", now);
      else localStorage.removeItem("sq_dev_now");
      if (viewMode) localStorage.setItem("sq_view_mode", viewMode);
    },
    { token, now, viewMode: viewMode ?? null },
  );
  await page.goto(APP);
  const nav = page.getByRole("navigation", { name: "Main" });
  if (shell) await nav.waitFor({ timeout: 30_000 });
  else await page.waitForLoadState("networkidle").catch(() => {});
  const go = async (name) => {
    await nav.getByRole("button", { name }).click();
    await page.waitForTimeout(800);
  };
  if (landOn) {
    // The plan load, and any replan it decides on, finish after the shell is drawn.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    await go(landOn);
  }
  return { page, context, nav, go, errors };
}

// --- Checks and the run -------------------------------------------------------------------

const results = [];

/** Records one outcome. A failed check fails the run, but the run carries on to the end. */
export function check(step, passed, detail = "") {
  results.push({ step, passed: Boolean(passed), detail });
  console.log(`${passed ? "ok  " : "FAIL"} ${step}${detail ? ` -- ${detail}` : ""}`);
}

/** Runs one of several independent journeys: one that throws fails itself and lets the rest run. */
export async function journey(run) {
  try {
    await run();
  } catch (error) {
    check("a journey ran to the end", false, String(error?.stack ?? error).slice(0, 800));
  }
}

/**
 * Starts the servers (unless --attach), launches Chromium, runs `body({ browser })`, then
 * tears everything down and prints "N of M <noun> passed". Any failed check -- or a run that
 * recorded none at all -- sets a non-zero exit code, with the tail of the server log beside it.
 *
 * `workerVars` ({ NAME: value }) are set on the Worker for this run only. With --attach they
 * cannot be, so they are printed for whoever started the servers to set themselves.
 */
export async function runJourney(noun, body, { workerVars = {} } = {}) {
  if (ATTACH && Object.keys(workerVars).length > 0) {
    const vars = Object.entries(workerVars).map(([name, value]) => `${name}=${value}`).join(" ");
    console.log(`--attach: the Worker must already be running with these vars:\n  SQ_WORKER_VARS="${vars}" pnpm dev\n`);
  }
  const serverLog = ATTACH ? [] : startServers({ workerVars });
  let browser;
  try {
    await waitForServers();
    browser = await chromium.launch(chromiumLaunchOptions());
    await body({ browser });
  } catch (error) {
    check("the journey ran to the end", false, String(error?.stack ?? error).slice(0, 800));
  } finally {
    await browser?.close().catch(() => {});
    if (!ATTACH) stopServers();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length} of ${results.length} ${noun} passed.`);
  if (failed.length > 0 || results.length === 0) {
    if (results.length === 0) console.log("No checks were recorded, which is a failure, not a pass.");
    if (serverLog.length > 0) console.log("\n--- last server output ---\n" + serverLog.slice(-60).join("\n"));
    process.exitCode = 1;
  }
}
