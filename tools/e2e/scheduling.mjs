/* global Event */
/**
 * Does every assignment that is coming due get time on the calendar?
 *
 *   node tools/e2e/scheduling.mjs            starts both servers itself, then stops them
 *   node tools/e2e/scheduling.mjs --attach   uses servers already running on 5173 / 8787
 *
 * The acceptance journey proves the buttons work. This one proves the promise the app is built
 * on -- "if I do what it says, will everything else still get done?" -- across the moments a real
 * student lives through rather than the single instant a unit test freezes: a normal week, the
 * week after it, a block skipped, an evening in a time zone that is not UTC, and a week with more
 * work than hours. Each journey is a fresh account on the real Worker, and each ends in the same
 * audit: every piece of work due before the plan's horizon closes either has enough time booked
 * ahead of its deadline, or is named in a risk that says it does not. Work that is in neither
 * place has silently fallen off the plan, and that is the failure the student reported.
 *
 * Needs DEV_MODE on the Worker (the dev scripts set it): the sign-in link comes back on screen and
 * the Worker honours a simulated `now`, which is what lets "the week after" be tomorrow's test
 * rather than next week's.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";
import { startServers, stopServers, waitForServers, ATTACH } from "./servers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8787";

// --- Helpers -----------------------------------------------------------------------------

async function api(path, method = "GET", body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const results = [];
function check(step, passed, detail = "") {
  results.push({ step, passed, detail });
  console.log(`${passed ? "ok  " : "FAIL"} ${step}${detail ? ` -- ${detail}` : ""}`);
}

const DAY = 86_400_000;
/** Today's date in the app's wall clock. Journeys pin the hour, never the date. */
const TODAY = new Date().toISOString().slice(0, 10);
const dateFrom = (base, days) => new Date(Date.parse(`${base}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const at = (date, time) => `${date}T${time}:00.000Z`;

/** The student's date for a moment, in an IANA zone. */
function localDateIn(moment, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(moment)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The UTC instant of a local date and time in an IANA zone, worked out independently of the app. */
function instantIn(date, time, zone) {
  // Start from the time read as UTC and correct by the zone's offset until the local reading
  // matches; three rounds settle any real zone, daylight saving included.
  const naive = Date.parse(`${date}T${time}:00.000Z`);
  let t = naive;
  for (let i = 0; i < 3; i += 1) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    t += naive - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00.000Z`);
  }
  return new Date(t).toISOString();
}

/** Runs SQL against the local D1 the dev Worker uses. Local runs only, which is all this is. */
function localSql(sql) {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", "schoolquest", "--local", "--command", sql], {
    cwd: join(ROOT, "apps", "api"),
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`local SQL failed: ${result.stderr || result.stdout}`);
}

async function signUp(label) {
  const email = `scheduling-${label}-${Date.now()}@example.edu`;
  const login = await api("/api/auth/login", "POST", { email });
  const { sessionToken } = await api("/api/auth/callback", "POST", {
    token: new URL(login.devLoginUrl).searchParams.get("token"),
  });
  return sessionToken;
}

/**
 * A student shaped like the one who reported this: four classes, a part-time job, afternoons and
 * evenings free on weekdays and most of the weekend. Nothing exotic -- the point is that an
 * ordinary week has to work.
 */
async function ordinaryStudent(token, { termStart, termEnd }) {
  const { term } = await api("/api/terms", "POST", { name: "Fall", startDate: termStart, endDate: termEnd }, token);
  const rules = [];
  for (const d of [1, 2, 3, 4, 5]) rules.push({ dayOfWeek: d, startTime: "15:00", endTime: "22:00" });
  for (const d of [0, 6]) rules.push({ dayOfWeek: d, startTime: "10:00", endTime: "18:00" });
  await api(`/api/terms/${term.id}/availability-rules`, "PUT", { rules }, token);
  await api(
    `/api/terms/${term.id}/commitments`,
    "POST",
    { title: "Shift at the library", commitmentType: "work", daysOfWeek: [2, 4], startTime: "17:00", endTime: "20:00" },
    token,
  );
  const courses = {};
  for (const [key, name, days, start, end] of [
    ["bio", "Biology 101", [1, 3, 5], "09:00", "09:50"],
    ["eng", "English Composition", [2, 4], "11:00", "12:15"],
    ["his", "US History", [1, 3], "13:00", "14:15"],
    ["mat", "College Algebra", [1, 2, 3, 4], "15:00", "15:50"],
  ]) {
    const { course } = await api(
      `/api/terms/${term.id}/courses`,
      "POST",
      { name, meetingPatterns: [{ daysOfWeek: days, startTime: start, endTime: end }] },
      token,
    );
    courses[key] = course.id;
  }
  return { termId: term.id, courses };
}

