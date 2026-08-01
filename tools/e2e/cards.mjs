// Screenshots individual cards rather than whole pages.
//
//   node tools/e2e/cards.mjs <outDir> [theme]
//
// `shoot.mjs` captures full pages, which is right for the visual critic — it judges
// composition — and wrong for looking at one surface, because the interesting card ends up
// three thousand pixels down a screenshot nobody can read.
//
// Cards are found by the heading they contain, never by a CSS id. Every heading in this app
// is themed, so a selector written against one theme's wording silently matches nothing in
// the others; a regex over the visible text matches all three. An id would seem safer and is
// not: `aria-labelledby` on the week map only exists while a course lens is active, which is
// exactly how the first version of this script "missed" a card that was on screen.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2];
const THEME = process.argv[3] ?? "plain";
const APP = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8787";
if (!OUT) {
  console.error("usage: node tools/e2e/cards.mjs <outDir> [theme]");
  process.exit(1);
}
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

const login = await api("/api/auth/login", "POST", {
  email: process.env.SQ_EMAIL ?? "semester-test@example.edu",
});
const { sessionToken } = await api("/api/auth/callback", "POST", {
  token: new URL(login.devLoginUrl).searchParams.get("token"),
});
await api("/api/me", "PATCH", { theme: THEME }, sessionToken);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
// Two device pixels per CSS pixel: these are read by eye, and hairline rules and 0.66rem
// labels are the first things to disappear at 1x.
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
await page.goto(APP);
await page.evaluate((t) => localStorage.setItem("sq_session_token", t), sessionToken);
await page.evaluate((v) => localStorage.setItem("sq_view_mode", v), process.env.SQ_VIEW ?? "visual");
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);

const nav = page.getByRole("navigation", { name: "Main" });
const tabs = await nav.getByRole("button").allTextContents();
const openTab = async (index) => {
  await nav.getByRole("button", { name: tabs[index] }).click();
  await page.waitForTimeout(1600);
};

async function shoot(headingPattern, name) {
  const card = page
    .locator("section.card")
    .filter({ has: page.locator("h2", { hasText: headingPattern }) })
    .first();
  if ((await card.count()) === 0) {
    console.log(`  (no card matching ${headingPattern})`);
    return;
  }
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await card.screenshot({ path: `${OUT}/${THEME}-${name}.png` });
  console.log(`  ${THEME}-${name}.png`);
}

// Week tab.
await openTab(1);
await shoot(/session brief|this week in brief|situation/i, "brief");
await shoot(/the table|your courses|theaters/i, "campaign-table");
await shoot(/region map|week plan|operations board/i, "week-map");
await shoot(/campaign arc|the long roads|what is coming|ahead/i, "arc");
await shoot(/how last week went|recap|after-action/i, "review");

const hours = page.getByRole("button", { name: "Hour by hour" });
if ((await hours.count()) > 0) {
  await hours.click();
  await page.waitForTimeout(1400);
  await shoot(/the hours|hour by hour/i, "calendar");
}

// Term tab.
await openTab(2);
await shoot(/war table|what needs you|status board/i, "dashboard");

// Setup.
await openTab(4);
await shoot(/study hours/i, "study-hours");
await shoot(/meals/i, "meals");
await shoot(/commitment|immovable/i, "commitments");

await browser.close();
