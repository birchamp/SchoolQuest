/**
 * Turning OpenRouter's live model catalogue into the short, priced list a student chooses from.
 *
 * ## Why this exists
 *
 * The choices used to be hand-typed here, with prices from a date in a comment. OpenRouter
 * renames and deprecates models continuously, so that list rotted: a model the settings screen
 * still offered would answer a real request with "this model is deprecated", and no amount of
 * re-typing fixes a list that is stale by construction. The catalogue is the source of truth,
 * so the catalogue is what we read.
 *
 * ## What this file is, and is not
 *
 * Pure. It takes a catalogue someone else fetched and returns a filtered, priced, ranked list.
 * The fetch, the cache and the fallback live in the API, because a Worker's 10ms CPU budget and
 * a network round-trip are not this file's concern; the filtering rules and the cost arithmetic,
 * which are what can be wrong in a way a student pays for, are.
 *
 * ## The two audiences, and why the coach is chosen for you
 *
 * Reading a syllabus is rare and hard, and a misread date costs a deadline — so the student
 * picks the reader, and the list defaults to the strongest one they can afford. The coach runs
 * on every message and answers "what should I do next", which a cheap-but-capable model does
 * well — so it is chosen automatically as the cheapest model above a capability floor, and a
 * deprecation there self-heals instead of surfacing as an error mid-conversation.
 */

/** One model as OpenRouter lists it. Only the fields we actually read; the payload has many more. */
export interface CatalogModel {
  id: string;
  name?: string;
  /** USD per *token*, as decimal strings — OpenRouter's format. "0" for the free tier. */
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
  /** Unix seconds the model was released, from OpenRouter's `created`. Absent on the fallback. */
  created?: number;
}

/** A model the student could pick, priced the way this app measures cost. */
export interface PricedModel {
  id: string;
  label: string;
  provider: ProviderKey;
  inputPerMillion: number;
  outputPerMillion: number;
  context: number;
  /** What a whole semester of reading costs on this model — the number the choice is made against. */
  centsPerSemester: number;
  centsPerSemesterThreePasses: number;
  /** Unix seconds the model was released, or null when the catalogue did not date it. */
  releasedAt: number | null;
}

/**
 * The provider families we trust for this app's two hard requirements: strict JSON-schema
 * output, and following a careful extraction prompt over a long document. OpenRouter carries
 * hundreds of models, many of which cannot do either; the prefix is how a model announces its
 * family, and confining the list to these four is what stops the picker offering something that
 * will fail as a schema error the student cannot diagnose.
 */
export const TRUSTED_PROVIDERS = {
  "google/": "Google",
  "anthropic/": "Anthropic",
  "openai/": "OpenAI",
  "x-ai/": "xAI",
} as const;

export type ProviderKey = (typeof TRUSTED_PROVIDERS)[keyof typeof TRUSTED_PROVIDERS];

function providerOf(id: string): ProviderKey | null {
  for (const [prefix, name] of Object.entries(TRUSTED_PROVIDERS)) {
    if (id.startsWith(prefix)) return name as ProviderKey;
  }
  return null;
}

/**
 * Variants that a trusted provider ships but that are never the right syllabus reader.
 *
 * Even confined to four providers under the price ceiling, OpenRouter's catalogue lists dozens
 * of rows per family: modality side-cars (audio, realtime, image, tts), retrieval and utility
 * endpoints (search, embedding, moderation, computer-use), and dated snapshots that only
 * duplicate the undated alias the provider keeps current. None of them is a better reader than
 * the plain flagship, and together they turn a choosable list into an unreadable one. Dropping
 * them is the difference between a picker a person scans and a wall they give up on.
 *
 * Matched on the part after the "provider/" prefix so a provider name can never trip a rule.
 * Substrings, not exact ids, because the variants are spelled a dozen ways -- "gpt-4o-audio-
 * preview", "gpt-4o-realtime-preview-2024-10-01" -- and every one carries its tell in the name.
 */
const EXCLUDED_VARIANT_MARKERS = [
  "audio",
  "realtime",
  "search",
  "tts",
  "image",
  "vision",
  "embedding",
  "moderation",
  "computer-use",
] as const;