async function addWork(token, courseId, title, workType, dueAt, estimatedMinutes) {
  const { workItem } = await api(
    "/api/work-items",
    "POST",
    { courseId, title, workType, dueAt, estimatedMinutes: estimatedMinutes ?? null },
    token,
  );
  return workItem;
}

/**
 * A week of work for `ordinaryStudent`, due over the seven days from `day`.
 *
 * `readingDue` is when the next-day reading closes. Nine in the morning is the hard case -- only
 * the evening before can hold it -- and it is genuinely impossible when the plan is made after
 * the last free hour of that evening, so the evening sweep moves it to the end of the day.
 */
async function ordinaryWeek(token, c, day, { readingDue = "09:00" } = {}) {
  await addWork(token, c.bio, "Lab report 3", "assignment", at(dateFrom(day, 2), "23:59"), 90);
  await addWork(token, c.bio, "Chapter 7 reading", "reading", at(dateFrom(day, 1), readingDue), 45);
  await addWork(token, c.eng, "Essay 2 draft", "paper", at(dateFrom(day, 5), "23:59"), 180);
  await addWork(token, c.eng, "Peer review", "assignment", at(dateFrom(day, 3), "11:00"), 40);
  await addWork(token, c.his, "Primary source response", "assignment", at(dateFrom(day, 4), "23:59"), 60);
  await addWork(token, c.his, "Quiz 4", "quiz", at(dateFrom(day, 6), "13:00"), null);
  // Small things are real work too: shorter than the shortest session the planner likes.
  await addWork(token, c.his, "Discussion post", "discussion", at(dateFrom(day, 2), "23:59"), 15);
  await addWork(token, c.mat, "Homework 6", "problem_set", at(dateFrom(day, 1), "23:59"), 75);
  await addWork(token, c.mat, "Homework 7", "problem_set", at(dateFrom(day, 4), "23:59"), 75);
  await addWork(token, c.mat, "Unit 2 exam prep", "exam_prep", at(dateFrom(day, 6), "15:00"), 150);
}

/** The engine's fallback when the student gave no estimate; mirrors DEFAULT_EFFORT_MINUTES. */
const DEFAULT_EFFORT = { reading: 60, quiz: 30, problem_set: 90, paper: 240, exam: 60, exam_prep: 120, assignment: 60 };
const required = (w) => w.remainingMinutes ?? w.estimatedMinutes ?? DEFAULT_EFFORT[w.workType] ?? 60;

/**
 * The audit every journey ends in.
 *
 * For each open piece of work due between `now` and the end of the plan's horizon: how many open
 * minutes are booked for it before its deadline. Enough is "covered". Less than enough is fine
 * only if the plan says so in a risk naming the item -- the student was told. Anything else
 * dropped off the plan in silence.
 */
function auditCoverage(plan, now) {
  const nowMs = Date.parse(now);
  const horizonEndMs = Date.parse(`${plan.planVersion?.horizonEnd ?? plan.horizonEnd}T00:00:00Z`);
  const risksByItem = new Map();
  for (const r of plan.risks ?? []) {
    if (!r.workItemId) continue;
    risksByItem.set(r.workItemId, [...(risksByItem.get(r.workItemId) ?? []), r]);
  }
  const rows = [];
  for (const w of plan.workItems) {
    if (!w.dueAt || ["completed", "submitted", "canceled", "optional"].includes(w.status)) continue;
    const due = Date.parse(w.dueAt);
    if (due <= nowMs || due > horizonEndMs) continue;
    const booked = plan.sessions
      .filter((s) => s.workItemId === w.id && (s.status === undefined || s.status === "planned" || s.status === "started"))
      .filter((s) => Date.parse(s.startAt) >= nowMs - 30 * 60_000 && Date.parse(s.endAt) <= due)
      .reduce((sum, s) => sum + Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000), 0);
    const need = required(w);
    const warned = (risksByItem.get(w.id) ?? []).some((r) => r.level === "at_risk" || r.code === "INSUFFICIENT_CAPACITY");
    rows.push({ title: w.title, due: w.dueAt.slice(0, 16), need, booked, warned, ok: booked >= need || warned });
  }
  return rows;
}

