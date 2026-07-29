// Screenshots SchoolQuest for the visual critic: signs in via the dev magic-link flow,
// sets the requested theme, and captures each tab.
//   node shoot.mjs <outDir> <theme>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2];
const THEME = process.argv[3] ?? "quest";
const APP = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8787";
mkdirSync(OUT, { recursive: true });

async function api(path, method = "GET", body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// Sign in as the seeded semester account and set the theme under test.
const login = await api("/api/auth/login", "POST", { email: "semester-test@example.edu" });
const loginToken = new URL(login.devLoginUrl).searchParams.get("token");
const { sessionToken } = await api("/api/auth/callback", "POST", { token: loginToken });
await api("/api/me", "PATCH", { theme: THEME }, sessionToken);

// A term with nothing finished shows an empty progress track, which tells the critic
// nothing about how the progression layer actually looks. Finish a few sessions through
// the real endpoint — the same call the "Mark done" button makes — so the XP figures on
// screen are earned rather than staged. Re-running is safe: completing work that is
// already complete banks nothing new.
const { terms } = await api("/api/terms", "GET", undefined, sessionToken);
const termId = (terms.find((t) => t.status === "active") ?? terms[0])?.id;
const TARGET_COMPLETED = 4;
if (termId) {
  const plan = await api(`/api/terms/${termId}/plans/current`, "GET", undefined, sessionToken);
  const sessions = plan.sessions ?? [];
  const alreadyDone = sessions.filter((s) => s.status === "completed").length;
  // Top up to a fixed number rather than completing four more every run, so repeated
  // rounds of the critique loop are comparable instead of steadily draining the term.
  const toComplete = sessions
    .filter((s) => s.status === "planned")
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, Math.max(0, TARGET_COMPLETED - alreadyDone));
  for (const session of toComplete) {
    await api(`/api/work-sessions/${session.id}/complete`, "POST", { outcome: "completed" }, sessionToken);
  }
  console.log(`seeded progress: ${alreadyDone} already done, completed ${toComplete.length} more`);
}

// The container preinstalls Chromium; newer playwright versions look for a headless
// shell build that is not present, so point at the full browser explicitly.
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// The SPA reads the bearer token from localStorage.
await page.goto(APP);
await page.evaluate((t) => localStorage.setItem("sq_session_token", t), sessionToken);
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const tabs = [
  ["today", null],
  ["week", /week|map|board/i],
  ["coach", /coach|guide|handler/i],
  ["setup", /setup/i],
];

for (const [name, matcher] of tabs) {
  if (matcher) {
    const button = page.locator("nav.tabs button", { hasText: matcher }).first();
    if ((await button.count()) > 0) await button.click();
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: `${OUT}/${THEME}-${name}.png`, fullPage: true });
  console.log(`shot ${THEME}-${name}.png`);
}

// The completion moment only exists for as long as it is on screen, so it needs its own
// frame: go back to Today, finish the current recommendation through the UI, and shoot.
{
  const todayTab = page.locator("nav.tabs button").first();
  await todayTab.click();
  await page.waitForTimeout(700);
  const markDone = page.locator("button", { hasText: /^mark done$/i }).first();
  if ((await markDone.count()) > 0) {
    await markDone.click();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${OUT}/${THEME}-completion.png`, fullPage: true });
    console.log(`shot ${THEME}-completion.png`);
  } else {
    console.log("no session available to complete; skipped the completion moment");
  }
}

// Onboarding flow as a brand-new account, to capture the first-run experience.
// A new address every run: the walk-through below creates a term, so reusing one address
// would land the next run on the planner instead of on onboarding.
const fresh = await api("/api/auth/login", "POST", {
  email: `critic-${THEME}-${Date.now()}@example.edu`,
});
const freshToken = new URL(fresh.devLoginUrl).searchParams.get("token");
const { sessionToken: freshSession } = await api("/api/auth/callback", "POST", {
  token: freshToken,
});
await page.goto(APP);
await page.evaluate((t) => localStorage.setItem("sq_session_token", t), freshSession);
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/${THEME}-onboarding.png`, fullPage: true });
console.log(`shot ${THEME}-onboarding.png`);

// A fresh account lands on the theme cover, so the earlier rounds only ever judged that
// one screen. The steps behind it — naming the term and setting study windows — are where
// most of onboarding's chrome actually lives, so walk into them and shoot each.
{
  // Addressed by accessible name, not by leading text: each card opens with an
  // aria-hidden ornament, so an anchored text match silently never fired and every
  // "onboarding" shot was really the cover screen again.
  const themeCard = page.getByRole("button", { name: new RegExp(THEME, "i") }).first();
  if ((await themeCard.count()) > 0) {
    await themeCard.click();
    await page.waitForTimeout(900);
  }

  await page.screenshot({ path: `${OUT}/${THEME}-onboarding-term.png`, fullPage: true });
  console.log(`shot ${THEME}-onboarding-term.png`);

  // Fill the term step so the next screen — and any state that fills in as you type — is
  // reachable. Fields are addressed by accessible name, which is plain-language in every
  // theme by design.
  const text = page.locator("form input[type=text], form input:not([type])").first();
  if ((await text.count()) > 0) await text.fill("Fall 2026");
  const dates = page.locator("form input[type=date]");
  if ((await dates.count()) >= 2) {
    await dates.nth(0).fill("2026-08-26");
    await dates.nth(1).fill("2026-12-12");
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${THEME}-onboarding-term-filled.png`, fullPage: true });
  console.log(`shot ${THEME}-onboarding-term-filled.png`);

  const submit = page.locator("form button[type=submit]").first();
  if ((await submit.count()) > 0 && (await submit.isEnabled())) {
    await submit.click();
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${OUT}/${THEME}-onboarding-hours.png`, fullPage: true });
    console.log(`shot ${THEME}-onboarding-hours.png`);
  }
}

await browser.close();
console.log("done");
