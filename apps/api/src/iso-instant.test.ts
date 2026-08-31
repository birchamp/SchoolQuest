import { describe, expect, it } from "vitest";
import { isoInstant, toCanonicalInstant } from "./iso-instant.js";

/**
 * The bug this guards, found in review: the API accepted an offset the editor could not read
 * back. A deadline stored as `2026-10-05T09:00:00-07:00` shows as `09:00` in the assignments
 * table, because the row reads the characters rather than the instant -- and blurring the field
 * saves `09:00Z`. Focus, tab away, change nothing, and the deadline has moved seven hours.
 */
describe("isoInstant", () => {
  it("rewrites an offset as the instant it names", () => {
    expect(toCanonicalInstant("2026-10-05T09:00:00-07:00")).toBe("2026-10-05T16:00:00.000Z");
    expect(toCanonicalInstant("2026-10-05T09:00:00+09:00")).toBe("2026-10-05T00:00:00.000Z");
  });

  it("leaves a value already in the stored spelling alone", () => {
    // Everything the app itself writes is already canonical; normalising must be a no-op there,
    // or every save would look like a change to anything watching.
    expect(toCanonicalInstant("2026-10-05T23:59:00.000Z")).toBe("2026-10-05T23:59:00.000Z");
  });

  it("survives the round trip the editor performs", () => {
    // Read the day and clock out by slicing, compose them back: for a canonical value this is
    // exactly what the assignments table does on focus and blur, and it must not move anything.
    const stored = toCanonicalInstant("2026-10-05T09:00:00-07:00");
    const recomposed = `${stored.slice(0, 10)}T${stored.slice(11, 16)}:00.000Z`;
    expect(recomposed).toBe(stored);
  });

  it("normalises through the schema, not just the helper", () => {
    expect(isoInstant.parse("2026-10-05T09:00:00-07:00")).toBe("2026-10-05T16:00:00.000Z");
  });

  it("still rejects what was never a datetime", () => {
    expect(isoInstant.safeParse("2026-10-05").success).toBe(false);
    expect(isoInstant.safeParse("next friday").success).toBe(false);
  });
});