/**
 * `strict` is for a week with room to spare, where a warning is not an acceptable answer: the
 * planner saying "no window fits this" in a week that is mostly empty is the bug, not the excuse.
 */
function report(name, rows, { strict = false } = {}) {
  const silent = rows.filter((r) => (strict ? r.booked < r.need : !r.ok));
  if (process.argv.includes("--verbose")) console.table(rows);
  check(
    strict
      ? `${name}: every assignment due inside the plan has all of its time`
      : `${name}: every assignment due inside the plan has its time, or a warning that it does not`,
    silent.length === 0 && rows.length > 0,
    silent.length === 0
      ? `${rows.length} items, ${rows.filter((r) => r.booked >= r.need).length} fully booked`
      : `${silent.length} of ${rows.length} silently short: ` +
          silent
            .map((r) => `"${r.title}" due ${r.due} has ${r.booked}/${r.need} min${r.warned ? " (warned)" : ""}`)
            .join("; "),
  );
}

async function currentPlan(token, termId, now) {
  return api(`/api/terms/${termId}/plans/current${now ? `?now=${encodeURIComponent(now)}` : ""}`, "GET", undefined, token);
}

/** Opens the app as the student would, with the simulated clock, and waits for it to settle. */
async function openApp(browser, token, now, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.addInitScript(
    ({ token, now }) => {
      localStorage.setItem("sq_session_token", token);
      if (now) localStorage.setItem("sq_dev_now", now);
      else localStorage.removeItem("sq_dev_now");
    },
    { token, now },
  );
  await page.goto(APP);
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.waitFor({ timeout: 30_000 });
  // The plan load, and any replan it decides on, finish after the shell is drawn.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  // The app opens on the radar; Today is where a student goes to be told what to do.
  await nav.getByRole("button", { name: "Today" }).click();
  await page.waitForTimeout(800);
  return { page, context, errors };
}

// --- Journeys ----------------------------------------------------------------------------

/** Runs one journey; a journey that throws fails itself and lets the others run. */
async function journey(run) {
  try {
    await run();
  } catch (error) {
    check("a journey ran to the end", false, String(error?.stack ?? error).slice(0, 800));
  }
}

