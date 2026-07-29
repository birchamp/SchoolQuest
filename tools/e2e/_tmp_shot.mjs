import { chromium } from "playwright";
const OUT = process.argv[2];
const APP = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8787";
async function api(path, method = "GET", body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.json();
}
const login = await api("/api/auth/login", "POST", { email: "semester-test@example.edu" });
const { sessionToken } = await api("/api/auth/callback", "POST", {
  token: new URL(login.devLoginUrl).searchParams.get("token"),
});
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const theme of ["quest", "plain"]) {
  await api("/api/me", "PATCH", { theme }, sessionToken);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(APP);
  await page.evaluate((t) => localStorage.setItem("sq_session_token", t), sessionToken);
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const btn = page.locator("nav.tabs button", { hasText: /coach|guide|handler/i }).first();
  if (await btn.count()) await btn.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${theme}-coach.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log("done");
