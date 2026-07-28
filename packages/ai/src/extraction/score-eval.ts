/**
 * Scores a model's raw extraction output using the real production validator.
 *
 * This is the harness docs/06-ai-system-spec.md §11 asks for: it does not judge whether an
 * answer "looks right", it reports what the validator caught. A model that fabricates gets
 * its claims rejected here, visibly, with counts.
 *
 * Run with:  npx tsx packages/ai/src/extraction/score-eval.ts <evalDir>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GREEK_PAGES, REVELATION_PAGES, THEOLOGY_PAGES } from "@schoolquest/fixtures";
import { syllabusExtraction } from "./schema.js";
import { validateExtraction } from "./validate.js";
import type { DocumentPage } from "./prompt.js";

const evalDir = process.argv[2] ?? ".";

const cases: { key: string; pages: DocumentPage[]; start: string; end: string }[] = [
  { key: "greek", pages: GREEK_PAGES, start: "2026-08-25", end: "2026-12-18" },
  { key: "theology", pages: THEOLOGY_PAGES, start: "2026-08-25", end: "2026-12-11" },
  { key: "revelation", pages: REVELATION_PAGES, start: "2026-08-25", end: "2026-12-18" },
];

let totalClaims = 0;
let totalRejected = 0;
let schemaFailures = 0;

for (const testCase of cases) {
  console.log(`\n${"=".repeat(72)}\n${testCase.key.toUpperCase()}\n${"=".repeat(72)}`);

  let raw: string;
  try {
    raw = readFileSync(join(evalDir, `${testCase.key}.output.json`), "utf8");
  } catch {
    console.log("  no output file — skipped");
    continue;
  }

  const parsed = syllabusExtraction.safeParse(JSON.parse(stripFences(raw)));
  if (!parsed.success) {
    schemaFailures++;
    console.log("  SCHEMA VALIDATION FAILED");
    console.log(`  ${JSON.stringify(parsed.error.issues.slice(0, 5), null, 2)}`);
    continue;
  }

  const result = validateExtraction(parsed.data, {
    pages: testCase.pages,
    termStartDate: testCase.start,
    termEndDate: testCase.end,
  });

  totalClaims += parsed.data.assignments.length;
  totalRejected += result.rejected.length;

  console.log(
    `  assignments: ${parsed.data.assignments.length} claimed, ` +
      `${result.assignments.length} survived, ${result.rejected.length} rejected`,
  );
  console.log(
    `  categories: ${result.gradingCategories.length}  ` +
      `meetings: ${result.meetingPatterns.length}  ` +
      `questions: ${result.clarificationQuestions.length}`,
  );

  if (result.rejected.length > 0) {
    console.log("\n  REJECTED (fabricated or unverifiable):");
    for (const r of result.rejected) console.log(`    - ${r.title} [${r.reason}]`);
  }

  // Issue histogram: which defenses actually fired.
  const histogram = new Map<string, number>();
  for (const item of result.assignments) {
    for (const issue of item.issues) histogram.set(issue, (histogram.get(issue) ?? 0) + 1);
  }
  if (histogram.size > 0) {
    console.log("\n  ISSUES RAISED:");
    for (const [issue, count] of [...histogram].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(3)}x ${issue}`);
    }
  }

  const dated = result.assignments.filter((a) => a.assignment.dueDate.iso !== null);
  console.log(
    `\n  dates: ${dated.length}/${result.assignments.length} resolved to a calendar date`,
  );

  console.log("\n  ASSIGNMENTS:");
  for (const item of result.assignments) {
    const date = item.assignment.dueDate.iso ?? `(${item.assignment.dueDate.raw ?? "no date"})`;
    const flags = item.issues.length > 0 ? `  [${item.issues.join(",")}]` : "";
    console.log(
      `    ${item.assignment.title.slice(0, 42).padEnd(44)} ${String(date).padEnd(14)} ` +
        `p.${item.assignment.evidence.page} ${item.confidenceStatus}${flags}`,
    );
  }

  if (result.warnings.length > 0) {
    console.log("\n  WARNINGS:");
    for (const w of result.warnings) console.log(`    - ${w}`);
  }

  console.log("\n  QUESTIONS:");
  for (const q of result.clarificationQuestions) {
    const scope = q.relatesToTitles ? ` (${q.relatesToTitles.length} items)` : "";
    console.log(`    [${q.kind}]${scope} ${q.question}`);
  }
}

console.log(`\n${"=".repeat(72)}`);
console.log(
  `TOTAL: ${totalClaims} claims, ${totalRejected} rejected by evidence checks, ` +
    `${schemaFailures} schema failures`,
);

/** Models often wrap JSON in markdown fences despite being told not to. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
}
