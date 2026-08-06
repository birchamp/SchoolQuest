import { describe, expect, it } from "vitest";
import { REASON_CODES, RISK_CODES } from "@schoolquest/planning-engine";
import { explainReason, explainRisk } from "@schoolquest/theme-language";

/**
 * Every code the engine can emit has a sentence written for it.
 *
 * `explainRisk` and `explainReason` fall back to the raw code, lowercased with the underscores
 * swapped for spaces, when they have nothing to say. That fallback is the right behaviour — a
 * screen that prints "paced to deadline" is better than one that prints nothing, or throws — but
 * it is silent, and it looks *almost* like a sentence, so it survives review.
 *
 * It survived here. `PACED_TO_DEADLINE` had been emitted at safe level since the pacing work
 * landed, and on Today it read "paced to deadline · 4 items", lowercase and unpunctuated,
 * sitting among four proper sentences. Nobody noticed because nothing checked, and this package
 * had no test file at all.
 *
 * The check is one line per direction and it closes the whole class: add a code without wording
 * and this fails before it reaches a screen.
 */

describe("the words shown for every engine code", () => {
  it("has a written sentence for every risk", () => {
    const missing = RISK_CODES.filter((code) => explainRisk(code) === humanised(code));
    expect(missing).toEqual([]);
  });

  it("has written wording for every reason, in every theme", () => {
    const missing: string[] = [];
    for (const code of REASON_CODES) {
      for (const theme of ["plain", "quest", "mission"] as const) {
        if (explainReason(code, theme) === humanised(code)) missing.push(`${code} (${theme})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("still falls back rather than failing on a code it has never seen", () => {
    // Forward compatibility matters more than tidiness here: an older client reading a newer
    // plan must render something, not crash or show an empty row.
    expect(explainRisk("SOME_FUTURE_CODE")).toBe("some future code");
  });
});

/** What the fallback produces — matching it means no sentence was ever written. */
function humanised(code: string): string {
  return code.toLowerCase().replace(/_/g, " ");
}
