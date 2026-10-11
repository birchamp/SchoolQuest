/**
 * Living through the weeks: the plan learning from what keeps happening, and the term ending.
 *
 *   node tools/e2e/weeks.mjs            starts both servers itself, then stops them
 *   node tools/e2e/weeks.mjs --attach   uses servers already running on 5173 / 8787
 *
 * Every other journey looks at one moment, or a day either side of it. The failure the weekly
 * review exists for only shows up across weeks: a student with a standing Thursday shift nobody
 * wrote down gets Thursday evening booked every week, and loses it every week, and every
 * repetition reads to them as something they did. So this lives three weeks on the simulated
 * clock, opening the app the way a student does -- Monday evening to work, Thursday evening to
 * be told to work -- and asserts what each opening shows:
 *
 *   week 1   Monday's block is done from Today. Thursday's is let go with "Not now", naming
 *            the shift that took it.
 *   week 2   The review asks about that Thursday once, as possibly a one-off, and is left
 *            unanswered. Thursday goes the same way.
 *   week 3   The review now proposes the shift as a standing commitment, in the student's own
 *            words. One click adds it, and the plan stops booking that evening -- saying so
 *            where the work no longer fits, rather than dropping it.
 *
 * Then the term ends: "Start a new semester" archives it, and the way back -- reopening it from
 * onboarding -- returns every piece of work.
 *
 * Setup goes through the API, as in the scheduling journey; everything that happens *in* a week
 * goes through the screen.
 */
import { TODAY, api, at, check, dateFrom, journey, openApp, runJourney, signUp } from "./harness.mjs";

/** The Monday after today, so week one starts clean whatever day the run is on. */
const MONDAY = (() => {
  const weekday = new Date(`${TODAY}T12:00:00Z`).getUTCDay();
  return dateFrom(TODAY, ((8 - weekday) % 7) || 7);
})();
const monday = (week) => dateFrom(MONDAY, 7 * week);
const thursday = (week) => dateFrom(MONDAY, 7 * week + 3);

const SHIFT = "Shift at the cafe";
/**
 * One block a night, after dinner: the default dinner window floats as late as 20:00, and a
 * block is 45 minutes by default. So each evening holds exactly one piece of work.
 */
const EVENING = { start: "20:00", end: "21:00" };
const MINUTES = 45;

async function currentPlan(token, termId, now) {
  return api(`/api/terms/${termId}/plans/current?now=${encodeURIComponent(now)}`, "GET", undefined, token);
}

/**
 * Two evenings a week, Monday and Thursday, and two pieces of work a week that fill them
 * exactly: a reading due Wednesday morning, which only Monday can hold, and a problem set due
 * Saturday morning, which -- with Monday taken -- only Thursday can. (Each due date leaves the
 * planner's default one-day buffer clear.) So the Thursday block is the
 * problem set's, every week, and losing it is a loss the plan has to answer for.
 */
async function twoEveningStudent(token) {
  const { term } = await api(
    "/api/terms",
    "POST",
    { name: "Spring", startDate: dateFrom(MONDAY, -7), endDate: dateFrom(MONDAY, 70) },
    token,
  );
  await api(
    `/api/terms/${term.id}/availability-rules`,
    "PUT",
    { rules: [1, 4].map((dayOfWeek) => ({ dayOfWeek, startTime: EVENING.start, endTime: EVENING.end })) },
    token,
  );
  const { course } = await api(`/api/terms/${term.id}/courses`, "POST", { name: "Statistics 200" }, token);
  for (let week = 0; week < 4; week += 1) {
    for (const [title, due] of [
      [`Reading ${week + 1}`, at(dateFrom(monday(week), 2), "09:00")],
      [`Problem set ${week + 1}`, at(dateFrom(monday(week), 5), "09:00")],
    ]) {
      await api(
        "/api/work-items",
        "POST",
        { courseId: course.id, title, workType: "assignment", dueAt: due, estimatedMinutes: MINUTES },
        token,
      );
    }
  }
  return { termId: term.id, courseId: course.id };
}

/** Hands in everything due before `now`, as a student who did the work off the plan would. */
async function handInPast(token, termId, now) {
  for (const w of (await api(`/api/terms/${termId}/snapshot`, "GET", undefined, token)).workItems) {
    if (w.dueAt < now && w.status !== "completed") {
      await api(`/api/work-items/${w.id}`, "PATCH", { status: "submitted" }, token);
    }
  }
}

