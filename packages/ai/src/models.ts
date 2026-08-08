/**
 * The models a student can choose between, and what each one costs them.
 *
 * ## Why this is a list and not free text
 *
 * SchoolQuest is run by whoever installed it, on their own OpenRouter key, and OpenRouter
 * carries hundreds of models with wildly different behaviour. A free-text field would let
 * someone point extraction at a model that cannot follow a JSON schema, and the failure would
 * arrive as "the extraction result did not match the expected schema" with no clue why.
 *
 * So this is a short list of models actually verified against the two things this app needs:
 * strict JSON-schema output, and enough context to hold a twenty-page syllabus.
 *
 * ## Why the prices are here
 *
 * Because the student is paying them. "Pick a model" is not a real choice without the number
 * beside it, and the difference is not small: on a twenty-page syllabus, extraction costs about
 * a penny on the fast tier and about eleven on the strongest one. Over five courses and three
 * reading passes that is 15¢ against $1.65 — still cheap, and a tenfold difference the person
 * paying is entitled to see before they choose.
 *
 * Prices are per million tokens, as listed by OpenRouter in August 2026. They will drift; the
 * comment beside each is the date it was checked, and a stale price is better than a hidden one.
 */

export interface ModelChoice {
  id: string;
  label: string;
  /** USD per million input tokens, as listed. */
  inputPerMillion: number;
  /** USD per million output tokens. */
  outputPerMillion: number;
  /** Context window in tokens, which decides how long a syllabus can be. */
  context: number;
  /** What this one is actually for, in the student's terms. */
  note: string;
}

/**
 * Checked against OpenRouter's listings on 8 August 2026.
 *
 * Ordered cheapest first, which is also the order of increasing capability.
 *
 * The default for *reading a syllabus* is the strongest one, not the first. Section 7 of
 * docs/10-syllabus-gotchas.md is forty pages of evidence that syllabi are genuinely hard to
 * parse — placeholder dates, two dates in one cell, duplicate week numbers, a schedule the
 * document only points at — and a misread date costs a student a deadline. At 33¢ for a whole
 * semester read three times, saving 30¢ by using a weaker reader is a false economy.
 *
 * The coach is the opposite: it runs on every message rather than five times a term, and it is
 * answering "what should I do next" rather than parsing a table. That stays on the fast tier.
 */
export const MODEL_CHOICES: readonly ModelChoice[] = [
  {
    id: "x-ai/grok-4.1-fast",
    label: "Grok 4.1 Fast",
    inputPerMillion: 0.2,
    outputPerMillion: 0.5,
    context: 2_000_000,
    note: "The cheapest that does everything this app needs. Pennies for a whole degree.",
  },
  {
    id: "x-ai/grok-4.3",
    label: "Grok 4.3",
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    context: 256_000,
    note: "Middle tier. Cheaper than 4.5 and usually as good on a plainly-written syllabus.",
  },
  {
    id: "x-ai/grok-4.5",
    label: "Grok 4.5",
    inputPerMillion: 2,
    outputPerMillion: 6,
    context: 256_000,
    note: "The strongest reader, and still under a dollar a semester. The default, because syllabi are hard.",
  },
] as const;

export const MODEL_IDS = MODEL_CHOICES.map((m) => m.id);

/**
 * Tokens one syllabus actually costs, measured rather than assumed.
 *
 * The first version of this guessed 30,000 input tokens per document and was roughly ten times
 * too high — it put ~11¢ per syllabus on the settings screen when the true figure is nearer 2¢,
 * which is exactly the sort of number a student makes a decision against. These come from the
 * four real Spring 2023 syllabi in `tools/e2e/semester4/`: 88,151 characters of pdf.js page text
 * across 40 pages, and the extraction JSON that came back from them.
 *
 * Input is charged on the page text plus prompt overhead; output on the JSON. Both divided by
 * 3.6 characters per token, which is what dense tabular English comes out at — prose runs nearer
 * 4, and rounding the wrong way here inflates the estimate rather than hiding it.
 */
const TOKENS_PER_SYLLABUS = { input: 7_000, output: 1_350 } as const;

/** A full course load. Four is what the corpus semester holds; five is the common case. */
const COURSES_PER_SEMESTER = 5;

/**
 * What reading a whole semester's syllabi costs, in cents.
 *
 * The semester is the unit the student actually decides against, and it is the only one that
 * survives rounding: per-syllabus, the cheap model costs less than a cent and the screen would
 * read "0¢", which tells nobody anything.
 *
 * `passes` is the number of independent readings — see `reconcileExtractions`. Three is the
 * setting worth paying for on a hard document, and this is what makes that affordable to
 * consider rather than a number nobody can estimate.
 */
export function centsPerSemester(model: ModelChoice, passes = 1, courses = COURSES_PER_SEMESTER): number {
  const dollars =
    ((TOKENS_PER_SYLLABUS.input * courses * passes) / 1_000_000) * model.inputPerMillion +
    ((TOKENS_PER_SYLLABUS.output * courses * passes) / 1_000_000) * model.outputPerMillion;
  return Math.ceil(dollars * 100);
}
