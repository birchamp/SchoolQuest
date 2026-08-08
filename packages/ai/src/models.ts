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
 * Ordered cheapest first, which is also the order of increasing capability — the two happen to
 * agree here, and the default is the first entry rather than the best one.
 */
export const MODEL_CHOICES: readonly ModelChoice[] = [
  {
    id: "x-ai/grok-4.1-fast",
    label: "Grok 4.1 Fast",
    inputPerMillion: 0.2,
    outputPerMillion: 0.5,
    context: 2_000_000,
    note: "The cheapest that does everything this app needs. About a penny per syllabus.",
  },
  {
    id: "x-ai/grok-4.3",
    label: "Grok 4.3",
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    context: 256_000,
    note: "Middle tier. Worth trying if a syllabus with an awkward table keeps coming back wrong.",
  },
  {
    id: "x-ai/grok-4.5",
    label: "Grok 4.5",
    inputPerMillion: 2,
    outputPerMillion: 6,
    context: 256_000,
    note: "The strongest, and about ten times the price. Reserve it for documents that defeat the others.",
  },
] as const;

export const MODEL_IDS = MODEL_CHOICES.map((m) => m.id);

/**
 * What a student is charged for reading one syllabus, in cents.
 *
 * A twenty-page syllabus arrives as roughly 30,000 tokens of page text and leaves as roughly
 * 8,000 of JSON — measured on the corpus rather than assumed, since a schedule table is far
 * denser than prose. Rounded up, because a screen that under-promises a cost is worse than one
 * that over-promises it.
 */
export function centsPerSyllabus(model: ModelChoice, passes = 1): number {
  const inputTokens = 30_000 * passes;
  const outputTokens = 8_000 * passes;
  const dollars =
    (inputTokens / 1_000_000) * model.inputPerMillion +
    (outputTokens / 1_000_000) * model.outputPerMillion;
  return Math.ceil(dollars * 100);
}
