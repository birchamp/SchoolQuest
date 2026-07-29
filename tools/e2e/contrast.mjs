// Measures text contrast on every rendered screen and fails on anything under the WCAG
// AA floor.
//
//   node contrast.mjs [theme]
//
// This exists because four rounds of visual review passed a screen whose most important
// sentence — the "why this now?" rationale on the Main Quest card — was rendering cream
// on cream at 1.06:1. Nobody saw it, because at that ratio there is nothing to see. A
// theme that repaints the ground under a card has to repaint every token that means
// "text on the ground" with it, and the only reliable way to know it did is to measure.
//
// Walks the real DOM in the real browser, so it catches whatever actually won the cascade
// rather than whatever the stylesheet appears to say.
import { chromium } from "playwright";

const THEME = process.argv[2] ?? "quest";
const APP = "http://127.0.0.1:5173";
const API = "http://127.0.0.1:8787";

/** WCAG AA: 4.5:1 for body text, 3:1 for large text (>=24px, or >=18.66px bold). */
const AA_NORMAL = 4.5;
const AA_LARGE = 3;

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
await page.waitForTimeout(1500);

/**
 * Runs in the page. Composites every ancestor background to find what a glyph is actually
 * painted on — a translucent card over a dark page is not the same ground as an opaque
 * one, and only the composite tells the truth.
 */
const MEASURE = () => {
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = "1"] = m[1].split(",").map((s) => parseFloat(s.trim()));
    return { r, g, b, a };
  };

  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const luminance = ({ r, g, b }) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // A single background-color read is not enough: nearly every surface in the Quest theme
  // is a stack of gradients. Skipping those was the whole reason this bug survived — the
  // failing text sat on exactly the gradients an early version of this script declined to
  // measure. So every gradient contributes its colour stops as candidate grounds, and the
  // ratio reported is the worst one. Text that is readable over part of a gradient and
  // invisible over the rest is still a defect.
  // `background-image` holds comma-separated layers, topmost first, and each may itself
  // contain commas inside its parentheses. Split on top-level commas only.
  const splitLayers = (image) => {
    const parts = [];
    let depth = 0;
    let current = "";
    for (const ch of image) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts;
  };

  const groundsOf = (el) => {
    let grounds = [{ r: 255, g: 255, b: 255, a: 1 }];
    const layers = [];

    outer: for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const image = style.backgroundImage;
      if (image && image !== "none") {
        // Bottom layer up, so an opaque one ends the walk: nothing painted under an
        // opaque gradient can reach the glyph, and treating the page's leather as a
        // candidate ground under an opaque parchment card reported ink-on-leather
        // failures for text that is plainly ink on parchment.
        for (const layer of splitLayers(image).reverse()) {
          const stops = [...layer.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0]));
          if (stops.length === 0) continue;
          const opaque = stops.every((c) => c && c.a === 1);
          // A layer of near-transparent stops contributes nothing; pushing it as an empty
          // candidate set silently emptied the whole ground list and dropped the element
          // from the report entirely — a checker that quietly skips work is worse than no
          // checker, so this guard matters more than it looks.
          const candidates = stops.filter((c) => c && c.a > 0.05);
          if (candidates.length > 0) layers.push({ candidates });
          if (opaque) break outer;
        }
      }
      const bg = parse(style.backgroundColor);
      if (bg && bg.a > 0) layers.push({ candidates: [bg] });
      if (bg && bg.a === 1) break;
    }

    for (const layer of layers.reverse()) {
      const next = [];
      for (const ground of grounds) {
        for (const candidate of layer.candidates) next.push(over(candidate, ground));
      }
      // Only the extremes matter for a worst-case ratio, and keeping every combination
      // would blow up across four stacked gradients.
      next.sort((a, b) => luminance(a) - luminance(b));
      grounds = next.length > 2 ? [next[0], next[next.length - 1]] : next;
    }
    return grounds;
  };

  const results = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
    // Ancestor, not just self: an ornament nested inside an aria-hidden kicker is
    // decoration too, and holding decoration to the text floor would push the theme
    // toward flat, high-contrast marks that look worse and help nobody.
    if (el.closest('[aria-hidden="true"]')) continue;

    // Only elements that paint text themselves, not containers of other elements.
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!text) continue;

    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;

    const fg = parse(style.color);
    if (!fg) continue;

    let worst = null;
    for (const ground of groundsOf(el)) {
      const r = ratio(over(fg, ground), ground);
      if (worst === null || r < worst.ratio) {
        worst = {
          ratio: r,
          ground: `rgb(${Math.round(ground.r)}, ${Math.round(ground.g)}, ${Math.round(ground.b)})`,
        };
      }
    }
    if (!worst) continue;

    const size = parseFloat(style.fontSize);
    const weight = parseInt(style.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);

    results.push({
      text: text.slice(0, 60),
      selector: el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(" ")[0]}` : ""),
      color: style.color,
      ground: worst.ground,
      ratio: Math.round(worst.ratio * 100) / 100,
      large,
    });
  }
  return results;
};

const TABS = [
  ["today", null],
  ["week", /week|map|board/i],
  ["coach", /coach|guide|handler/i],
  ["setup", /setup/i],
];

let failures = 0;


for (const [name, matcher] of TABS) {
  if (matcher) {
    const button = page.locator("nav.tabs button", { hasText: matcher }).first();
    if ((await button.count()) > 0) await button.click();
    await page.waitForTimeout(800);
  }

  const results = await page.evaluate(MEASURE);
  const bad = results.filter((r) => r.ratio !== null && r.ratio < (r.large ? AA_LARGE : AA_NORMAL));


  console.log(`\n=== ${THEME} / ${name} — ${results.length} text nodes, ${bad.length} below AA`);
  for (const r of bad.sort((a, b) => a.ratio - b.ratio)) {
    console.log(
      `  ${String(r.ratio).padStart(6)}:1  ${r.selector.padEnd(24)} ${r.color} on ${r.ground}  "${r.text}"`,
    );
  }
  failures += bad.length;
}

await browser.close();

// Elements over a gradient cannot be measured this way; they are reported so a human
// checks them rather than silently counted as passing.

console.log(`\n${failures} contrast failures in the ${THEME} theme.`);
process.exit(failures > 0 ? 1 : 0);