/** A dated snapshot suffix: `-2024-08-06` or `-20240806`. The undated alias is kept instead. */
const DATED_SNAPSHOT = /-\d{4}-?\d{2}-?\d{2}$/;

/**
 * Whether a model id is a syllabus reader a student should ever be offered, as opposed to a
 * side-car variant, a utility endpoint, a rate-limited free tier, or a dated snapshot.
 */
export function isSelectableReader(id: string): boolean {
  if (id.includes(":free")) return false;
  const tail = id.slice(id.indexOf("/") + 1);
  if (DATED_SNAPSHOT.test(tail)) return false;
  return !EXCLUDED_VARIANT_MARKERS.some((marker) => tail.includes(marker));
}

/**
 * Tokens one syllabus actually costs, measured rather than assumed — the four real Spring 2023
 * syllabi in tools/e2e/semester4 (88,151 characters across 40 pages, plus the JSON that came
 * back). Input is the page text plus prompt overhead; output is the extraction JSON.
 */
const TOKENS_PER_SYLLABUS = { input: 7_000, output: 1_350 } as const;
const COURSES_PER_SEMESTER = 5;

/** OpenRouter prices per token; this app talks per million, which is the human-legible unit. */
function perMillion(price: string | undefined): number {
  const perToken = Number(price ?? "NaN");
  return Number.isFinite(perToken) ? perToken * 1_000_000 : Number.POSITIVE_INFINITY;
}

/**
 * What reading a whole semester's syllabi costs, in cents. The semester is the unit a student
 * decides against; per-syllabus the cheap tier rounds to "0¢" and tells nobody anything.
 */
export function semesterReadingCents(
  input: number,
  output: number,
  passes = 1,
  courses = COURSES_PER_SEMESTER,
): number {
  const dollars =
    ((TOKENS_PER_SYLLABUS.input * courses * passes) / 1_000_000) * input +
    ((TOKENS_PER_SYLLABUS.output * courses * passes) / 1_000_000) * output;
  return Math.ceil(dollars * 100);
}

export interface CatalogFilter {
  /** A model is offered only if its output price is at or below this, USD per million tokens. */
  maxOutputPerMillion: number;
  /** How many syllabi to price the semester against. */
  courses?: number;
}

/**
 * How old a released model may be and still be recommended.
 *
 * Price is a poor proxy for capability across generations: OpenRouter lists gpt-3.5-turbo years
 * after it was superseded, and the "strongest under the ceiling" auto-pick -- which really means
 * "priciest under the ceiling" -- happily chose it, because it is dearer than the current fast
 * tier while being far worse. Recency is the honest signal. Anything a provider shipped in the
 * last year or so is current enough to recommend; older than that, a better model in the same
 * price band almost always exists.
 */
export const MAX_RELEASE_AGE_MONTHS = 15;

/** Days per month, for turning a month window into a millisecond cutoff. Approximate on purpose. */
const DAYS_PER_MONTH = 30;

/**
 * The models recent enough to recommend, given the current time.
 *
 * A model is kept when it was released within the window, or when the catalogue did not date it
 * at all -- the offline fallback carries no dates, and a model we cannot date must not be dropped
 * on a guess. And if the window would empty the list (a catalogue entirely of older models, or a
 * clock skew), it is ignored: a stale recommendation still reads a syllabus, an empty picker does
 * nothing. Pure -- the caller supplies `now`, because this package never reads the wall clock.
 */
export function recentModels(
  catalog: readonly CatalogModel[],
  nowMs: number,
  months: number = MAX_RELEASE_AGE_MONTHS,
): CatalogModel[] {
  const cutoffSeconds = (nowMs - months * DAYS_PER_MONTH * 24 * 60 * 60 * 1000) / 1000;
  const kept = catalog.filter((m) => typeof m.created !== "number" || m.created >= cutoffSeconds);
  return kept.length > 0 ? kept : [...catalog];
}

/**
 * The reader's list: trusted providers, under the price ceiling, cheapest first.
 *
 * Cheapest first is also least-capable first as a rule, but the *default* the caller applies is
 * the strongest under the ceiling, not the head of this list — see `defaultReaderId`. Sorting
 * cheap-first is for the student scanning prices, not for the default.
 */
