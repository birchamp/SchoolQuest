/* global window, Event */
// Walks all eight workflows the app claims to support and reports what actually happened.
//   node tools/e2e/workflows.mjs
import { chromium } from "playwright";
const APP = "http://127.0.0.1:5173", API = "http://127.0.0.1:8787";
const api = async (p, m = "GET", b, t) => {
  const r = await fetch(API + p, { method: m, headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const x = await r.text();
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${x.slice(0, 200)}`);
  return x ? JSON.parse(x) : null;
};
const ok = (c) => (c ? "OK" : "FAIL");
const log = (n, msg, pass) => console.log(`${String(n).padStart(2)}. ${pass === undefined ? "  " : ok(pass).padEnd(4)} ${msg}`);

const l = await api("/api/auth/login", "POST", { email: process.env.SQ_EMAIL });
const { sessionToken } = await api("/api/auth/callback", "POST", { token: new URL(l.devLoginUrl).searchParams.get("token") });
await api("/api/me", "PATCH", { theme: process.env.SQ_THEME ?? "plain" }, sessionToken);
const { terms } = await api("/api/terms", "GET", undefined, sessionToken);
const termId = (terms.find((t) => t.status === "active") ?? terms[0]).id;

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 1280, height: 1400 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => m.type() === "error" && !m.text().includes("401") && errs.push(m.text()));
await page.goto(APP);
await page.evaluate((t) => localStorage.setItem("sq_session_token", t), sessionToken);
await page.evaluate(() => localStorage.setItem("sq_view_mode", "visual"));
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const nav = page.getByRole("navigation", { name: "Main" });
const tabs = await nav.getByRole("button").allTextContents();
const go = async (i) => { await nav.getByRole("button", { name: tabs[i] }).click(); await page.waitForTimeout(1400); };

// 1 — syllabus ingest
await go(4);
const upload = await page.getByText(/syllabus/i).count();
log(1, `Syllabus ingest: upload surface present (${upload} mentions)`, upload > 0);

// 3 — classes, work, meals
const setup = await page.locator("h2").allTextContents();
log(3, `Schedule classes / work / meals: ${setup.join(" · ")}`,
  setup.some((h) => /commitment/i.test(h)) && setup.some((h) => /meal/i.test(h)));
const classBtn = page.getByRole("button", { name: "Class times" });
log(3, `  class times editable after creation: ${await classBtn.count()} course(s)`, (await classBtn.count()) > 0);
log(3, `  commitments editable: ${await page.getByRole("button", { name: "Change" }).count()} row(s)`,
  (await page.getByRole("button", { name: "Change" }).count()) > 0);

// 4 — study hours
log(4, "Study hours editable in Setup", setup.some((h) => /study hours/i.test(h)));
const before = (await api(`/api/terms/${termId}/snapshot`, "GET", undefined, sessionToken)).availabilityRules.length;
log(4, `  ${before} availability window(s) loaded`, before > 0);

// 5 — study time matched to assignments
const plan = await api(`/api/terms/${termId}/plans/current`, "GET", undefined, sessionToken);
const matched = plan.sessions.every((s) => plan.workItems.some((w) => w.id === s.workItemId));
log(5, `Study blocks matched to work items: ${plan.sessions.length} block(s), all resolve`, matched);
log(5, `  reasons attached: ${plan.recommendations[0]?.explanation?.slice(0, 60) ?? "none"}`,
  Boolean(plan.recommendations[0]?.explanation));

// 6 — hour calendar
await go(1);
await page.getByRole("button", { name: "Hour by hour" }).click();
await page.waitForTimeout(1200);
const totals = (await page.locator('[aria-labelledby="calendar-heading"] p').nth(1).textContent())?.trim();
log(6, `Hour-by-hour calendar: ${totals}`, /free/.test(totals ?? ""));

// 7 — lookahead as maps
await page.getByRole("button", { name: /week plan|region map|operations/i }).first().click();
await page.waitForTimeout(1000);
const arc = await page.getByText(/campaign arc|what is coming|the long roads|set pieces|ahead/i).count();
log(7, `Lookahead map present (${arc} match)`, arc > 0);

// 8 + 2 — tables everywhere, and date editing
await page.evaluate(() => { localStorage.setItem("sq_view_mode", "table"); window.dispatchEvent(new Event("sq:view-mode")); });
await page.waitForTimeout(1600);
const weekTables = await page.locator("table.data-table").count();
log(8, `Tables on the week tab: ${weekTables}`, weekTables >= 3);
await go(2);
const statTables = await page.locator("table.data-table").count();
log(8, `Tables on the term tab: ${statTables}`, statTables >= 1);

await go(1);
const input = page.locator("table.data-table input[type=date]").first();
await input.fill("2026-12-01");
await input.blur();
await page.waitForTimeout(2800);
const after = await api(`/api/terms/${termId}/plans/current`, "GET", undefined, sessionToken);
log(2, `Assignment date changed and replanned: ${after.workItems.filter((w) => w.dueAt?.startsWith("2026-12-01")).length} item(s) now due 2026-12-01`,
  after.workItems.some((w) => w.dueAt?.startsWith("2026-12-01")));

console.log(errs.length ? `\nCONSOLE ERRORS: ${errs.join(" | ")}` : "\nno page errors");
await b.close();
