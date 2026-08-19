import {
  MODEL_CHOICES,
  readerChoices,
  recentModels,
  type CatalogModel,
  type PricedModel,
} from "@schoolquest/ai";
import type { Env } from "./env.js";

/**
 * OpenRouter's live model catalogue, fetched and cached.
 *
 * The list of models a student can pick, and the coach/guard defaults, used to be hardcoded
 * with prices from a date in a comment. OpenRouter renames and deprecates models continuously,
 * so that list went stale by construction: a model the picker still offered would answer a real
 * request with "this model is deprecated". The only durable fix is to read the catalogue itself.
 *
 * ## Cache
 *
 * `/api/v1/models` is a public endpoint (no key) that changes on the order of days, and this is
 * consulted on every coach and extraction request. Fetching it each time would add a network
 * round-trip to a message send and could rate-limit the deployment. So it is cached in module
 * scope, which a Worker isolate keeps warm across requests, with a TTL — one fetch per isolate
 * per few hours, not one per message.
 *
 * ## Fallback
 *
 * When the fetch fails — OpenRouter down, network blocked, a self-hosted box offline — the app
 * must still work. The fallback is the old hardcoded list: not ideal, possibly itself stale, but
 * the live path is what normally runs and the fallback only has to keep a degraded install from
 * breaking outright. Anything the student already saved, or an env override, takes precedence
 * over both.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4_000;

interface Cached {
  catalog: CatalogModel[];
  /** Epoch ms this was fetched. `Date.now()` is fine here — the API path already reads the wall clock. */
  at: number;
  /** True when this came from OpenRouter rather than the fallback, so a failed fetch can be retried sooner. */
  live: boolean;
}

let cache: Cached | null = null;

/** The hardcoded list, shaped as a catalogue, for when the live fetch cannot be had. */
function fallbackCatalog(): CatalogModel[] {
  return MODEL_CHOICES.map((m) => ({
    id: m.id,
    name: m.label,
    pricing: {
      prompt: String(m.inputPerMillion / 1_000_000),
      completion: String(m.outputPerMillion / 1_000_000),
    },
    context_length: m.context,
  }));
}

/** One OpenRouter model row; the payload carries more, but this is all we read. */
interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  context_length?: unknown;
  /** Unix seconds the model was released. Present on the live payload; drives recency. */
  created?: unknown;
  /** `{ output_modalities: ["text", ...] }` on the live payload; drives the text-only filter. */
  architecture?: { output_modalities?: unknown };
}

function normalize(raw: unknown): CatalogModel[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { data?: unknown }).data)) return [];
  const rows = (raw as { data: OpenRouterModel[] }).data;
  const out: CatalogModel[] = [];
  for (const row of rows) {
    if (typeof row?.id !== "string") continue;
    out.push({
      id: row.id,
      name: typeof row.name === "string" ? row.name : row.id,
      pricing: {
        prompt: typeof row.pricing?.prompt === "string" ? row.pricing.prompt : undefined,
        completion: typeof row.pricing?.completion === "string" ? row.pricing.completion : undefined,
      },
      context_length: typeof row.context_length === "number" ? row.context_length : undefined,
      created: typeof row.created === "number" ? row.created : undefined,
      outputModalities: Array.isArray(row.architecture?.output_modalities)
        ? row.architecture.output_modalities.filter((m): m is string => typeof m === "string")
        : undefined,
    });
  }
  return out;
}

async function fetchLive(env: Env): Promise<CatalogModel[] | null> {
  const base = env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/models`, { signal: controller.signal });
    if (!res.ok) return null;
    const models = normalize(await res.json());
    return models.length > 0 ? models : null;
  } catch {
    // A blocked host, a timeout, malformed JSON: all resolve to "use the fallback", never a throw.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The current catalogue, fresh within the TTL. Never throws and never returns empty: a failed
 * live fetch yields the fallback rather than nothing.
 */
export async function getCatalog(env: Env): Promise<CatalogModel[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.catalog;

  const live = await fetchLive(env);
  if (live) {
    cache = { catalog: live, at: now, live: true };
    return live;
  }

  // Keep serving a still-valid live cache over a fresh fallback if we have one.
  if (cache?.live) return cache.catalog;

  const fallback = fallbackCatalog();
  cache = { catalog: fallback, at: now, live: false };
  return fallback;
}

/**
 * The catalogue used for every recommendation -- the picker list and the auto-chosen coach and
 * guard -- with models too old to recommend pruned out. Recency is applied here, at the one place
 * the wall clock is available, so the pure catalog functions never have to read it. A failed live
 * fetch still yields the (undated) fallback, which `recentModels` keeps whole.
 */
export async function getReaderCatalog(env: Env): Promise<CatalogModel[]> {
  return recentModels(await getCatalog(env), Date.now());
}

/** The reader list the settings screen shows, priced, under the reader ceiling. */
export async function readerListFor(env: Env, maxOutputPerMillion: number): Promise<PricedModel[]> {
  return readerChoices(await getReaderCatalog(env), { maxOutputPerMillion });
}

/** Test seam: drop the cache so a test can control what the next call returns. */
export function resetCatalogCache(): void {
  cache = null;
}
