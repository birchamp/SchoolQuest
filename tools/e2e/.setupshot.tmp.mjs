// Focused screenshot of just the Setup tab, for the CourseManager/SyllabusUpload pass.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "/tmp/shots";
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

const login = await api("/api/auth/login", "POST", { email: "semester-test@example.edu" });
const { sessionToken } = await api("/api/auth/callback", "POST", {
  token: new URL(login.devLoginUrl).searchParams.get("token"),
});
await api("/api/me", "PATCH", { theme: THEME }, sessionToken);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(APP);
await page.evaluate((t) => localStorage.setItem("sq_session_token", t), sessionToken);
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);

await page.locator("nav.tabs button", { hasText: /setup/i }).first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/${THEME}-setup.png`, fullPage: true });
console.log(`shot ${THEME}-setup.png`);

// Open both add-forms so their fields are visible too.
const addCourse = page.locator("button", { hasText: /add a (course|questline)/i }).first();
if ((await addCourse.count()) > 0) await addCourse.click();
const addCommit = page.locator("button", { hasText: /add a (commitment|anchor|obligation|fixed)/i }).first();
if ((await addCommit.count()) > 0) await addCommit.click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/${THEME}-setup-forms.png`, fullPage: true });
console.log(`shot ${THEME}-setup-forms.png`);

await browser.close();