export function readerChoices(catalog: readonly CatalogModel[], filter: CatalogFilter): PricedModel[] {
  const courses = filter.courses ?? COURSES_PER_SEMESTER;
  const priced: PricedModel[] = [];
  for (const model of catalog) {
    const provider = providerOf(model.id);
    if (!provider) continue;
    // Trusted family is necessary but not sufficient: drop the side-car and snapshot variants
    // that make the list unreadable without removing any real reader.
    if (!isSelectableReader(model.id)) continue;
    const inputPerMillion = perMillion(model.pricing?.prompt);
    const outputPerMillion = perMillion(model.pricing?.completion);
    // A free model (price 0) is real, but a $0 model on this list is almost always a
    // rate-limited preview that will fail mid-semester; the floor of a fraction of a cent
    // keeps those off without excluding anything a student would actually rely on.
    if (!Number.isFinite(inputPerMillion) || !Number.isFinite(outputPerMillion)) continue;
    if (outputPerMillion > filter.maxOutputPerMillion) continue;
    if (outputPerMillion <= 0) continue;
    priced.push({
      id: model.id,
      label: model.name ?? model.id,
      provider,
      inputPerMillion,
      outputPerMillion,
      context: model.context_length ?? 0,
      centsPerSemester: semesterReadingCents(inputPerMillion, outputPerMillion, 1, courses),
      centsPerSemesterThreePasses: semesterReadingCents(inputPerMillion, outputPerMillion, 3, courses),
      releasedAt: typeof model.created === "number" ? model.created : null,
    });
  }
  // Cheapest first, by the blended per-syllabus cost so a model that is cheap in but dear out
  // sorts honestly. Ties break on id so the order is stable across fetches.
  return priced.sort(
    (a, b) =>
      a.centsPerSemester - b.centsPerSemester ||
      a.outputPerMillion - b.outputPerMillion ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The reader default: the strongest model under the ceiling, which here means the priciest
 * one still allowed. Syllabi are hard and reading is cheap at every tier (docs/10 §7), so the
 * default pays for accuracy on the one job where a mistake costs a deadline. Falls back to the
 * head of the list, then to nothing, so an empty catalogue never throws.
 */
export function defaultReaderId(choices: readonly PricedModel[]): string | null {
  if (choices.length === 0) return null;
  return choices[choices.length - 1]!.id;
}

/**
 * The output-price ceilings, in USD per million tokens, that define each job's budget.
 *
 * The reader is generous because reading is cheap even at the top of the range (a whole
 * semester read three times is under a dollar on a $15 model) and a misread date costs a
 * deadline. The coach is tighter because it runs on every message and so dominates the term's
 * cost — a daily planning chat is ~270 calls against six syllabus reads — but "what should I do
 * today" is a reasoning task, so the floor is a real model, not the rock bottom. At $5 the coach
 * is the strongest capable-fast tier and the whole term still lands near two dollars.
 */
export const CEILINGS = { reader: 15, coach: 5 } as const;

/**
 * The coach's model: the strongest one under the coach ceiling.
 *
 * This is deliberately `defaultReaderId` applied at a lower ceiling, not a separate rule. The
 * coach is chosen the same way the reader default is — the best the budget allows — because the
 * "capability floor" the student asked for is exactly what a ceiling-and-strongest expresses:
 * skip nothing cheap for its own sake, take the smartest model the coach budget buys. Choosing
 * it from the live catalogue is what makes a deprecation self-heal instead of erroring
 * mid-conversation.
 */
export function coachModelId(catalog: readonly CatalogModel[]): string | null {
  return defaultReaderId(readerChoices(catalog, { maxOutputPerMillion: CEILINGS.coach }));
}

/**
 * The guardrail's model: the cheapest trusted model there is.
 *
 * The guard only classifies a message as on- or off-topic, which the fast tier does perfectly,
 * and it runs on every message — so it takes the floor, where the reader default takes the
 * ceiling.
 */
export function guardModelId(catalog: readonly CatalogModel[]): string | null {
  const choices = readerChoices(catalog, { maxOutputPerMillion: CEILINGS.reader });
  return choices[0]?.id ?? null;
}
