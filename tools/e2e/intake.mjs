/**
 * A new student, from the first screen to a planned week, entirely through the browser.
 *
 *   node tools/e2e/intake.mjs            starts both servers itself, then stops them
 *   node tools/e2e/intake.mjs --attach   uses servers already running (see the note it prints)
 *
 * The acceptance and scheduling journeys set the term, hours and courses up through the API, so
 * none of the screens a new student actually meets -- onboarding, the key, the semester
 * calendar, adding a course, the syllabus upload, the review, its questions -- was ever rendered
 * by a test. This walks all of them in the order the app asks for them: choose a theme, name the
 * term, say when you can study, save a key, mark the breaks, add the courses, upload each
 * syllabus, answer what the review asks, confirm, and see the work reach the plan.
 *
 * The model is the one thing replaced. A mock OpenRouter, started here, serves the extraction
 * JSON committed under `semester4/` -- authored from the real text of genuine Spring 2023
 * syllabi -- and the Worker is pointed at it for this run only. Everything downstream of the
 * model runs unmodified: the schema parse, the evidence check against the page text, date
 * resolution, the weekday answer, confirm, and the plan. So does everything upstream: the
 * syllabus is a real .docx, built here from those same pages, picked through the real file input
 * and read to page text by the app's own reader in the browser.
 *
 * What it does not test: the production model's own reading of a document.
 */
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { api, at, check, openApp, runJourney, signUp } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SEMESTER4 = join(HERE, "semester4");
const PAGES = JSON.parse(readFileSync(join(SEMESTER4, "pages.json"), "utf8"));

/**
 * The term as `semester4/run.mjs` assembles it from what the documents state, and a moment in
 * its second week to plan from. The date is pinned, not today's: these syllabi are from 2023.
 */
const TERM = { name: "Spring 2023", startDate: "2023-01-09", endDate: "2023-05-15" };
const NOW = at("2023-01-16", "09:00");
/** The week all four documents agree is spring break. */
const SPRING_BREAK = ["2023-03-13", "2023-03-14", "2023-03-15", "2023-03-16", "2023-03-17"];

/**
 * Two of the four, chosen for what they exercise: Math 104 lists its work by week number and
 * names the weekday once in prose, so the review has to ask; GEOG 062 states its class meetings.
 * `code` is how the mock tells the requests apart -- it appears in each syllabus's own text.
 */
const COURSES = [
  { key: "richland_math104", name: "Technical Mathematics", code: "Math 104" },
  { key: "unc_geog062", name: "The Culture of Technology", code: "GEOG 062" },
];

const MOCK_PORT = 9099;
const STUDENT_KEY = "sk-or-v1-intake-journey-not-a-real-key";

// --- A real .docx from page text ------------------------------------------------------------

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const { zipSync, strToU8 } = createRequire(join(ROOT, "apps/web/package.json"))("fflate");

/**
 * The smallest .docx Word would open: a paragraph per line, a tab where the text has one, and a
 * page break between pages -- which the app's reader turns back into page numbers, so evidence
 * cited as "page 7" is checked against page 7.
 */
function buildDocx(pages) {
  const escape = (s) =>
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const paragraph = (line) =>
    `<w:p><w:r>${line
      .split("\t")
      .map((t) => `<w:t xml:space="preserve">${escape(t)}</w:t>`)
      .join("<w:tab/>")}</w:r></w:p>`;
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const body = pages.map((p) => p.text.split("\n").map(paragraph).join("")).join(pageBreak);
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          "</Types>",
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>",
      ),
      "word/document.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
      ),
    }),
  );
}

// --- The mock model -------------------------------------------------------------------------

/** Every extraction request the mock answered, for the checks on what reached the model. */
const extractions = [];

function startMockModel() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        // The model catalogue: refusing it makes the Worker fall back to its built-in list,
        // which is the offline behaviour and needs nothing more from here.
        if (req.method !== "POST") throw new Error(`${req.method} ${req.url} is not served`);
        const parsed = JSON.parse(body || "{}");
        const schema = parsed.response_format?.json_schema?.name;
        const text = (parsed.messages ?? [])
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
          .join("\n");
        let content;
        if (schema === "syllabus_extraction") {
          const course = COURSES.find((c) => text.includes(c.code));
          if (!course) throw new Error("no known course in the extraction request");
          extractions.push({ key: course.key, authorization: req.headers.authorization ?? "", text });
          content = readFileSync(join(SEMESTER4, `${course.key}.output.json`), "utf8");
        } else if (schema === "topic_verdict") {
          content = JSON.stringify({ label: "ALLOW" });
        } else {
          throw new Error(`schema ${schema} is not served`);
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: parsed.model ?? "mock",
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 8000, completion_tokens: 3000 },
          }),
        );
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: error.message } }));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server));
  });
}

