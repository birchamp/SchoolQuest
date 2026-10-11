/**
 * The settings a student changes after setup, each one changed on Setup and followed into the
 * plan.
 *
 *   node tools/e2e/settings.mjs            starts both servers itself, then stops them
 *   node tools/e2e/settings.mjs --attach   uses servers already running on 5173 / 8787
 *
 * A setting that saves but does not reach the plan is the worst kind of broken: the card says
 * "Saved", the student believes it, and next Tuesday is booked exactly as before. So every step
 * here asserts three things, not one -- the server stored what was typed, the plan was rebuilt,
 * and the rebuilt plan honours the change:
 *
 *   AI and model    a key is saved, shown only as a hint, and removed; another reader is picked
 *   Study hours     a later start and a day off: nothing is booked before it or on it, and the
 *                   card shows the new hours after a reload
 *   Meals           dropping dinner gives the week its time back; putting it back takes it away
 *   Term            a rename and an earlier last day: stored, replanned, and the new name is
 *                   what the radar calls the term. (Work due after the last day of instruction
 *                   is still booked, on purpose -- finals come after it -- so "nothing after
 *                   the end" would be the wrong thing to assert.)
 *
 * The student's term and work go in through the API, as in the scheduling journey; every change
 * goes through the card a student would use.
 */
import { TODAY, api, at, check, dateFrom, journey, openApp, runJourney, signUp } from "./harness.mjs";

/** Planned from eight this morning, so the whole afternoon of today is still bookable. */
const NOW = at(TODAY, "08:00");
const TOMORROW = dateFrom(TODAY, 1);
const TOMORROW_WEEKDAY = new Date(`${TOMORROW}T12:00:00Z`).getUTCDay();
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KEY = "sk-or-v1-settings-journey-0000-abcd";

async function currentPlan(token, termId) {
  return api(`/api/terms/${termId}/plans/current?now=${encodeURIComponent(NOW)}`, "GET", undefined, token);
}

const planned = (plan) => plan.sessions.filter((s) => s.status === "planned");

/**
 * Every afternoon and evening free, and more work over the next ten days than fits in them --
 * so the plan is full, and any hour a setting gives or takes shows up in what gets booked.
 */
async function busyStudent(token) {
  const { term } = await api(
    "/api/terms",
    "POST",
    { name: "Spring", startDate: dateFrom(TODAY, -14), endDate: dateFrom(TODAY, 60) },
    token,
  );
  await api(
    `/api/terms/${term.id}/availability-rules`,
    "PUT",
    { rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "15:00", endTime: "21:00" })) },
    token,
  );
  const { course } = await api(`/api/terms/${term.id}/courses`, "POST", { name: "Chemistry 110" }, token);
  for (let day = 1; day <= 10; day += 1) {
    await api(
      "/api/work-items",
      "POST",
      {
        courseId: course.id,
        title: `Problem set ${day}`,
        workType: "problem_set",
        dueAt: at(dateFrom(TODAY, day + 1), "23:59"),
        estimatedMinutes: 240,
      },
      token,
    );
  }
  await api(`/api/terms/${term.id}/plans/generate`, "POST", { now: NOW, horizonStart: TODAY }, token);
  return term.id;
}

/** Waits for a save to settle: the card's own request, then the replan it triggers. */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
}

