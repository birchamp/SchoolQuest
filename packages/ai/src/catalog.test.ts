import { describe, expect, it } from "vitest";

import {
  CEILINGS,
  coachModelId,
  defaultReaderId,
  guardModelId,
  isSelectableReader,
  readerChoices,
  recentModels,
  semesterReadingCents,
  type CatalogModel,
} from "./catalog.js";

/**
 * A slice of OpenRouter's real `/api/v1/models` shape: id, name, per-token price strings, and
 * a context length. Prices are per token, which is why they look tiny -- $2/M output is
 * "0.000002". The fixture mixes trusted and untrusted providers, a free model, and a broken
 * price so the filter is exercised on the things that actually vary in the live payload.
 */
const CATALOG: CatalogModel[] = [
  { id: "x-ai/grok-fast", name: "Grok Fast", pricing: { prompt: "0.0000002", completion: "0.0000005" }, context_length: 2_000_000 },
  { id: "google/gemini-flash", name: "Gemini Flash", pricing: { prompt: "0.0000003", completion: "0.0000012" }, context_length: 1_000_000 },
  { id: "openai/gpt-mini", name: "GPT Mini", pricing: { prompt: "0.0000004", completion: "0.0000016" }, context_length: 400_000 },
  { id: "x-ai/grok-strong", name: "Grok Strong", pricing: { prompt: "0.000002", completion: "0.000006" }, context_length: 256_000 },
  { id: "anthropic/claude-sonnet", name: "Claude Sonnet", pricing: { prompt: "0.000003", completion: "0.000015" }, context_length: 200_000 },
  { id: "anthropic/claude-opus", name: "Claude Opus", pricing: { prompt: "0.000015", completion: "0.000075" }, context_length: 200_000 },
  // Not a trusted provider: must never appear.
  { id: "meta-llama/llama-cheap", name: "Llama", pricing: { prompt: "0.0000001", completion: "0.0000002" }, context_length: 128_000 },
  // Free preview: excluded, because a $0 model is a rate-limited trap mid-semester.
  { id: "google/gemini-free", name: "Gemini Free", pricing: { prompt: "0", completion: "0" }, context_length: 1_000_000 },
  // Malformed price: excluded rather than treated as free.
  { id: "openai/gpt-broken", name: "GPT Broken", pricing: { prompt: undefined, completion: "oops" }, context_length: 100_000 },
];

describe("isSelectableReader", () => {
  it("keeps the plain flagships", () => {
    for (const id of [
      "openai/gpt-4o",
      "openai/gpt-4.1-mini",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-2.5-pro",
      "x-ai/grok-4",
    ]) {
      expect(isSelectableReader(id)).toBe(true);
    }
  });

  it("drops modality side-cars and utility endpoints", () => {
    for (const id of [
      "openai/gpt-4o-audio-preview",
      "openai/gpt-4o-realtime-preview",
      "openai/gpt-4o-search-preview",
      "openai/gpt-4o-mini-tts",
      "openai/text-embedding-3-large",
      "openai/omni-moderation-latest",
      "anthropic/claude-3.5-sonnet-computer-use",
      "x-ai/grok-vision-beta",
      "google/imagen-3",
    ]) {
      expect(isSelectableReader(id)).toBe(false);
    }
  });

  it("drops dated snapshots but keeps the undated alias", () => {
    expect(isSelectableReader("openai/gpt-4o-2024-08-06")).toBe(false);
    expect(isSelectableReader("anthropic/claude-3-5-sonnet-20241022")).toBe(false);
    expect(isSelectableReader("openai/gpt-4o")).toBe(true);
  });

  it("drops the free tier", () => {
    expect(isSelectableReader("google/gemini-2.0-flash-exp:free")).toBe(false);
  });

  it("drops audio and video variants by name", () => {
    expect(isSelectableReader("openai/gpt-4o-video-preview")).toBe(false);
    expect(isSelectableReader("google/gemini-2.5-flash-audio")).toBe(false);
  });

  it("never trips on the provider name itself", () => {
    // "openai" contains no marker; a rule that matched the whole id rather than the tail could
    // wrongly drop a whole family. The tail is what is tested.
    expect(isSelectableReader("openai/gpt-4o")).toBe(true);
  });
});

describe("recentModels", () => {
  const NOW = Date.UTC(2026, 7, 19) / 1000; // seconds; matches OpenRouter's `created` unit
  const nowMs = NOW * 1000;
  const months = (n: number) => NOW - n * 30 * 24 * 60 * 60;

  it("drops models older than the window but keeps recent ones", () => {
    const catalog: CatalogModel[] = [
      { id: "openai/gpt-old", created: months(30) },
      { id: "openai/gpt-new", created: months(2) },
    ];
    expect(recentModels(catalog, nowMs).map((m) => m.id)).toEqual(["openai/gpt-new"]);
  });

  it("keeps undated models, since the fallback catalogue carries no dates", () => {
    const catalog: CatalogModel[] = [{ id: "x-ai/grok-undated" }, { id: "openai/gpt-old", created: months(40) }];
    expect(recentModels(catalog, nowMs).map((m) => m.id)).toContain("x-ai/grok-undated");
  });

  it("falls back to the whole list rather than empty when everything is old", () => {
    const catalog: CatalogModel[] = [
      { id: "openai/gpt-old", created: months(40) },
      { id: "x-ai/grok-old", created: months(50) },
    ];
    // A stale recommendation still reads a syllabus; an empty picker does nothing.
    expect(recentModels(catalog, nowMs)).toHaveLength(2);
  });
});

