/* global Event */
/**
 * The release acceptance list (docs/02-prd.md §7), walked in a real browser against the real
 * Worker, and failing when any step does not do what the product promises.
 *
 *   node tools/e2e/acceptance.mjs            starts both servers itself, then stops them
 *   node tools/e2e/acceptance.mjs --attach   uses servers already running on 5173 / 8787
 *
 * This exists because the primary button on Today was dead for a month and nothing could
 * notice: every test in the repository is a pure function, and the one screen a student
 * actually uses had no test that rendered it. Each step below is a product outcome -- a badge
 * appears, a block moves, a card says what changed -- and each is asserted from the DOM. The
 * server-side setup (account, term, hours) goes through the API so the journey is fast and
 * deterministic; everything a student does with a mouse goes through the mouse.
 *
 * Needs DEV_MODE on the Worker (the dev scripts set it) for the on-screen sign-in link.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8787";
const ATTACH = process.argv.includes("--attach");
const WINDOWS = process.platform === "win32";

// --- Servers -----------------------------------------------------------------------------

function isListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(500);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

async function waitForServers(timeoutMs = 240_000) {
  const started = Date.now();
  for (;;) {
    const [api, web] = await Promise.all([isListening(8787), isListening(5173)]);
    if (api && web) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`servers did not come up within ${timeoutMs / 1000}s (api: ${api}, web: ${web})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let dev = null;
function startServers() {
  dev = spawn("node", ["tools/dev.mjs"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: WINDOWS,
    detached: !WINDOWS,
  });
  // Server output is kept for the failure report and otherwise stays out of the way.
  const log = [];
  for (const stream of [dev.stdout, dev.stderr]) {
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) if (line.trim()) log.push(line);
      if (log.length > 400) log.splice(0, log.length - 400);
    });
  }
  return log;
}

function stopServers() {
  if (!dev?.pid) return;
  if (WINDOWS) spawn("taskkill", ["/pid", String(dev.pid), "/f", "/t"], { stdio: "ignore" });
  else {
    try {
      process.kill(-dev.pid, "SIGTERM");
    } catch {
      try { dev.kill("SIGTERM"); } catch { /* already gone */ }
    }
  }
}

// --- Helpers -----------------------------------------------------------------------------

