// Measures label contrast against the pixels that are actually behind them.
//
// The DOM contrast checker walks ancestors for a background colour, which is right for every
// other surface in this app and blind for exactly one: the terrain, whose ground is painted on
// a canvas. There is no CSS anywhere that says what colour is under a beacon label, so the
// checker measured those labels against the frame's gradient and passed them — while the
// hillshaded ground under some of them is pale enough to fail badly.
//
// So this one reads pixels. For each label it screenshots the label's box twice — once as
// rendered, once with the text hidden — and takes the second as the true background. Comparing
// the two is what makes it exact rather than a guess about which pixels are ink.
//
//   node canvas-contrast.mjs [theme]
import { chromium } from "playwright";
import { PNG } from "pngjs";

const THEME = process.argv[2] ?? "quest";
const APP = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8787";
const EMAIL = process.env.SQ_EMAIL ?? "terrain-demo@example.edu";

async function api(path, method = "GET", body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.json();
}

const login = await api("/api/auth/login", "POST", { email: EMAIL });
const { sessionToken } = await api("/api/auth/callback", "POST", {
  token: new URL(login.devLoginUrl).searchParams.get("token"),
});
await api("/api/me", "PATCH", { theme: THEME }, sessionToken);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
await page.goto(APP);
await page.evaluate((t) => localStorage.setItem("sq_session_token", t), sessionToken);
await page.evaluate(() => localStorage.setItem("sq_view_mode", "visual"));
await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const nav = page.getByRole("navigation", { name: "Main" });
const tabs = await nav.getByRole("button").allTextContents();
await nav.getByRole("button", { name: tabs[1] }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "The road ahead" }).click();
await page.waitForTimeout(1600);
// Clipped screenshots are viewport-relative, so the card has to be on screen before any
// label box means anything.
await page.locator(".terrain-frame-model").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const viewport = page.viewportSize();

const lum = (r, g, b) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

// Every piece of text drawn inside the terrain SVG, with the colour it paints in.
const labels = await page.$$eval("svg text", (nodes) =>
  nodes
    .filter((n) => n.closest(".terrain-frame-model") && (n.textContent ?? "").trim().length > 0)
    .map((n, i) => {
      n.setAttribute("data-sq-probe", String(i));
      const style = getComputedStyle(n);
      const box = n.getBoundingClientRect();
      return {
        i,
        text: (n.textContent ?? "").trim().slice(0, 46),
        fill: style.fill,
        size: parseFloat(style.fontSize),
        weight: style.fontWeight,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    }),
);

// The background is whatever is there once the text is gone. Hiding the whole SVG would also
// hide the beacons, whose halos are part of what a label sits on.
await page.$$eval("svg text", (nodes) => {
  for (const n of nodes) if (n.closest(".terrain-frame-model")) n.style.visibility = "hidden";
});
await page.waitForTimeout(250);

const parse = (paint) => {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(paint);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

let worst = null;
let failures = 0;
const rows = [];

for (const label of labels) {
  const fg = parse(label.fill);
  if (!fg || label.box.width < 1 || label.box.height < 1) continue;
  const onScreen =
    label.box.x >= 0 &&
    label.box.y >= 0 &&
    label.box.x + label.box.width <= viewport.width &&
    label.box.y + label.box.height <= viewport.height;
  if (!onScreen) {
    console.log(`skipped (off screen): "${label.text}"`);
    continue;
  }

  const shot = await page.screenshot({
    clip: {
      x: Math.max(0, label.box.x),
      y: Math.max(0, label.box.y),
      width: Math.max(1, label.box.width),
      height: Math.max(1, label.box.height),
    },
  });
  const png = PNG.sync.read(shot);

  // The worst pixel behind the label, not the average: a label that is legible over its dark
  // half and vanishes over its pale half has failed, and an average hides exactly that.
  let worstPixel = null;
  let worstRatio = Infinity;
  const fgL = lum(fg[0], fg[1], fg[2]);
  for (let p = 0; p < png.data.length; p += 4) {
    const r = png.data[p];
    const g = png.data[p + 1];
    const b = png.data[p + 2];
    const cr = ratio(fgL, lum(r, g, b));
    if (cr < worstRatio) {
      worstRatio = cr;
      worstPixel = [r, g, b];
    }
  }

  // WCAG large text: 18.66px bold, or 24px.
  const large = label.size >= 24 || (label.size >= 18.66 && Number(label.weight) >= 700);
  const floor = large ? 3 : 4.5;
  const pass = worstRatio >= floor;
  if (!pass) failures += 1;
  if (!worst || worstRatio < worst.r) worst = { r: worstRatio, text: label.text };
  rows.push({ text: label.text, ratio: worstRatio, floor, pass, bg: worstPixel, fg });
}

rows.sort((a, b) => a.ratio - b.ratio);
for (const row of rows.slice(0, 14)) {
  console.log(
    `${row.pass ? "  ok" : "FAIL"}  ${row.ratio.toFixed(2)}:1 (floor ${row.floor})  ` +
      `fg rgb(${row.fg.join(",")}) on rgb(${row.bg.join(",")})  "${row.text}"`,
  );
}
console.log(
  `\n${THEME}: ${rows.length} labels measured against real pixels, ${failures} below AA` +
    (worst ? ` (worst ${worst.r.toFixed(2)}:1 — "${worst.text}")` : ""),
);

await browser.close();
process.exit(failures > 0 ? 1 : 0);
