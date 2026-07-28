/**
 * Emits the exact payload the extraction provider would send, one file per syllabus.
 *
 * Used to evaluate extraction quality without a live provider: a model is handed these
 * verbatim, its JSON is fed back through the real validator, and nothing about the prompt
 * can drift from what production sends because it is imported, not copied.
 *
 * Run with:  npx tsx packages/ai/src/extraction/build-eval-inputs.ts <outDir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAKE_COURSES, FAKE_TERM, GREEK_PAGES, REVELATION_PAGES, THEOLOGY_PAGES } from "@schoolquest/fixtures";
import { buildExtractionUserMessage, EXTRACTION_SYSTEM_PROMPT } from "./prompt.js";
import { SYLLABUS_EXTRACTION_JSON_SCHEMA } from "./schema.js";

const outDir = process.argv[2] ?? ".";
mkdirSync(outDir, { recursive: true });

const cases = [
  {
    key: "greek",
    pages: GREEK_PAGES,
    courseName: "Greek I",
    termStartDate: "2026-08-25",
    termEndDate: "2026-12-18",
  },
  {
    key: "theology",
    pages: THEOLOGY_PAGES,
    courseName: "Systematic Theology I",
    termStartDate: "2026-08-25",
    termEndDate: "2026-12-11",
  },
  {
    key: "revelation",
    pages: REVELATION_PAGES,
    courseName: "The Revelation",
    termStartDate: "2026-08-25",
    termEndDate: "2026-12-18",
  },
  // The synthetic five-course semester, planted traps and all.
  ...FAKE_COURSES.map((course) => ({
    key: `fake-${course.key}`,
    pages: course.pages,
    courseName: `${course.name} (${course.code})`,
    termStartDate: FAKE_TERM.startDate,
    termEndDate: FAKE_TERM.endDate,
  })),
];

for (const testCase of cases) {
  const userMessage = buildExtractionUserMessage(testCase.pages, {
    courseName: testCase.courseName,
    termStartDate: testCase.termStartDate,
    termEndDate: testCase.termEndDate,
  });

  writeFileSync(
    join(outDir, `${testCase.key}.prompt.md`),
    [
      "# SYSTEM PROMPT",
      "",
      EXTRACTION_SYSTEM_PROMPT,
      "",
      "# REQUIRED JSON SCHEMA",
      "",
      "```json",
      JSON.stringify(SYLLABUS_EXTRACTION_JSON_SCHEMA, null, 2),
      "```",
      "",
      "# USER MESSAGE",
      "",
      userMessage,
    ].join("\n"),
  );
  console.log(`${testCase.key}: ${testCase.pages.length} pages`);
}
