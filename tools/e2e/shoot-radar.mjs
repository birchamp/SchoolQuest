// Shoots the campaign radar at a chosen point in the term.
//
// The seeded semester starts in the autumn, so on a wall clock in August every marker is
// weeks out, nothing is owed yet, and the whole board is one shade of green — which proves
// the geometry and hides the entire colour language. This drives the dev-only `now` on the
// plan routes to plan and read the same term from mid-semester, where the board actually
// has something to say.
//
//   node shoot-radar.mjs <outDir> <theme> [isoDate]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2];
const THEME = process.argv[3] ?? "mission";
const AS_OF = process.argv[4] ?? null;
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

const login = await api("/api/auth/login", "POST", {
  email: process.env.SQ_EMAIL ?? "semester-test@example.edu",
});
const loginToken = new URL(login.devLoginUrl).searchParams.get("token");
const { sessionToken } = await api("/api/auth/callback", "POST", { token: loginToken });
await api("/api/me", "PATCH", { theme: THEME }, sessionToken);

const { terms } = await api("/api/terms", "GET", undefined, sessionToken);
const term = terms.find((t) => t.status === "active") ?? terms[0];
if (!term) throw new Error("no term to shoot");

// Six weeks in, unless told otherwise: far enough that runways have opened and grades have
// started landing, early enough that the far rings still hold work.
const asOf = AS_OF ?? new Date(Date.parse(`${term.startDate}T09:00:00Z`) + 38 * 86_400_000).toISOString();
console.log(`term ${term.name} (${term.startDate} to ${term.endDate}) read as of ${asOf}`);

await api(
  `/api/terms/${term.id}/plans/generate`,
  "POST",
  { reason: "radar_screenshot", now: asOf, horizonStart: asOf.slice(0, 10) },
  sessionToken,
);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const W = Number(process.env.SQ_W ?? 1440);
const H = Number(process.env.SQ_H ?? 900);
const page = await browser.newPage({ viewport: { width: W, height: H } });

// The SPA reads its token from localStorage; the `now` rides along on the plan read so the
// whole page — radar, health, recommendations — is drawn from the same moment.
await page.goto(APP);
await page.evaluate(
  ([t, when]) => {
    localStorage.setItem("sq_session_token", t);
    localStorage.setItem("sq_dev_now", when);
  },
  [sessionToken, asOf],
);
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

await page.screenshot({ path: `${OUT}/${THEME}-radar-full.png`, fullPage: true });
console.log(`shot ${THEME}-radar-full.png`);

const scope = page.locator(".radar-body").first();
if ((await scope.count()) > 0) {
  await scope.screenshot({ path: `${OUT}/${THEME}-radar-scope.png` });
  console.log(`shot ${THEME}-radar-scope.png`);
}

// Every horizon, because the zoom is a scale change and scales are where projections break.
for (const weeks of [1, 2]) {
  const button = page.getByRole("button", { name: `${weeks}W`, exact: true }).first();
  if ((await button.count()) > 0) {
    await button.click();
    await page.waitForTimeout(500);
    await scope.screenshot({ path: `${OUT}/${THEME}-radar-${weeks}w.png` });
    console.log(`shot ${THEME}-radar-${weeks}w.png`);
  }
}

await browser.close();
