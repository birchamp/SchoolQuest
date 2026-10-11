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
import { API, TODAY, api, at, check, dateFrom, openApp, runJourney, signUp } from "./harness.mjs";

/**
 * The moment the journey plans from: nine in the morning, today. Pinned rather than read from
 * the wall clock, because the journey needs blocks *today* -- to start one, and to give the day
 * up -- and a run at 23:50 has no today left to book.
 */
const NOW = at(TODAY, "09:00");

/** ISO date `days` from today, in the app's wall clock. */
const dateFromToday = (days) => dateFrom(TODAY, days);

// --- The journey -------------------------------------------------------------------------

await runJourney("acceptance steps", async ({ browser }) => {
  // 1. Sign in. The dev link comes back on screen, which is what a local run relies on.
  const { token: sessionToken, email } = await signUp("acceptance");
  const me = await api("/api/me", "GET", undefined, sessionToken);
  check("a fresh account signs in through the on-screen dev link and answers /api/me", me.user.email === email);

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

  const { page, nav, go, errors: pageErrors } = await openApp(browser, sessionToken, { now: NOW });

  // 2. Create a course in Setup, and see it appear without a reload (issue #6).
  await go("Setup");
  await page.getByRole("button", { name: /add a course/i }).first().click();
  await page.getByLabel("Course name").first().fill("Biology 101");
  await page.getByLabel("Course name").first().press("Enter");
  await page.getByText("Biology 101").first().waitFor({ timeout: 15_000 }).catch(() => {});
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
  await page.getByText("Lab report 1").first().waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1000);
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
  await page.getByTestId("session-underway").waitFor({ timeout: 15_000 }).catch(() => {});
  check("Start session shows the block as underway", (await page.getByTestId("session-underway").count()) === 1);
  await page.reload();
  await nav.waitFor({ timeout: 30_000 });
  await go("Today");
  await page.getByTestId("session-underway").waitFor({ timeout: 15_000 }).catch(() => {});
  check("the started state survives a reload", (await page.getByTestId("session-underway").count()) === 1);
  await page.getByRole("button", { name: /Stop, it's done/ }).click();
  // The celebration lands before the plan refetch that retires the badge, so wait for the
  // badge to go rather than for the celebration to come.
  await page.getByTestId("session-underway").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
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
  await api(`/api/terms/${term.id}/plans/generate`, "POST", { now: NOW, horizonStart: TODAY }, sessionToken);

  // 6. Move a block from the hour calendar with the keyboard, and lock it. Back to the
  //    visual views first: the table mode set above has no hour calendar.
  await page.evaluate(() => localStorage.setItem("sq_view_mode", "visual"));
  await page.reload();
  await nav.waitFor({ timeout: 30_000 });
  await go("Week plan");
  await page.getByRole("button", { name: "Hour by hour" }).click();
  const band = page.locator("[data-session-id]").first();
  await band.waitFor({ timeout: 15_000 }).catch(() => {});
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
  const changes = page.getByTestId("plan-changes");
  await changes.waitFor({ timeout: 30_000 }).catch(() => {});
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

  // 9b. Record a Pass from the assignments table, for work marked Pass/Fail rather than scored.
  //     It counts as recorded but moves no percentage; a Fail raises a concern instead.
  const { workItem: labSafety } = await api(
    "/api/work-items",
    "POST",
    { courseId: course.id, title: "Lab safety quiz", workType: "quiz", dueAt: `${dateFromToday(-2)}T23:59:00.000Z`, pointsPossible: 5 },
    sessionToken,
  );
  // Made through the API, so reload to read it, in the table view the Pass button lives in.
  await page.evaluate(() => localStorage.setItem("sq_view_mode", "table"));
  await page.reload();
  await nav.waitFor({ timeout: 30_000 });
  await go("Assignments");
  const labRow = page.locator("tr", { hasText: "Lab safety quiz" });
  // Handed in first, as a student would; that is what brings up the result box.
  await labRow.getByRole("button", { name: /^Handed in$/ }).click({ timeout: 15_000 });
  await labRow.getByRole("button", { name: /^Pass$/ }).click({ timeout: 15_000 });
  // Wait for the save itself rather than for a fixed time a slow runner could overrun.
  let afterPass;
  let passGrade;
  for (let tries = 0; tries < 30 && !passGrade; tries += 1) {
    if (tries > 0) await new Promise((r) => setTimeout(r, 500));
    afterPass = await api(`/api/terms/${term.id}/plans/current`, "GET", undefined, sessionToken);
    passGrade = (afterPass.grades ?? []).find((g) => g.workItemId === labSafety.id);
  }
  check(
    "Pass in the assignments table records a Pass with no points",
    passGrade?.letterGrade === "Pass" && passGrade.pointsEarned === null && passGrade.pointsPossible === null,
    JSON.stringify(passGrade ?? null),
  );
  check(
    "a Pass leaves the course standing where the score put it",
    afterPass.standings[course.id]?.estimatedPercent === standing?.estimatedPercent,
    `estimated ${afterPass.standings[course.id]?.estimatedPercent}`,
  );
  const passFailInStanding = (afterPass.standings[course.id]?.categories ?? []).reduce((n, c) => n + (c.passFailCount ?? 0), 0);
  check("the course standing counts the Pass as a Pass/Fail result", passFailInStanding === 1, `passFailCount ${passFailInStanding}`);
  const empty = await fetch(`${API}/api/work-items/${labSafety.id}/grade`, {
    method: "PUT",
    headers: { "X-SchoolQuest-Client": "2", "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: "{}",
  });
  check("an empty grade body is refused rather than recorded", empty.status === 400, `status ${empty.status}`);
  await api(`/api/work-items/${labSafety.id}/grade`, "PUT", { passFail: "fail" }, sessionToken);
  const afterFail = await api(`/api/terms/${term.id}/plans/current`, "GET", undefined, sessionToken);
  const courseHealth = afterFail.health?.courses.find((h) => h.courseId === course.id);
  check(
    "a recorded Fail is raised as a concern on the course",
    (courseHealth?.concerns ?? []).some((x) => x.code === "PASS_FAIL_FAILED"),
    (courseHealth?.concerns ?? []).map((x) => x.code).join(", "),
  );
  // The gauge's "Look at the failed work" opens the assignments table, so the failed row must be
  // there without asking for finished work.
  await page.reload();
  await nav.waitFor({ timeout: 30_000 });
  await go("Assignments");
  await page.locator("tr", { hasText: "Lab safety quiz" }).first().waitFor({ timeout: 15_000 }).catch(() => {});
  check(
    "work recorded as a Fail stays on the assignments table",
    (await page.locator("tr", { hasText: "Lab safety quiz" }).count()) === 1,
  );

  // 10. Switch themes from Setup.
  await go("Setup");
  await page.getByRole("button", { name: /^quest$/i }).first().click();
  await page.waitForFunction(() => document.body.dataset.theme === "quest", null, { timeout: 15_000 }).catch(() => {});
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
});