await runJourney("settings checks", async ({ browser }) => {
  const { token } = await signUp("settings");
  const termId = await busyStudent(token);
  const { page, context, go, errors } = await openApp(browser, token, { now: NOW });
  await go("Setup");

  // 1. AI and model. No replan here -- this one is about the key never coming back out.
  await journey(async () => {
    const card = page.locator("#provider-settings");
    await card.getByLabel("OpenRouter API key").fill(KEY);
    await card.getByRole("button", { name: "Save key" }).click();
    // Not "Key saved": the card says that before it has re-read the account, and on a cold
    // start the re-read (which fetches the model catalogue) is slow enough to land between the
    // two. The hint is what says the key is really there.
    await card.getByText(/^Stored:/).waitFor({ timeout: 30_000 }).catch(() => {});
    const shown = await card.innerText();
    check(
      "AI and model: a saved key is shown only as a hint, never in full",
      shown.includes("sk-or-v1…abcd") && !shown.includes(KEY),
      shown.match(/Stored: .*/)?.[0] ?? "",
    );
    check(
      "AI and model: the field is cleared once the key is saved",
      (await card.getByLabel("OpenRouter API key").inputValue()) === "",
    );

    await card.getByRole("button", { name: "Remove" }).click();
    await card.getByText("Key removed.").waitFor({ timeout: 15_000 }).catch(() => {});
    const me = await api("/api/me", "GET", undefined, token);
    check(
      "AI and model: removing the key removes it from the account",
      me.user.openrouterKeyHint === null && (await card.getByText("Key removed.").count()) === 1,
    );

    await card.getByRole("button", { name: "Change model" }).click();
    const radios = card.locator('input[name="extraction-model"]');
    await radios.first().waitFor({ timeout: 15_000 }).catch(() => {});
    const options = await radios.count();
    let pick = 0;
    while (pick < options && (await radios.nth(pick).isChecked())) pick += 1;
    const label = (await radios.nth(pick).locator("xpath=..").locator(".model-name").innerText().catch(() => "")).trim();
    // The radio is styled away; the row's label is what a student actually clicks.
    await radios.nth(pick).locator("xpath=..").click();
    const said = card.getByText(/^Syllabi will be read by .* from now on\.$/);
    await said.waitFor({ timeout: 15_000 }).catch(() => {});
    const after = await api("/api/me", "GET", undefined, token);
    const chosen = after.models.find((m) => m.id === after.user.extractionModel);
    check(
      "AI and model: picking another reader stores it on the account",
      // The row reads "Grok 4.3 · xAI": the model's label, then its provider.
      options > 1 && (await said.count()) === 1 && Boolean(chosen) && label.startsWith(chosen.label),
      `${label} of ${options}; stored ${after.user.extractionModel}`,
    );
  });

  // 2. Study hours: start at five instead of three, and keep tomorrow free.
  await journey(async () => {
    const before = await currentPlan(token, termId);
    const card = page.locator("#study-hours");
    await card.getByLabel("From").first().fill("17:00");
    await card.getByRole("group", { name: "Days" }).first().getByRole("button", { name: DAY_LABELS[TOMORROW_WEEKDAY] }).click();
    await card.getByRole("button", { name: "Save study hours" }).click();
    await card.getByText(/^Saved\. Your week has been replanned/).waitFor({ timeout: 15_000 }).catch(() => {});
    await settle(page);

    const { availabilityRules } = await api(`/api/terms/${termId}/snapshot`, "GET", undefined, token);
    check(
      "study hours: the new hours are stored as typed",
      availabilityRules.length === 6 &&
        availabilityRules.every((r) => r.startTime === "17:00" && r.endTime === "21:00" && r.dayOfWeek !== TOMORROW_WEEKDAY),
      availabilityRules.map((r) => `${DAY_LABELS[r.dayOfWeek]} ${r.startTime}-${r.endTime}`).join(", "),
    );
    const plan = await currentPlan(token, termId);
    check("study hours: saving replans the week", plan.planVersion.id !== before.planVersion.id);
    const early = planned(plan).filter((s) => s.startAt.slice(11, 16) < "17:00");
    check(
      "study hours: nothing is booked before the new start",
      early.length === 0,
      early.map((s) => s.startAt.slice(0, 16)).join(", "),
    );
    const onDayOff = planned(plan).filter((s) => s.startAt.slice(0, 10) === TOMORROW);
    check(`study hours: nothing is booked on the day taken off (${DAY_LABELS[TOMORROW_WEEKDAY]})`, onDayOff.length === 0);
    check(
      "study hours: the week's capacity shrinks with the hours",
      plan.capacity.availableMinutes < before.capacity.availableMinutes,
      `${before.capacity.availableMinutes} -> ${plan.capacity.availableMinutes} min`,
    );

    await page.reload();
    await go("Setup");
    await page.locator("#study-hours").getByLabel("From").first().waitFor({ timeout: 15_000 }).catch(() => {});
    check(
      "study hours: the card shows the new hours after a reload",
      (await page.locator("#study-hours").getByLabel("From").first().inputValue()) === "17:00",
    );
  });

  // 3. Meals: dinner gives its time back when dropped, and takes it again when restored.
  await journey(async () => {
    const before = await currentPlan(token, termId);
    const card = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Meals", exact: true }) });
    await card.getByRole("button", { name: "I don't stop for dinner" }).click();
    await card.getByText(/^Saved\. Your week has been redrawn/).waitFor({ timeout: 15_000 }).catch(() => {});
    await settle(page);
    const terms = (await api("/api/terms", "GET", undefined, token)).terms;
    const meals = terms.find((t) => t.id === termId)?.planningPreferences?.mealWindows ?? [];
    check(
      "meals: dropping dinner is stored",
      meals.length > 0 && !meals.some((m) => m.key === "dinner"),
      meals.map((m) => m.key).join(", "),
    );
    const without = await currentPlan(token, termId);
    check(
      "meals: without dinner the week has more time to book",
      without.planVersion.id !== before.planVersion.id &&
        without.capacity.availableMinutes > before.capacity.availableMinutes,
      `${before.capacity.availableMinutes} -> ${without.capacity.availableMinutes} min`,
    );

    await card.getByRole("button", { name: /^Put back dinner$/ }).click();
    await settle(page);
    const restored = await currentPlan(token, termId);
    check(
      "meals: putting dinner back takes that time away again",
      restored.capacity.availableMinutes === before.capacity.availableMinutes,
      `${without.capacity.availableMinutes} -> ${restored.capacity.availableMinutes} min (was ${before.capacity.availableMinutes})`,
    );
  });

  // 4. Term: a new name, and a last day four days out.
  await journey(async () => {
    const before = await currentPlan(token, termId);
    const lastDay = dateFrom(TODAY, 4);
    const card = page.locator('section[aria-labelledby="term-settings-heading"]');
    await card.getByLabel("Name").fill("Spring, short");
    await card.getByLabel("Last day").fill(lastDay);
    await card.getByRole("button", { name: "Save" }).click();
    await card.getByText("Saved.").waitFor({ timeout: 15_000 }).catch(() => {});
    await settle(page);
    const term = (await api("/api/terms", "GET", undefined, token)).terms.find((t) => t.id === termId);
    check(
      "term: the new name and last day are stored",
      term?.name === "Spring, short" && term?.endDate.slice(0, 10) === lastDay,
      `${term?.name}, ends ${term?.endDate}`,
    );
    const plan = await currentPlan(token, termId);
    check("term: changing the dates replans the week", plan.planVersion.id !== before.planVersion.id);
    await go("Radar");
    await page.getByText("Spring, short").first().waitFor({ timeout: 15_000 }).catch(() => {});
    check("term: the radar calls the term by its new name", (await page.getByText("Spring, short").count()) > 0);
  });

  check("no page errors were thrown anywhere on the journey", errors.length === 0, errors.join(" | "));
  await context.close();
});