/** "Does `needle` appear in `haystack`", ignoring how the whitespace was laid out on the way. */
function containsLoosely(haystack, needle) {
  const squash = (s) => s.replace(/\s+/g, " ").trim();
  return squash(haystack).includes(squash(needle));
}

// --- The journey ----------------------------------------------------------------------------

const mock = await startMockModel();

await runJourney(
  "intake checks",
  async ({ browser }) => {
    const { token } = await signUp("intake");
    const { page, context, nav, go, errors } = await openApp(browser, token, { now: NOW, shell: false });

    // 1. Onboarding: a theme, the term, the hours. Every field through the form.
    await page.getByRole("group", { name: "Choose a theme" }).getByRole("button", { name: /plain/i }).click();
    await page.getByLabel("Term name").fill(TERM.name);
    await page.getByLabel("First day of classes").fill(TERM.startDate);
    await page.getByLabel("Last day of instruction").fill(TERM.endDate);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "When can you study?" }).waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "Finish setup" }).click();
    await nav.waitFor({ timeout: 30_000 }).catch(() => {});
    check("onboarding: theme, term and study hours lead into the app", (await nav.count()) === 1);
    const { terms } = await api("/api/terms", "GET", undefined, token);
    const term = terms[0];
    check(
      "onboarding: the term is stored with the dates the student typed",
      terms.length === 1 && term.startDate === TERM.startDate && term.endDate === TERM.endDate,
      `${term?.startDate}..${term?.endDate}`,
    );

    // 2. The key, in Setup -> AI and model. Nothing reads a syllabus without one.
    await go("Setup");
    await page.getByLabel("OpenRouter API key").fill(STUDENT_KEY);
    await page.getByRole("button", { name: "Save key" }).click();
    await page.getByText(/Key saved/).waitFor({ timeout: 15_000 }).catch(() => {});
    check("setup: the student's key is saved", (await page.getByText(/Key saved/).count()) === 1);

    // 3. The semester calendar, by hand, before any syllabus -- the upload is refused until then.
    const upload = page.locator("#syllabus-upload");
    const fileInput = upload.locator('input[type="file"]').first();
    check("setup: the syllabus upload waits for a calendar", await fileInput.isDisabled());
    const calendar = page.locator("#term-calendar");
    for (const date of SPRING_BREAK) {
      await calendar.locator('input[type="date"]').fill(date);
      await calendar.getByPlaceholder(/Reading day/).fill("Spring break");
      await calendar.getByRole("button", { name: "Add", exact: true }).click();
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(1200);
    const stored = (await api("/api/terms", "GET", undefined, token)).terms[0].calendar?.exceptions ?? [];
    check("setup: the days off added by hand are on the term", stored.length === SPRING_BREAK.length, `${stored.length} stored`);
    // 4. The courses, from the course manager.
    const manager = page.locator("#course-manager");
    for (const course of COURSES) {
      await manager.getByRole("button", { name: /add a course/i }).first().click();
      await manager.getByLabel("Course name").first().fill(course.name);
      await manager.getByLabel("Course name").first().press("Enter");
      await manager.getByText(course.name).first().waitFor({ timeout: 15_000 }).catch(() => {});
    }
    const snapshot = await api(`/api/terms/${term.id}/snapshot`, "GET", undefined, token);
    const courseIds = Object.fromEntries(
      COURSES.map((c) => [c.key, snapshot.courses.find((row) => row.name === c.name)?.id]),
    );
    check(
      "setup: both courses were added from the course manager",
      COURSES.every((c) => courseIds[c.key]),
      snapshot.courses.map((c) => c.name).join(", "),
    );
    check("setup: with a calendar and a course, the syllabus upload opens", !(await fileInput.isDisabled()));

    // 5. Each syllabus: pick the course, pick the file, review, answer, confirm.
    for (const course of COURSES) {
      const label = course.code;
      await upload.locator("#upload-course").selectOption(courseIds[course.key]);
      const before = extractions.length;
      await fileInput.setInputFiles({
        name: `${course.key}.docx`,
        mimeType: DOCX_MIME,
        buffer: buildDocx(PAGES[course.key]),
      });
      const review = page.getByRole("heading", { name: "Review what was found" });
      await review.waitFor({ timeout: 60_000 }).catch(() => {});
      check(`${label}: the uploaded .docx is read and comes back for review`, (await review.count()) === 1);
      const sent = extractions[before];
      check(
        `${label}: the model call is made with the student's own key`,
        sent?.authorization === `Bearer ${STUDENT_KEY}`,
      );
      const pages = PAGES[course.key];
      check(
        `${label}: the page text the browser read is what reached the model`,
        Boolean(sent) && pages.every((p) => containsLoosely(sent.text, p.text.slice(0, 80))),
        `${pages.length} pages`,
      );
      check(
        `${label}: nothing was discarded before review`,
        (await page.getByRole("heading", { name: "Discarded before review" }).count()) === 0,
      );
      check(
        `${label}: every quoted line was found in the document`,
        (await page.getByText("The quoted text could not be matched exactly in the document.").count()) === 0,
      );
      // Everything the server kept is on screen. More than the model returned is right -- "a quiz
      // each chapter" becomes one row per chapter -- but never fewer.
      const { documents } = await api(`/api/courses/${courseIds[course.key]}/documents`, "GET", undefined, token);
      const { claims } = await api(`/api/documents/${documents[0]?.id}/extraction`, "GET", undefined, token);
      const kept = claims.filter((c) => c.claimType === "assignment").length;
      const returned = JSON.parse(readFileSync(join(SEMESTER4, `${course.key}.output.json`), "utf8")).assignments.length;
      const heading = (await page.getByRole("heading", { name: /^Assignments \(\d+\)$/i }).textContent().catch(() => "")) ?? "";
      check(
        `${label}: every assignment kept is offered for review, and none the model returned is lost`,
        heading === `Assignments (${kept})` && kept >= returned,
        `${heading}; the model returned ${returned}`,
      );

      // "Listed by week" is answered with a day, in one click. Whether that day dates anything
      // depends on the document; what must happen is a reply on screen saying what it did.
      const friday = page.getByRole("button", { name: "Friday", exact: true });
      if ((await friday.count()) > 0) {
        await friday.first().click();
        const resolution = page.locator(".notice").filter({ hasText: /^Dated \d+ items? to the Friday/ });
        await resolution.waitFor({ timeout: 15_000 }).catch(() => {});
        check(
          `${label}: a weekday answer says on screen what it dated and what it could not`,
          (await resolution.count()) === 1,
          (await resolution.innerText().catch(() => "")).slice(0, 160),
        );
      }

      // "I don't know yet" is a real answer, and it is kept as one.
      const unsure = page
        .locator(".button-row")
        .filter({ has: page.getByPlaceholder("Your answer") })
        .first()
        .getByRole("button", { name: "I don't know yet" });
      if ((await unsure.count()) > 0) {
        await unsure.click();
        await page.waitForTimeout(1500);
        const after = await api(`/api/documents/${documents[0]?.id}/extraction`, "GET", undefined, token);
        check(
          `${label}: "I don't know yet" is stored as the answer`,
          after.claims.some((c) => c.claimType === "clarification_question" && c.payload.answer === "unknown"),
        );
      }

      const confirm = page.getByRole("button", { name: /^Add \d+ to my plan$/ });
      const offered = Number((await confirm.innerText()).match(/\d+/)?.[0] ?? 0);
      await confirm.click();
      const done = upload.getByText(/^Added [1-9]\d* assignment/);
      await done.waitFor({ timeout: 30_000 }).catch(() => {});
      check(`${label}: confirming adds the work to the plan`, (await done.count()) === 1, await done.innerText().catch(() => ""));
      const items = (await api(`/api/terms/${term.id}/snapshot`, "GET", undefined, token)).workItems.filter(
        (w) => w.courseId === courseIds[course.key],
      );
      check(`${label}: the confirmed work is stored against the course`, items.length > 0 && items.length <= offered, `${items.length} items`);
    }

    // 6. What the review left open follows the student back to Setup.
    await go("Setup");
    const open = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Still unanswered" }) });
    await open.waitFor({ timeout: 15_000 }).catch(() => {});
    const openText = await open.innerText().catch(() => "");
    check(
      "setup: questions the review left open are listed under each course",
      COURSES.every((c) => openText.includes(c.name)),
      openText.split("\n").slice(1, 2).join(""),
    );

    // 7. The plan the student is left with.
    const plan = await api(`/api/terms/${term.id}/plans/current?now=${encodeURIComponent(NOW)}`, "GET", undefined, token);
    const planned = new Set(plan.sessions.filter((s) => s.status === "planned").map((s) => s.courseId));
    check(
      "the plan: confirming a syllabus books time for the work it added",
      plan.sessions.length > 0,
      `${plan.sessions.length} blocks, courses ${[...planned].length}`,
    );
    await go("Today");
    const primary = page.locator(".primary-action");
    await primary.waitFor({ timeout: 15_000 }).catch(() => {});
    check("the plan: Today has something to do", (await primary.count()) === 1);

    check("no page errors were thrown anywhere on the journey", errors.length === 0, errors.join(" | "));
    await context.close();
  },
  { workerVars: { OPENROUTER_BASE_URL: `http://127.0.0.1:${MOCK_PORT}` } },
);

mock.close();