/** Monday evening: Today says to do the reading, and the student does it. */
async function doMondayBlock(browser, token, week) {
  const now = at(monday(week), EVENING.start);
  const { page, context, errors } = await openApp(browser, token, { now, landOn: "Today" });
  const primary = page.locator(".primary-action");
  await primary.waitFor({ timeout: 15_000 }).catch(() => {});
  const title = (await primary.locator(".title").first().innerText().catch(() => "")).trim();
  check(`week ${week + 1}, Monday: Today puts this week's reading first`, title === `Reading ${week + 1}`, title);
  await primary.getByRole("button", { name: /start session|begin/i }).click();
  await page.getByTestId("session-underway").waitFor({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: /Stop, it's done/ }).click();
  await page.getByTestId("session-underway").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  check(
    `week ${week + 1}, Monday: the reading is done from Today`,
    (await page.getByText(/Marked done|Quest complete/).count()) === 1,
  );
  await context.close();
  return errors;
}

/** Thursday evening: Today says to do the problem set, and the shift has the time. */
async function loseThursdayBlock(browser, token, termId, week) {
  // Opened right on time. A new day replans from "now" on first load, so opened at 20:05 the
  // block would have moved to 20:05 -- correct, but then the evening is not 20:00 any more.
  const now = at(thursday(week), EVENING.start);
  const { page, context, errors } = await openApp(browser, token, { now, landOn: "Today" });
  const plan = await currentPlan(token, termId, now);
  const problemSet = plan.workItems.find((w) => w.title === `Problem set ${week + 1}`);
  const block = plan.sessions.find(
    (s) => s.startAt.slice(0, 10) === thursday(week) && s.status === "planned" && s.workItemId === problemSet?.id,
  );
  check(
    `week ${week + 1}, Thursday: the evening is booked for the problem set`,
    Boolean(block),
    plan.sessions.map((s) => `${s.startAt.slice(5, 16)} ${s.status}`).join(", "),
  );

  const primary = page.locator(".primary-action");
  await primary.waitFor({ timeout: 15_000 }).catch(() => {});
  await primary.getByRole("button", { name: /^not now$/i }).first().click();
  await page.getByPlaceholder("Shift, practice, ride home…").fill(SHIFT);
  await page.getByLabel("What kind of thing was it?").selectOption("work");
  await page.getByRole("button", { name: "Save and move on" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);

  const after = await currentPlan(token, termId, now);
  const gone = after.sessions.find((s) => s.id === block?.id);
  check(
    `week ${week + 1}, Thursday: "Not now" with a reason lets the block go`,
    Boolean(block) && (!gone || gone.status !== "planned"),
    gone ? `status ${gone.status}` : "removed from the plan",
  );
  await context.close();
  return errors;
}

/** The weekly review card on Week plan, as the student opening it on `now` sees it. */
async function openReview(browser, token, now) {
  const opened = await openApp(browser, token, { now, landOn: "Week plan" });
  const card = opened.page.locator('section[aria-labelledby="weekly-review-heading"]');
  await card.waitFor({ timeout: 15_000 }).catch(() => {});
  return { ...opened, card };
}

// --- The journey ----------------------------------------------------------------------------

await runJourney("multi-week checks", async ({ browser }) => {
  const { token } = await signUp("weeks");
  const s = await twoEveningStudent(token);
  const errors = [];

  // Week 1: one done, one lost.
  errors.push(...(await doMondayBlock(browser, token, 0)));
  errors.push(...(await loseThursdayBlock(browser, token, s.termId, 0)));
  await handInPast(token, s.termId, at(monday(1), "00:00"));

  // Week 2: the review asks, gently, about the one Thursday. Nobody answers, and it happens again.
  await journey(async () => {
    const now = at(monday(1), "17:00");
    const { card, context, errors: seen } = await openReview(browser, token, now);
    const text = await card.innerText().catch(() => "");
    check(
      "week 2: the review asks about the lost Thursday evening, as possibly a one-off",
      /Thursday/.test(text) && /did not get used/.test(text) && /one-off/.test(text),
      text.split("\n").slice(1, 4).join(" | "),
    );
    check("week 2: it remembers what the student said took the time", text.includes(SHIFT));
    errors.push(...seen);
    await context.close();
  });
  errors.push(...(await doMondayBlock(browser, token, 1)));
  errors.push(...(await loseThursdayBlock(browser, token, s.termId, 1)));
  await handInPast(token, s.termId, at(monday(2), "00:00"));

  // Week 3: twice is a pattern. The review proposes the shift; one click puts it in the week.
  await journey(async () => {
    const now = at(monday(2), "17:00");
    const { page, card, context, errors: seen } = await openReview(browser, token, now);
    const text = await card.innerText().catch(() => "");
    check(
      "week 3: the review says the same evening has been lost two weeks running",
      /Thursday/.test(text) && /2 different weeks/.test(text) && /every week/.test(text),
      text.split("\n").slice(1, 4).join(" | "),
    );
    check("week 3: the review never counts misses at the student", !/missed|you keep|streak/i.test(text));

    await card.getByRole("button", { name: /Yes — put it in my week/ }).click();
    await card.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    check("week 3: an answered review goes away", (await card.count()) === 0);

    const { commitments } = await api(`/api/terms/${s.termId}/snapshot`, "GET", undefined, token);
    const shift = commitments.find((c) => c.title === SHIFT);
    check(
      "week 3: the shift is now a standing Thursday commitment, in the student's words",
      Boolean(shift) && shift.daysOfWeek.length === 1 && shift.daysOfWeek[0] === 4 && shift.startTime === EVENING.start &&
        shift.endTime <= EVENING.end,
      shift ? `${shift.title}, days ${shift.daysOfWeek}, ${shift.startTime}-${shift.endTime}` : "no such commitment",
    );

    const plan = await currentPlan(token, s.termId, now);
    const thursdayBlocks = plan.sessions.filter(
      (x) => x.status === "planned" && x.startAt.slice(0, 10) === thursday(2),
    );
    check(
      "week 3: the plan no longer books the Thursday evening",
      thursdayBlocks.length === 0,
      thursdayBlocks.map((x) => `${plan.workItems.find((w) => w.id === x.workItemId)?.title} ${x.startAt.slice(11, 16)}`).join(", "),
    );
    const problemSet = plan.workItems.find((w) => w.title === "Problem set 3");
    const booked = plan.sessions
      .filter((x) => x.workItemId === problemSet?.id && x.status === "planned")
      .reduce((m, x) => m + (Date.parse(x.endAt) - Date.parse(x.startAt)) / 60_000, 0);
    const warned = (plan.risks ?? []).some((r) => r.workItemId === problemSet?.id);
    check(
      "week 3: the problem set that lost its evening has time elsewhere, or a warning that it does not",
      booked >= MINUTES || warned,
      `${booked} min booked${warned ? ", warned" : ""}`,
    );
    errors.push(...seen);
    await context.close();
  });

  // The term ends. Archiving keeps everything; reopening from onboarding brings it all back.
  await journey(async () => {
    const before = (await api(`/api/terms/${s.termId}/snapshot`, "GET", undefined, token)).workItems.length;
    const now = at(dateFrom(MONDAY, 70), "10:00");
    const { page, nav, go, context, errors: seen } = await openApp(browser, token, { now });
    await go("Setup");
    await page.getByRole("button", { name: "Start a new semester" }).click();
    await page.getByRole("button", { name: /^Archive .* and start fresh$/ }).click();
    const themes = page.getByRole("group", { name: "Choose a theme" });
    await themes.waitFor({ timeout: 15_000 }).catch(() => {});
    check("term end: starting a new semester archives this one and opens onboarding", (await themes.count()) === 1);
    const { terms } = await api("/api/terms", "GET", undefined, token);
    check(
      "term end: the old term is archived, not deleted",
      terms.some((t) => t.id === s.termId && t.status === "archived"),
    );

    await themes.getByRole("button", { name: /plain/i }).click();
    const archived = page.locator('section[aria-labelledby="archived-terms-heading"]');
    await archived.waitFor({ timeout: 15_000 }).catch(() => {});
    check("term end: onboarding offers the archived semester back", /Spring/.test(await archived.innerText().catch(() => "")));
    await archived.getByRole("button", { name: "Reopen" }).click();
    await nav.waitFor({ timeout: 30_000 }).catch(() => {});
    const after = (await api(`/api/terms/${s.termId}/snapshot`, "GET", undefined, token)).workItems.length;
    const reopened = (await api("/api/terms", "GET", undefined, token)).terms.find((t) => t.id === s.termId);
    check(
      "term end: reopening brings the semester back with every piece of work",
      (await nav.count()) === 1 && reopened?.status === "active" && after === before,
      `${after} of ${before} items, status ${reopened?.status}`,
    );
    errors.push(...seen);
    await context.close();
  });

  check("no page errors were thrown in any week", errors.length === 0, errors.join(" | "));
});