async function api(path, method = "GET", body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const results = [];
function check(step, passed, detail = "") {
  results.push({ step, passed, detail });
  console.log(`${passed ? "ok  " : "FAIL"} ${step}${detail ? ` -- ${detail}` : ""}`);
}

/** ISO date `days` from today, in the app's UTC wall clock. */
function dateFromToday(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// --- The journey -------------------------------------------------------------------------

const serverLog = ATTACH ? [] : startServers();
let browser;
try {
  await waitForServers();

  // 1. Sign in. The dev link comes back on screen, which is what a local run relies on.
  const email = `acceptance-${Date.now()}@example.edu`;
  const login = await api("/api/auth/login", "POST", { email });
  check("sign-in link is returned on screen in dev mode", typeof login.devLoginUrl === "string");
  const { sessionToken } = await api("/api/auth/callback", "POST", {
    token: new URL(login.devLoginUrl).searchParams.get("token"),
  });
  const me = await api("/api/me", "GET", undefined, sessionToken);
  check("the account exists and answers /api/me", me.user.email === email);

  // Setup the journey needs, through the API: a term with hours today, so Today has something
  // to show whatever hour CI runs at.
  const { term } = await api(
    "/api/terms",
    "POST",
    { name: "Acceptance term", startDate: dateFromToday(-7), endDate: dateFromToday(100) },
    sessionToken,
  );
  await api(
    `/api/terms/${term.id}/availability-rules`,
    "PUT",
    { rules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "00:00", endTime: "23:59" })) },
    sessionToken,
  );
  await api(
    `/api/terms/${term.id}/commitments`,
    "POST",
    { title: "Work shift", commitmentType: "work", daysOfWeek: [3], startTime: "14:00", endTime: "18:00" },
    sessionToken,
  );
  check("a term, hours and a fixed commitment were created", true);

  browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  await page.addInitScript((t) => localStorage.setItem("sq_session_token", t), sessionToken);
  await page.goto(APP);
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.waitFor({ timeout: 30_000 });
  const go = async (name) => {
    await nav.getByRole("button", { name }).click();
    await page.waitForTimeout(800);
  };

  // 2. Create a course in Setup, and see it appear without a reload (issue #6).
  await go("Setup");
  await page.getByRole("button", { name: /add a course/i }).first().click();
  await page.getByLabel("Course name").first().fill("Biology 101");
  await page.getByLabel("Course name").first().press("Enter");
  await page.waitForTimeout(1500);
  check(
    "a course added in Setup appears in the list without a reload",
    (await page.getByText("Biology 101").count()) > 0 && (await page.getByText(/No courses yet/).count()) === 0,
  );

  // 3. Add an assignment from the assignments table, due the day after tomorrow, and see the
  //    row appear (issue #6 again) -- which also triggers the first plan.
  await go("Assignments");
  await page.evaluate(() => {
    localStorage.setItem("sq_view_mode", "table");
    window.dispatchEvent(new Event("sq:view-mode"));
  });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Add an assignment/ }).first().click();
  await page.getByPlaceholder("Reading response 4").fill("Lab report 1");
  const dueInput = page.locator("input[type=date]").first();
  if (await dueInput.count()) await dueInput.fill(dateFromToday(2));
  await page.getByRole("button", { name: /Add it/ }).click();
  await page.waitForTimeout(2500);
  check(
    "an assignment added from the table appears in the table without a reload",
    (await page.getByText("Lab report 1").count()) > 0 && (await page.getByText("Nothing here yet").count()) === 0,
  );

  // 4. Today recommends it, with a reason.
  await go("Today");
  const primary = page.locator(".primary-action");
  await primary.waitFor({ timeout: 15_000 });
  check(
    "Today shows one primary action with a plain-language reason",
    (await primary.locator(".rationale").count()) === 1 && /Lab report 1/.test(await primary.innerText()),
  );

  // 5. Start it, see it underway, survive a reload, stop it. Issue #5.
  await primary.getByRole("button", { name: /start session|begin/i }).click();
  await page.waitForTimeout(1500);
  check("Start session shows the block as underway", (await page.getByTestId("session-underway").count()) === 1);
  await page.reload();
  await nav.waitFor({ timeout: 30_000 });
  await go("Today");
  check("the started state survives a reload", (await page.getByTestId("session-underway").count()) === 1);
  await page.getByRole("button", { name: /Stop, it's done/ }).click();
  await page.waitForTimeout(2000);
  check(
    "Stop records the outcome and the block is no longer underway",
    (await page.getByTestId("session-underway").count()) === 0 &&
      (await page.getByText(/Marked done|Quest complete/).count()) === 1,
  );

  // More work, so the week has blocks to move and the day has blocks to give up.
  const { course } = await api(`/api/terms/${term.id}/snapshot`, "GET", undefined, sessionToken).then((s) => ({
    course: s.courses[0],
  }));
  for (const [title, days, minutes] of [["Essay draft", 4, 120], ["Quiz prep", 3, 60]]) {
    await api(
      "/api/work-items",
      "POST",
      { courseId: course.id, title, workType: "assignment", dueAt: `${dateFromToday(days)}T23:59:00Z`, estimatedMinutes: minutes },
      sessionToken,
    );
  }
  await api(`/api/terms/${term.id}/plans/generate`, "POST", {}, sessionToken);

  // 6. Move a block from the hour calendar with the keyboard, and lock it. Back to the
  //    visual views first: the table mode set above has no hour calendar.
  await page.evaluate(() => localStorage.setItem("sq_view_mode", "visual"));
  await page.reload();
  await nav.waitFor({ timeout: 30_000 });
  await go("Week plan");
  await page.getByRole("button", { name: "Hour by hour" }).click();
  await page.waitForTimeout(1200);
  const band = page.locator("[data-session-id]").first();
  check("study blocks on the hour calendar are operable", (await band.count()) === 1);
  const sessionId = await band.getAttribute("data-session-id");
  const before = (await api(`/api/terms/${term.id}/plans/current`, "GET", undefined, sessionToken)).sessions.find(
    (s) => s.id === sessionId,
  );
  await band.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(2500);
  const after = (await api(`/api/terms/${term.id}/plans/current`, "GET", undefined, sessionToken)).sessions.find(
    (s) => s.id === sessionId,
  );
  check(
    "ArrowRight moves the block one day later on the server",
    Boolean(before && after) && Date.parse(after.startAt) - Date.parse(before.startAt) === 86_400_000,
    `${before?.startAt} -> ${after?.startAt}`,
  );
  await page.keyboard.press("l");
  await page.waitForTimeout(2000);
  const locked = (await api(`/api/terms/${term.id}/plans/current`, "GET", undefined, sessionToken)).sessions.find(
    (s) => s.id === sessionId,
  );
  check("L locks the block", locked?.locked === true);
  const tools = page.getByTestId("calendar-block-tools");
  check("the block toolbar names the selected block as locked", /locked/.test(await tools.innerText()));

  // 7. A move onto another block is refused with a reason the student can read.
  const current = (await api(`/api/terms/${term.id}/plans/current`, "GET", undefined, sessionToken)).sessions;
  const other = current.find((s) => s.id !== sessionId && s.status === "planned");
  let refusal = "";
  try {
    await api(`/api/work-sessions/${other.id}/move`, "POST", { startAt: locked.startAt, endAt: locked.endAt }, sessionToken);
  } catch (e) {
    refusal = String(e.message);
  }
  check("moving a block onto another is refused and names the block in the way", /409/.test(refusal) && /already booked/.test(refusal));

  // 8. Lose a day and see what moved.
  await go("Today");
  const lost = page.getByTestId("lost-day");
  check("Today offers to give the day up when blocks are still open", (await lost.count()) === 1);
  await lost.getByRole("button").first().click();
  await page.getByRole("button", { name: /Yes, skip today|Yes/ }).click();
  await page.waitForTimeout(5000);
  const changes = page.getByTestId("plan-changes");
  check(
    "after a lost day the plan says what changed",
    (await changes.count()) === 1 && /kept|moved|added|dropped|Nothing moved/.test(await changes.innerText()),
    (await changes.innerText().catch(() => "")).split("\n").slice(0, 3).join(" | "),
  );
  const openToday = (await api(`/api/terms/${term.id}/plans/current`, "GET", undefined, sessionToken)).sessions.filter(
    (s) => s.startAt.slice(0, 10) === dateFromToday(0) && (s.status === "planned" || s.status === "started"),
  );
  check("nothing is planned for the lost day any more", openToday.length === 0);

  // 9. Enter a grade and see the course standing change.
  const items = (await api(`/api/terms/${term.id}/snapshot`, "GET", undefined, sessionToken)).workItems;
  const graded = items.find((w) => w.title === "Lab report 1");
  await api(`/api/work-items/${graded.id}/grade`, "PUT", { pointsEarned: 18, pointsPossible: 20 }, sessionToken);
  const standing = (await api(`/api/terms/${term.id}/plans/current`, "GET", undefined, sessionToken)).standings[course.id];
  check("a recorded grade produces a course standing", typeof standing?.estimatedPercent === "number", `estimated ${standing?.estimatedPercent}`);

  // 10. Switch themes from Setup.
  await go("Setup");
  await page.getByRole("button", { name: /^quest$/i }).first().click();
  await page.waitForTimeout(1200);
  check("switching to Quest repaints the app", (await page.evaluate(() => document.body.dataset.theme)) === "quest");
  await page.getByRole("button", { name: /^plain$/i }).first().click();
  await page.waitForTimeout(800);

  // 11. The coach without a key says so, about the coach, not about a syllabus.
  let coachMessage = "";
  try {
    await api("/api/coach/messages", "POST", { termId: term.id, message: "What should I do first?" }, sessionToken);
  } catch (e) {
    coachMessage = String(e.message);
  }
  check("the coach without a key explains itself in its own terms", /503/.test(coachMessage) && /coach/.test(coachMessage));

  check("no page errors were thrown anywhere on the journey", pageErrors.length === 0, pageErrors.join(" | "));
} catch (error) {
  check("the journey ran to the end", false, String(error?.stack ?? error).slice(0, 600));
} finally {
  await browser?.close().catch(() => {});
  if (!ATTACH) stopServers();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length} of ${results.length} acceptance steps passed.`);
if (failed.length > 0) {
  if (serverLog.length > 0) console.log("\n--- last server output ---\n" + serverLog.slice(-60).join("\n"));
  process.exitCode = 1;
}