describe("readerChoices", () => {
  it("keeps only trusted providers under the ceiling, cheapest first", () => {
    const list = readerChoices(CATALOG, { maxOutputPerMillion: 15 });
    expect(list.map((m) => m.id)).toEqual([
      "x-ai/grok-fast",
      "google/gemini-flash",
      "openai/gpt-mini",
      "x-ai/grok-strong",
      "anthropic/claude-sonnet",
    ]);
  });

  it("drops the untrusted provider, the free model, and the broken price", () => {
    const ids = readerChoices(CATALOG, { maxOutputPerMillion: 100 }).map((m) => m.id);
    expect(ids).not.toContain("meta-llama/llama-cheap");
    expect(ids).not.toContain("google/gemini-free");
    expect(ids).not.toContain("openai/gpt-broken");
    // Opus is over $15 out but under $100, so a high ceiling admits it.
    expect(ids).toContain("anthropic/claude-opus");
  });

  it("drops a model that OpenRouter says outputs only non-text, whatever its name", () => {
    const catalog: CatalogModel[] = [
      {
        id: "openai/gpt-image",
        pricing: { prompt: "0.000001", completion: "0.000002" },
        outputModalities: ["image"],
      },
      {
        id: "openai/gpt-normal",
        pricing: { prompt: "0.000001", completion: "0.000002" },
        outputModalities: ["text"],
      },
    ];
    const ids = readerChoices(catalog, { maxOutputPerMillion: 100 }).map((m) => m.id);
    expect(ids).toEqual(["openai/gpt-normal"]);
  });

  it("excludes a model whose output price is over the ceiling", () => {
    const ids = readerChoices(CATALOG, { maxOutputPerMillion: 5 }).map((m) => m.id);
    // Grok Strong is $6 out, Sonnet $15 -- both gone at a $5 ceiling.
    expect(ids).toEqual(["x-ai/grok-fast", "google/gemini-flash", "openai/gpt-mini"]);
  });

  it("prices per million from per-token strings and labels the provider", () => {
    const strong = readerChoices(CATALOG, { maxOutputPerMillion: 15 }).find((m) => m.id === "x-ai/grok-strong")!;
    expect(strong.inputPerMillion).toBeCloseTo(2, 6);
    expect(strong.outputPerMillion).toBeCloseTo(6, 6);
    expect(strong.provider).toBe("xAI");
  });

  it("carries the per-semester reading cost so the picker shows a number, not a guess", () => {
    const fast = readerChoices(CATALOG, { maxOutputPerMillion: 15 }).find((m) => m.id === "x-ai/grok-fast")!;
    // 5 courses x (7000 in x $0.2/M + 1350 out x $0.5/M) = ~1.03c, ceils to 2.
    expect(fast.centsPerSemester).toBe(semesterReadingCents(0.2, 0.5));
    expect(fast.centsPerSemesterThreePasses).toBeGreaterThan(fast.centsPerSemester);
  });

  it("is stable across two identical catalogues", () => {
    const a = readerChoices(CATALOG, { maxOutputPerMillion: 15 });
    const b = readerChoices([...CATALOG].reverse(), { maxOutputPerMillion: 15 });
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });
});

describe("defaultReaderId", () => {
  it("is the strongest under the ceiling, not the cheapest", () => {
    // Syllabi are hard and reading is cheap at every tier, so the default pays for accuracy.
    const list = readerChoices(CATALOG, { maxOutputPerMillion: 15 });
    expect(defaultReaderId(list)).toBe("anthropic/claude-sonnet");
  });

  it("returns null on an empty list rather than throwing", () => {
    expect(defaultReaderId([])).toBeNull();
  });
});

describe("coachModelId", () => {
  it("is the strongest model under the coach ceiling, not the cheapest", () => {
    // At a $5 coach ceiling, grok-strong ($6 out) is excluded and gpt-mini ($1.6) is the
    // priciest that remains -- the smartest the coach budget buys, which is the point.
    expect(CEILINGS.coach).toBe(5);
    expect(coachModelId(CATALOG)).toBe("openai/gpt-mini");
  });

  it("stays under its own ceiling even when far pricier readers exist", () => {
    const coach = coachModelId(CATALOG)!;
    const priced = readerChoices(CATALOG, { maxOutputPerMillion: 100 }).find((m) => m.id === coach)!;
    expect(priced.outputPerMillion).toBeLessThanOrEqual(CEILINGS.coach);
  });

  it("returns null on an empty catalogue", () => {
    expect(coachModelId([])).toBeNull();
  });
});

describe("guardModelId", () => {
  it("is the cheapest trusted model, since it only classifies", () => {
    expect(guardModelId(CATALOG)).toBe("x-ai/grok-fast");
  });

  it("returns null on an empty catalogue", () => {
    expect(guardModelId([])).toBeNull();
  });
});