const serverLog = ATTACH ? [] : startServers();
let browser;
try {
  await waitForServers();
  browser = await chromium.launch(chromiumLaunchOptions());

  // 1. An ordinary week, planned on a weekday morning before classes. Every assignment due in
  //    the next seven days should get its time.
  await journey(async () => {
    const token = await signUp("week");
    const monday = TODAY;
    const now = at(monday, "08:00");
    const s = await ordinaryStudent(token, { termStart: dateFrom(monday, -21), termEnd: dateFrom(monday, 80) });
    const c = s.courses;
    await ordinaryWeek(token, c, monday);
    // Next week's work, which this week's plan need not finish but next week's must.
    await addWork(token, c.bio, "Lab report 4", "assignment", at(dateFrom(monday, 9), "23:59"), 90);
    await addWork(token, c.eng, "Essay 2 final", "paper", at(dateFrom(monday, 12), "23:59"), 120);
    await addWork(token, c.his, "Map quiz", "quiz", at(dateFrom(monday, 10), "13:00"), 30);
    await addWork(token, c.mat, "Homework 8", "problem_set", at(dateFrom(monday, 11), "23:59"), 75);
    await addWork(token, c.mat, "Homework 9", "problem_set", at(dateFrom(monday, 13), "23:59"), 75);

    await api(`/api/terms/${s.termId}/plans/generate`, "POST", { now, horizonStart: monday }, token);
    report("an ordinary week", auditCoverage(await currentPlan(token, s.termId, now), now), { strict: true });

    // 2. The student opens the app again eight days later. Nothing was replanned in between --
    //    they did not press anything -- and the week the plan was made for is over. They did
    //    hand in last week's work (marked from the assignments table, which is not a replan):
    //    ten overdue items would rightly outrank everything and measure something else.
    const later = at(dateFrom(monday, 8), "10:00");
    for (const w of (await api(`/api/terms/${s.termId}/snapshot`, "GET", undefined, token)).workItems) {
      if (w.dueAt < later) await api(`/api/work-items/${w.id}`, "PATCH", { status: "submitted" }, token);
    }
    const { page, context, errors } = await openApp(browser, token, later);
    const plan = await currentPlan(token, s.termId, later);
    const horizonEnd = plan.planVersion.horizonEnd;
    check(
      "a week later: opening the app plans the week that has arrived, not the one that ended",
      horizonEnd > later.slice(0, 10),
      `plan horizon ends ${horizonEnd}, today is ${later.slice(0, 10)}`,
    );
    report("a week later", auditCoverage(plan, later), { strict: true });
    const primary = page.locator(".primary-action");
    check(
      "a week later: Today has something to do",
      (await primary.count()) === 1,
      (await page.locator("main").innerText().catch(() => "")).split("\n").slice(0, 3).join(" | "),
    );
    check("a week later: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  });

  // 3. A block the student lets go. "Not now" on Today, then the rest of the day. The work it was
  //    for is still due; its time has to come back somewhere.
  await journey(async () => {
    const token = await signUp("skip");
    const day = TODAY;
    const now = at(day, "14:30");
    const s = await ordinaryStudent(token, { termStart: dateFrom(day, -21), termEnd: dateFrom(day, 80) });
    await addWork(token, s.courses.mat, "Homework 6", "problem_set", at(dateFrom(day, 3), "23:59"), 60);
    await addWork(token, s.courses.his, "Reading response", "assignment", at(dateFrom(day, 4), "23:59"), 45);
    await api(`/api/terms/${s.termId}/plans/generate`, "POST", { now, horizonStart: day }, token);

    const { page, context, errors } = await openApp(browser, token, now);
    const primary = page.locator(".primary-action");
    await primary.waitFor({ timeout: 15_000 });
    const skippedTitle = (await primary.locator(".title").first().innerText().catch(() => "")).trim();
    await primary.getByRole("button", { name: /not now/i }).first().click();
    // Declining to say what took the time is the ordinary answer.
    await primary.getByRole("button", { name: /^skip it$/i }).first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    report(`a skipped block ("${skippedTitle}")`, auditCoverage(await currentPlan(token, s.termId, now), now), { strict: true });

    // The next morning, with yesterday's other block simply never done.
    const tomorrow = at(dateFrom(day, 1), "09:00");
    const next = await openApp(browser, token, tomorrow);
    report("the morning after a missed block", auditCoverage(await currentPlan(token, s.termId, tomorrow), tomorrow), {
      strict: true,
    });
    check("skip journeys: no page errors", errors.length + next.errors.length === 0, [...errors, ...next.errors].join(" | "));
    await next.context.close();
    await context.close();
  });

  // 3b. "Needs more time." The student worked the block, the work is not finished, and they
  //     said so. The assignment must stay open and get another block.
  await journey(async () => {
    const token = await signUp("more");
    const day = TODAY;
    const now = at(day, "15:00");
    const s = await ordinaryStudent(token, { termStart: dateFrom(day, -21), termEnd: dateFrom(day, 80) });
    const item = await addWork(token, s.courses.eng, "Essay outline", "assignment", at(dateFrom(day, 3), "23:59"), 60);
    await api(`/api/terms/${s.termId}/plans/generate`, "POST", { now, horizonStart: day }, token);

    const { page, context, errors } = await openApp(browser, token, now);
    const primary = page.locator(".primary-action");
    await primary.waitFor({ timeout: 15_000 });
    await primary.getByRole("button", { name: /needs more time/i }).first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    const plan = await currentPlan(token, s.termId, now);
    const after = plan.workItems.find((w) => w.id === item.id);
    check(
      '"Needs more time" leaves the assignment open',
      after.status !== "completed",
      `status ${after.status}, ${after.remainingMinutes} min remaining`,
    );
    const open = plan.sessions.filter((x) => x.workItemId === item.id && x.status === "planned");
    check('"Needs more time" gets the assignment another block', open.length > 0, `${open.length} open blocks`);
    check('"Needs more time": no page errors', errors.length === 0, errors.join(" | "));
    await context.close();
  });

  // 4. The real clock, for a student who does not live at UTC+0 (issue #4). No simulated time:
  //    the browser is in Chicago, with daylight saving and all. Inside the system every time is
  //    UTC; the student sees and types Chicago time. A deadline typed as "Friday, end of day" is
  //    stored as the real instant of midnight in Chicago, shown back as Friday, and the first
  //    block lands at the real now -- not five or six hours later, when it is "now" in Greenwich.
  await journey(async () => {
    const zone = "America/Chicago";
    const token = await signUp("zone");
    const localToday = localDateIn(new Date(), zone);
    const s = await ordinaryStudent(token, { termStart: dateFrom(localToday, -21), termEnd: dateFrom(localToday, 80) });
    await api(
      `/api/terms/${s.termId}/availability-rules`,
      "PUT",
      { rules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "00:00", endTime: "23:59" })) },
      token,
    );
    // No classes, shift or meals in the way of the measurement.
    for (const id of Object.values(s.courses)) {
      await api(`/api/courses/${id}/meeting-patterns`, "PUT", { patterns: [] }, token);
    }
    const snapshot = await api(`/api/terms/${s.termId}/snapshot`, "GET", undefined, token);
    for (const commitment of snapshot.commitments) await api(`/api/commitments/${commitment.id}`, "DELETE", undefined, token);
    await api(`/api/terms/${s.termId}`, "PATCH", { planningPreferences: { mealWindows: [] } }, token);

    const { page, context, errors } = await openApp(browser, token, null, { timezoneId: zone, locale: "en-US" });
    const me = (await api("/api/me", "GET", undefined, token)).user;
    check("time zone: the app tells the server where the student is", me.timezone === zone, `stored ${me.timezone}`);

    // Type a deadline the way a student does: a date, and the end-of-day default time.
    const dueDay = dateFrom(localToday, 2);
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: "Assignments" }).click();
    await page.evaluate(() => {
      localStorage.setItem("sq_view_mode", "table");
      window.dispatchEvent(new Event("sq:view-mode"));
    });
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /Add an assignment/ }).first().click();
    await page.getByPlaceholder("Reading response 4").fill("Lab report");
    await page.locator("input[type=date]").first().fill(dueDay);
    await page.getByRole("button", { name: /Add it/ }).click();
    await page.getByText("Lab report").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);

    const item = (await api(`/api/terms/${s.termId}/snapshot`, "GET", undefined, token)).workItems.find(
      (w) => w.title === "Lab report",
    );
    const expected = instantIn(dueDay, "23:59", zone);
    check(
      "time zone: a deadline typed in Chicago is stored as the UTC instant it means",
      item?.dueAt === expected,
      `typed ${dueDay} end of day, stored ${item?.dueAt}, expected ${expected}`,
    );
    const shownDate = await page.locator(`#work-item-${item?.id} input[type=date]`).first().inputValue().catch(() => "");
    check("time zone: the table shows it back on the day it was typed", shownDate === dueDay, `shows ${shownDate}`);

    const plan = await currentPlan(token, s.termId, null);
    const first = plan.sessions
      .filter((x) => x.status === "planned")
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
    const lagMinutes = first ? Math.round((Date.parse(first.startAt) - Date.now()) / 60_000) : null;
    // A break or a rounding to the minute; five hours is the bug.
    check(
      "time zone: the first block starts at the real now",
      lagMinutes !== null && lagMinutes >= -5 && lagMinutes <= 60,
      `first block ${first?.startAt}, ${lagMinutes} min from now`,
    );

    await nav.getByRole("button", { name: "Today" }).click();
    await page.waitForTimeout(800);
    const shownTime = first
      ? new Date(first.startAt).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" })
      : "none";
    const primaryText = await page.locator(".primary-action").innerText().catch(() => "");
    check(
      "time zone: Today shows the block at its Chicago time",
      primaryText.includes(shownTime),
      `expected "${shownTime}" in: ${primaryText.split("\n").slice(0, 3).join(" | ")}`,
    );
    report("time zone", auditCoverage(plan, new Date().toISOString()));
    check("time zone: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  });

  // 5b. An account from before every time was UTC. Its stored times were Chicago wall-clock
  //     values spelled as UTC; the first requests after the update convert them -- once, even
  //     when the app fires several at the same moment, and across more rows than one statement.
  await journey(async () => {
    const email = `scheduling-legacy-${Date.now()}@example.edu`;
    const login = await api("/api/auth/login", "POST", { email });
    const { sessionToken: token } = await api("/api/auth/callback", "POST", {
      token: new URL(login.devLoginUrl).searchParams.get("token"),
    });
    await api("/api/me", "PATCH", { timezone: "America/Chicago" }, token);
    const { term } = await api("/api/terms", "POST", { name: "Fall", startDate: "2026-08-24", endDate: "2026-12-15" }, token);
    await api(
      `/api/terms/${term.id}/availability-rules`,
      "PUT",
      { rules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "10:00", endTime: "20:00" })) },
      token,
    );
    const { course } = await api(`/api/terms/${term.id}/courses`, "POST", { name: "History" }, token);
    // Written the old way: "midnight on the day", in the student's own clock. Enough rows that
    // the conversion needs more than one statement.
    for (let i = 0; i < 35; i += 1) {
      await addWork(token, course.id, `Reading ${i + 1}`, "reading", `2026-10-${String(13 + (i % 5)).padStart(2, "0")}T23:59:00.000Z`, 30);
    }
    await api(`/api/terms/${term.id}/plans/generate`, "POST", { now: "2026-10-12T15:00:00.000Z", horizonStart: "2026-10-12" }, token);
    const before = await api(`/api/terms/${term.id}/snapshot`, "GET", undefined, token);
    localSql(`UPDATE users SET time_standard = 0 WHERE email = '${email}'`);

    // The app's first requests after an update arrive together.
    await Promise.all([1, 2, 3].map(() => api("/api/terms", "GET", undefined, token)));
    const after = await api(`/api/terms/${term.id}/snapshot`, "GET", undefined, token);
    await api("/api/terms", "GET", undefined, token);
    const later = await api(`/api/terms/${term.id}/snapshot`, "GET", undefined, token);

    // October in Chicago is UTC-5: every value moves exactly five hours later, once.
    const fiveHours = (iso) => new Date(Date.parse(iso) + 5 * 3_600_000).toISOString();
    const wrongItems = before.workItems.filter(
      (w) => after.workItems.find((x) => x.id === w.id)?.dueAt !== fiveHours(w.dueAt),
    );
    const wrongSessions = before.existingSessions.filter(
      (s) => after.existingSessions.find((x) => x.id === s.id)?.startAt !== fiveHours(s.startAt),
    );
    check(
      "an old account's local times become the UTC instants they meant, exactly once",
      before.workItems.length === 35 &&
        before.existingSessions.length > 0 &&
        wrongItems.length === 0 &&
        wrongSessions.length === 0 &&
        JSON.stringify(later.workItems) === JSON.stringify(after.workItems),
      `${before.workItems.length} items, ${before.existingSessions.length} blocks; ` +
        `${wrongItems.length} items and ${wrongSessions.length} blocks wrong; ` +
        `e.g. ${before.workItems[0]?.dueAt} -> ${after.workItems.find((x) => x.id === before.workItems[0]?.id)?.dueAt}`,
    );
  });

  // 6. The same ordinary week, starting on every day of the week, planned in the morning and in
  //    the evening. One run of this journey only ever sees one weekday; a planner that is right
  //    on a Saturday morning can be wrong on a Tuesday night, and was -- it booked five-minute
  //    slivers and gave a problem set due the next night fifty of its seventy-five minutes.
  //    Simulated dates only, so the whole week is checked on every run.
  await journey(async () => {
    const short = [];
    for (const hour of ["08:00", "19:00"]) {
      for (let offset = 0; offset < 7; offset += 1) {
        const day = dateFrom(TODAY, offset);
        const now = at(day, hour);
        const token = await signUp(`sweep${offset}${hour.slice(0, 2)}`);
        const s = await ordinaryStudent(token, { termStart: dateFrom(day, -21), termEnd: dateFrom(day, 80) });
        await ordinaryWeek(token, s.courses, day, { readingDue: hour === "08:00" ? "09:00" : "23:59" });
        await api(`/api/terms/${s.termId}/plans/generate`, "POST", { now, horizonStart: day }, token);
        const plan = await currentPlan(token, s.termId, now);
        const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
        for (const row of auditCoverage(plan, now)) {
          if (row.booked < row.need) short.push(`${weekday} ${hour}: "${row.title}" ${row.booked}/${row.need}`);
        }
        const slivers = plan.sessions.filter(
          (x) => (Date.parse(x.endAt) - Date.parse(x.startAt)) / 60_000 < 15,
        );
        for (const x of slivers) short.push(`${weekday} ${hour}: a ${(Date.parse(x.endAt) - Date.parse(x.startAt)) / 60_000}-minute sliver`);
      }
    }
    check(
      "every weekday, morning and evening: every assignment has all of its time, in real blocks",
      short.length === 0,
      short.length === 0 ? "14 weeks planned" : short.join("; "),
    );
  });

  // 7. What the student committed to survives the replan that now happens on its own every
  //    morning. A block started and never stopped stays on Today until it is finished; a locked
  //    block stays on the calendar where the student put it.
  await journey(async () => {
    const token = await signUp("kept");
    const day = TODAY;
    const s = await ordinaryStudent(token, { termStart: dateFrom(day, -21), termEnd: dateFrom(day, 80) });
    // Fifty minutes a day, so a long essay spreads over several days and has blocks to lock.
    await api(
      `/api/terms/${s.termId}/availability-rules`,
      "PUT",
      { rules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "21:00", endTime: "21:50" })) },
      token,
    );
    await addWork(token, s.courses.eng, "Long essay", "paper", at(dateFrom(day, 6), "23:59"), 200);
    const now = at(day, "21:05");
    const made = await api(`/api/terms/${s.termId}/plans/generate`, "POST", { now, horizonStart: day }, token);
    const ordered = [...made.sessions].sort((a, b) => a.startAt.localeCompare(b.startAt));
    const started = ordered[0];
    const locked = ordered[ordered.length - 1];
    await api(`/api/work-sessions/${started.id}/start`, "POST", {}, token);
    await api(`/api/work-sessions/${locked.id}/lock`, "POST", { locked: true }, token);

    const tomorrow = at(dateFrom(day, 1), "09:00");
    const { context, errors } = await openApp(browser, token, tomorrow);
    const plan = await currentPlan(token, s.termId, tomorrow);
    check(
      "the next morning: the app replanned",
      plan.planVersion.createdAt.slice(0, 10) === tomorrow.slice(0, 10),
      `plan made ${plan.planVersion.createdAt}`,
    );
    check(
      "the next morning: a block started and never stopped is still underway on Today",
      plan.recommendations.some((r) => r.sessionId === started.id && r.status === "started"),
    );
    check(
      "the next morning: a locked block is still on the calendar, where it was put",
      plan.sessions.some((x) => x.id === locked.id && x.locked && x.startAt === locked.startAt),
    );
    const clashes = plan.sessions.filter(
      (x) => x.id !== locked.id && x.startAt < locked.endAt && x.endAt > locked.startAt && x.status === "planned",
    );
    check("the next morning: nothing is booked over the locked block", clashes.length === 0);
    check("committed blocks: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  });

  // 8. "Not fitted into this week", as the student who reported this saw it. A term of weekly
  //    assignments listed thirty-two of forty there on an ordinary Monday, headed "these items
  //    need a decision", with no way anywhere to make one. Work that is simply not due yet does
  //    not belong on that list; work that really did not fit must come with the decisions.
  await journey(async () => {
    const token = await signUp("term");
    const day = TODAY;
    const now = at(day, "08:00");
    const s = await ordinaryStudent(token, { termStart: dateFrom(day, -21), termEnd: dateFrom(day, 80) });
    for (const [key, id] of Object.entries(s.courses)) {
      for (let week = 0; week < 9; week += 1) {
        await addWork(token, id, `${key} weekly ${week + 1}`, "problem_set", at(dateFrom(day, 2 + week * 7), "23:59"), 60);
      }
    }
    await api(`/api/terms/${s.termId}/plans/generate`, "POST", { now, horizonStart: day }, token);
    const plan = await currentPlan(token, s.termId, now);
    check(
      "a term of weekly work: nothing is listed as not fitted when the week has room",
      plan.unscheduledWorkItemIds.length === 0,
      `${plan.unscheduledWorkItemIds.length} listed, ${plan.capacity.usedMinutes}/${plan.capacity.availableMinutes} min used`,
    );
  });

  await journey(async () => {
    const token = await signUp("decide");
    const day = TODAY;
    const now = at(day, "15:00");
    const s = await ordinaryStudent(token, { termStart: dateFrom(day, -21), termEnd: dateFrom(day, 80) });
    let n = 0;
    for (const course of Object.values(s.courses)) {
      for (const offset of [1, 2, 3]) {
        n += 1;
        await addWork(token, course, `Crunch item ${n}`, "assignment", at(dateFrom(day, offset), "23:59"), 150);
      }
    }
    await api(`/api/terms/${s.termId}/plans/generate`, "POST", { now, horizonStart: day }, token);

    const { page, context, errors } = await openApp(browser, token, now);
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: "Week plan" }).click();
    await page.waitForTimeout(800);
    const rows = page.getByTestId("unfitted-item");
    await rows.first().waitFor({ timeout: 15_000 }).catch(() => {});
    const count = await rows.count();
    check(
      "not fitted: every listed item offers a decision",
      count > 0 &&
        (await rows.getByRole("button", { name: "Put it first" }).count()) === count &&
        (await rows.getByRole("button", { name: "Change it" }).count()) === count,
      `${count} listed`,
    );

    // Put the first one first: it should come out of the list with time booked.
    const title = (await rows.first().locator("span").first().innerText()).split("\n")[0].trim();
    await rows.first().getByRole("button", { name: "Put it first" }).click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    const after = await currentPlan(token, s.termId, now);
    const item = after.workItems.find((w) => w.title === title);
    const booked = after.sessions
      .filter((x) => x.workItemId === item?.id && x.status === "planned")
      .reduce((m, x) => m + Math.round((Date.parse(x.endAt) - Date.parse(x.startAt)) / 60_000), 0);
    check(
      `not fitted: "Put it first" gets "${title}" its time`,
      Boolean(item) && booked >= 150 && !after.unscheduledWorkItemIds.includes(item.id),
      `${booked} min booked`,
    );

    // "Change it" lands on the item's row in the assignments table.
    const second = page.getByTestId("unfitted-item").first();
    const secondTitle = (await second.locator("span").first().innerText()).split("\n")[0].trim();
    const secondItem = after.workItems.find((w) => w.title === secondTitle);
    await second.getByRole("button", { name: "Change it" }).click();
    await page.waitForTimeout(1500);
    check(
      "not fitted: \"Change it\" opens the item where its date, size and status can be changed",
      Boolean(secondItem) && (await page.locator(`#work-item-${secondItem.id}`).count()) === 1,
      secondTitle,
    );
    check("not fitted: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  });

  // 5. More work than hours. Not everything can fit; the app must say which, not drop them.
  await journey(async () => {
    const token = await signUp("crunch");
    const day = TODAY;
    const now = at(day, "15:00");
    const s = await ordinaryStudent(token, { termStart: dateFrom(day, -21), termEnd: dateFrom(day, 80) });
    let n = 0;
    for (const course of Object.values(s.courses)) {
      for (const offset of [1, 2, 3]) {
        n += 1;
        await addWork(token, course, `Crunch item ${n}`, "assignment", at(dateFrom(day, offset), "23:59"), 150);
      }
    }
    await api(`/api/terms/${s.termId}/plans/generate`, "POST", { now, horizonStart: day }, token);
    report("an oversubscribed week", auditCoverage(await currentPlan(token, s.termId, now), now));
  });
} catch (error) {
  check("the journeys ran to the end", false, String(error?.stack ?? error).slice(0, 800));
} finally {
  await browser?.close().catch(() => {});
  if (!ATTACH) stopServers();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length} of ${results.length} scheduling checks passed.`);
if (failed.length > 0) {
  if (serverLog.length > 0) console.log("\n--- last server output ---\n" + serverLog.slice(-60).join("\n"));
  process.exitCode = 1;
}
