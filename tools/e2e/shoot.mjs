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

// Onboarding flow as a brand-new account, to capture the first-run experience.
const fresh = await api("/api/auth/login", "POST", { email: `critic-${THEME}@example.edu` });
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

await browser.close();
console.log("done");
