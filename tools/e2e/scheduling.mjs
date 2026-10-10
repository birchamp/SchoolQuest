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
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";
import { startServers, stopServers, waitForServers, ATTACH } from "./servers.mjs";

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
    await addWork(token, c.bio, "Lab report 3", "assignment", at(dateFrom(monday, 2), "23:59"), 90);
    await addWork(token, c.bio, "Chapter 7 reading", "reading", at(dateFrom(monday, 1), "09:00"), 45);
    await addWork(token, c.eng, "Essay 2 draft", "paper", at(dateFrom(monday, 5), "23:59"), 180);
    await addWork(token, c.eng, "Peer review", "assignment", at(dateFrom(monday, 3), "11:00"), 40);
    await addWork(token, c.his, "Primary source response", "assignment", at(dateFrom(monday, 4), "23:59"), 60);
    await addWork(token, c.his, "Quiz 4", "quiz", at(dateFrom(monday, 6), "13:00"), null);
    // Small things are real work too: shorter than the shortest session the planner likes.
    await addWork(token, c.his, "Discussion post", "discussion", at(dateFrom(monday, 2), "23:59"), 15);
    await addWork(token, c.mat, "Homework 6", "problem_set", at(dateFrom(monday, 1), "23:59"), 75);
    await addWork(token, c.mat, "Homework 7", "problem_set", at(dateFrom(monday, 4), "23:59"), 75);
    await addWork(token, c.mat, "Unit 2 exam prep", "exam_prep", at(dateFrom(monday, 6), "15:00"), 150);
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

  // 4. The real clock, for a student who does not live at UTC+0. No simulated time at all: the
  //    browser is in Honolulu (UTC-10, no daylight saving, so the offset is the same all year),
  //    and the student is free every hour of every day. The first block should be about now --
  //    their now -- not ten hours later when it is "now" in Greenwich.
  await journey(async () => {
    const token = await signUp("zone");
    const s = await ordinaryStudent(token, { termStart: dateFrom(TODAY, -21), termEnd: dateFrom(TODAY, 80) });
    await api(
      `/api/terms/${s.termId}/availability-rules`,
      "PUT",
      { rules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "00:00", endTime: "23:59" })) },
      token,
    );
    // No classes or shift in the way of the measurement.
    for (const id of Object.values(s.courses)) {
      await api(`/api/courses/${id}/meeting-patterns`, "PUT", { patterns: [] }, token);
    }
    const snapshot = await api(`/api/terms/${s.termId}/snapshot`, "GET", undefined, token);
    for (const commitment of snapshot.commitments) await api(`/api/commitments/${commitment.id}`, "DELETE", undefined, token);

    const wall = new Date(Date.now() - 10 * 3_600_000);
    const wallDate = wall.toISOString().slice(0, 10);
    await addWork(token, s.courses.bio, "Lab report", "assignment", at(dateFrom(wallDate, 2), "23:59"), 60);

    const { context, errors } = await openApp(browser, token, null, { timezoneId: "Pacific/Honolulu" });
    const me = (await api("/api/me", "GET", undefined, token)).user;
    check("time zone: the app tells the server where the student is", me.timezone === "Pacific/Honolulu", `stored ${me.timezone}`);

    await api(`/api/terms/${s.termId}/plans/generate`, "POST", {}, token);
    const plan = await currentPlan(token, s.termId, null);
    const wallNow = Date.now() - 10 * 3_600_000;
    const first = plan.sessions
      .filter((x) => x.status === "planned")
      .map((x) => Date.parse(x.startAt))
      .sort((a, b) => a - b)[0];
    const lagMinutes = first === undefined ? null : Math.round((first - wallNow) / 60_000);
    // Meals can hold an hour or so; ten hours is the bug.
    check(
      "time zone: the first block starts around the student's own now",
      lagMinutes !== null && lagMinutes >= -5 && lagMinutes <= 150,
      `first block ${first ? new Date(first).toISOString().slice(0, 16) : "none"}, ` +
        `student's wall clock ${new Date(wallNow).toISOString().slice(0, 16)} (${lagMinutes} min later)`,
    );
    report("time zone", auditCoverage(plan, new Date(wallNow).toISOString()));
    check("time zone: no page errors", errors.length === 0, errors.join(" | "));
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
