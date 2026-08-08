/**
 * Runs the real .docx reader in real Chromium, against a real .docx.
 *
 * The unit tests use happy-dom, which was wrong about the DOM twice while this was being
 * written: `getElementsByTagNameNS` returns nothing, and attribute `localName` comes back as
 * "w:type" where a browser gives "type". Both differences are silent -- the first looked like
 * an empty document, the second like page breaks that simply did not exist.
 *
 * A DOM implementation that disagrees with the browser can just as easily agree with a mistake,
 * so the fast tests are not enough on their own for a file built entirely on DOM traversal.
 * This bundles the actual module with Vite, loads it in the browser the app ships against, and
 * checks the output matches what the unit tests assert.
 *
 *   node tools/e2e/docx-in-chromium.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FIXTURE = join(ROOT, "apps/web/src/lib/__fixtures__/syllabus.docx");
const WINDOWS = process.platform === "win32";

const work = mkdtempSync(join(tmpdir(), "docx-chromium-"));
let browser;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    return true;
  }
  console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  return false;
}

try {
  // A tiny entry that re-exports the real module onto window. Bundling rather than importing
  // the .ts directly, because the browser needs the TypeScript compiled and fflate resolved.
  writeFileSync(
    join(work, "entry.js"),
    `import { extractDocxText, DocxError } from ${JSON.stringify(join(ROOT, "apps/web/src/lib/docx-text.ts"))};
     window.extractDocxText = extractDocxText;
     window.DocxError = DocxError;
     export const keep = { extractDocxText, DocxError };`,
  );

  // An IIFE, not an ES module: Chromium refuses to load a module script over file://, and the
  // bundle is then injected as inline script text so there is no second request to be blocked.
  writeFileSync(
    join(work, "vite.config.js"),
    `export default {
       build: {
         outDir: ${JSON.stringify(join(work, "dist"))},
         emptyOutDir: true,
         target: "es2022",
         lib: {
           entry: ${JSON.stringify(join(work, "entry.js"))},
           formats: ["iife"],
           name: "DocxReader",
           fileName: () => "reader.js",
         },
       },
     };`,
  );

  console.log("bundling the reader for the browser...");
  execFileSync(
    WINDOWS ? "npx.cmd" : "npx",
    [
      "vite",
      "build",
      "--config",
      join(work, "vite.config.js"),
      "--logLevel",
      "warn",
    ],
    { cwd: ROOT, stdio: "inherit", shell: WINDOWS },
  );

  const page = await (browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
  })).newPage();

  await page.setContent("<!doctype html><meta charset=\"utf-8\"><title>docx</title>");
  await page.addScriptTag({ content: readFileSync(join(work, "dist", "reader.js"), "utf8") });
  await page.waitForFunction(() => typeof window.extractDocxText === "function", null, {
    timeout: 15_000,
  });

  const base64 = readFileSync(FIXTURE).toString("base64");
  const result = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "syllabus.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    try {
      return { ok: true, value: await window.extractDocxText(file) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, base64);

  if (!result.ok) {
    console.log(`  FAIL  the reader threw in Chromium\n        ${result.error}`);
    process.exit(1);
  }

  const { pages } = result.value;
  const all = pages.map((p) => p.text).join("\n");
  const week1 = all.split("\n").find((line) => line.startsWith("Week 1")) ?? "";

  console.log("\nChromium says:");
  const passed = [
    check("reads paragraph text", all.includes("BIB199C Introduction to Biblical Studies")),
    check("keeps table rows on their own lines", week1.includes("Sept 3") && !week1.includes("Week 2")),
    check("separates cells with tabs", week1.split("\t").length === 3, JSON.stringify(week1)),
    check("keeps the tab between a label and its value", all.includes("Instructor:\tDr. Reyes")),
    check("reads the surviving text of a tracked change", all.includes("December 12")),
    check("ignores deleted text", !all.includes("December 8")),
    // The one happy-dom got wrong: it depends on reading a namespaced attribute.
    check("splits on an explicit page break", pages.length === 2, `got ${pages.length} page(s)`),
    check("puts the later content on page 2", (pages[1]?.text ?? "").includes("Grading")),
  ];

  console.log("");
  if (passed.every(Boolean)) {
    console.log(`All ${passed.length} checks passed in Chromium.`);
  } else {
    console.log(`${passed.filter((p) => !p).length} of ${passed.length} checks FAILED in Chromium.`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  rmSync(work, { recursive: true, force: true });
}
