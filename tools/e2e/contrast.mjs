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

const EMAIL = process.env.SQ_EMAIL ?? "semester-test@example.edu";
const login = await api("/api/auth/login", "POST", { email: EMAIL });
const { sessionToken } = await api("/api/auth/callback", "POST", {
  token: new URL(login.devLoginUrl).searchParams.get("token"),
});
await api("/api/me", "PATCH", { theme: THEME }, sessionToken);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(APP);
await page.evaluate((t) => localStorage.setItem("sq_session_token", t), sessionToken);
// The tables and the hour calendar are whole surfaces the default view never reaches, and
// each brings its own grounds — a parchment table header, a calendar band. Measuring only
// what the app happens to open on is how a theme ships an unreadable screen.
await page.evaluate((v) => localStorage.setItem("sq_view_mode", v), process.env.SQ_VIEW ?? "visual");
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

  /**
   * Opacity inherited down the tree, multiplied.
   *
   * The checker read `color` and composited backgrounds but ignored opacity below 1, so
   * text at `opacity: 0.4` was measured at full strength and passed. That is not a
   * hypothetical: dimming with opacity is the obvious way to build a course lens, and it
   * would have sailed through this check while genuinely reducing what a reader can see.
   * A checker that can be satisfied without the screen improving is worse than none.
   */
  const effectiveOpacity = (el) => {
    let alpha = 1;
    for (let node = el; node; node = node.parentElement) {
      const value = parseFloat(getComputedStyle(node).opacity);
      if (!Number.isNaN(value)) alpha *= value;
    }
    return alpha;
  };

  const results = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
    // Only elements that paint text themselves, not containers of other elements.
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!text) continue;

    // Decoration is judged by content, not by aria-hidden.
    //
    // Exempting aria-hidden subtrees was wrong here, and quietly so. This codebase renders
    // themed wording as a visible `aria-hidden` span beside an `.sr-only` plain-language
    // twin, so *every themed string in the app* sits inside an aria-hidden subtree — which
    // is exactly the text the theme is judged on. The old rule made the checker blind to
    // it, and it passed a "THE CRUX" label sitting at roughly 1.1:1.
    //
    // What is genuinely decorative is a glyph with no words in it. That is testable
    // directly, so it is tested directly.
    const isGlyphOnly = !/[a-z0-9]/i.test(text);
    if (isGlyphOnly) continue;

    // WCAG 1.4.3 exempts inactive controls from the contrast minimum, and this codebase
    // fades them with `opacity: 0.5`. They are reported rather than dropped: exempt is not
    // the same as invisible, and a disabled control nobody can read is still worth seeing
    // in the output even when it does not fail the run.
    const disabled = el.closest("[disabled], [aria-disabled='true']") !== null;


    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;

    /**
     * SVG text paints with `fill`, not with `color`.
     *
     * Reading `color` for an SVG label returns whatever the surrounding CSS inherited, which
     * is the card's ink and has nothing to do with what is on screen. The terrain view's
     * labels were reported at 1.2:1 against a colour they never used, while the values that
     * actually paint went unmeasured entirely — a checker confidently wrong in both
     * directions at once. Anything inside an `<svg>` is judged on its fill.
     */
    // Namespace, not `ownerSVGElement`: that property is *undefined* on an HTML element
    // rather than null, so `!== null` matched every node on the page and judged the whole
    // app against `fill`, which computes to black on HTML and paints nothing.
    const inSvg = el.namespaceURI === "http://www.w3.org/2000/svg";
    const paint = inSvg ? style.fill || style.color : style.color;
    const fg = parse(paint);
    // A fill of `none`, or a paint-server reference like `url(#grad)`, is not a flat colour
    // and cannot be measured this way. Skipping is right; guessing would not be.
    if (!fg) continue;

    // Faded text is painted at that fraction over whatever is behind it, so that is how it
    // is measured. Without this, opacity is a way to fail the reader and pass the check.
    const painted = { ...fg, a: fg.a * effectiveOpacity(el) };

    let worst = null;
    for (const ground of groundsOf(el)) {
      const r = ratio(over(painted, ground), ground);
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
      disabled,
      text: text.slice(0, 60),
      selector: el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(" ")[0]}` : ""),
      color: paint,
      ground: worst.ground,
      ratio: Math.round(worst.ratio * 100) / 100,
      large,
    });
  }
  return results;
};

const TABS = [
  // The radar is the landing tab, so it needs no click. Everything after it does — a null
  // matcher means "whatever is already on screen", not "Today".
  ["radar", null],
  ["today", /^today$/i],
  ["week", /week|map|board/i],
  // The assignments table moved to its own tab, and a walk that skips a tab is how a
  // theme ships an unreadable screen -- the exact failure this script exists to prevent.
  ["work", /assignment|task/i],
  ["stats", /progress|chronicle|readiness/i],
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

  // The week has three visual shapes and each is a whole surface with its own grounds.
  const weekViews = { calendar: "Hour by hour", terrain: "The road ahead" };
  const wanted = weekViews[process.env.SQ_WEEK_VIEW];
  if (name === "week" && wanted) {
    const button = page.getByRole("button", { name: wanted });
    if ((await button.count()) > 0) {
      await button.click();
      await page.waitForTimeout(1100);
    }
  }

  const results = await page.evaluate(MEASURE);
  const under = results.filter((r) => r.ratio !== null && r.ratio < (r.large ? AA_LARGE : AA_NORMAL));
  const bad = under.filter((r) => !r.disabled);
  const exempt = under.filter((r) => r.disabled);


  console.log(`\n=== ${THEME} / ${name} — ${results.length} text nodes, ${bad.length} below AA`);
  for (const r of bad.sort((a, b) => a.ratio - b.ratio)) {
    console.log(
      `  ${String(r.ratio).padStart(6)}:1  ${r.selector.padEnd(24)} ${r.color} on ${r.ground}  "${r.text}"`,
    );
  }
  for (const r of exempt) {
    console.log(`  ${String(r.ratio).padStart(6)}:1  (disabled — WCAG-exempt)  "${r.text}"`);
  }
  failures += bad.length;
}

await browser.close();

// Elements over a gradient cannot be measured this way; they are reported so a human
// checks them rather than silently counted as passing.

console.log(`\n${failures} contrast failures in the ${THEME} theme.`);
process.exit(failures > 0 ? 1 : 0);
