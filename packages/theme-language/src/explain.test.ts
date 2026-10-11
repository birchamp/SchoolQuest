import { describe, expect, it } from "vitest";
import type { ThemeName } from "@schoolquest/domain";
import {
  REASON_CODES,
  RISK_CODES,
  TRADEOFF_CODES,
  type ReasonCode,
  type RiskCode,
  type TradeoffCode,
} from "@schoolquest/planning-engine";
import {
  explainBlockKind,
  explainDayLoad,
  explainReason,
  explainRecommendation,
  explainRisk,
  explainTradeoff,
  plainDayLoad,
} from "./explain.js";
import { label, plainLabel } from "./tokens.js";

const THEMES: ThemeName[] = ["plain", "quest", "mission"];
const humanised = (code: string) => code.toLowerCase().replace(/_/g, " ");

describe("reason, tradeoff and risk codes", () => {
  it("words every reason code in every theme", () => {
    for (const code of REASON_CODES) {
      for (const theme of THEMES) {
        expect(explainReason(code, theme), `${code} (${theme})`).not.toBe(humanised(code));
      }
    }
  });

  it("words every tradeoff and risk code", () => {
    for (const code of TRADEOFF_CODES) expect(explainTradeoff(code), code).toMatch(/\.$/);
    for (const code of RISK_CODES) expect(explainRisk(code), code).not.toBe(humanised(code));
  });

  it("humanises a stored code it no longer knows rather than hiding it", () => {
    expect(explainReason("RETIRED_REASON" as ReasonCode)).toBe("retired reason");
    expect(explainRisk("RETIRED_RISK" as RiskCode)).toBe("retired risk");
    expect(explainTradeoff("RETIRED_TRADEOFF" as TradeoffCode)).toBeNull();
    // Inherited object keys are not wording.
    expect(explainRisk("constructor" as RiskCode)).toBe("constructor");
  });

  it("has nothing to say about a block with no tradeoff", () => {
    expect(explainTradeoff(null)).toBeNull();
  });

  it("defaults to plain wording", () => {
    expect(explainReason("DEADLINE_IMMINENT")).toBe(explainReason("DEADLINE_IMMINENT", "plain"));
  });
});

describe("explainRecommendation", () => {
  it("says only what to work on when there is no reason", () => {
    expect(explainRecommendation("Essay", [])).toBe("Work on Essay.");
  });

  it("joins one, two and three reasons as a sentence", () => {
    const a = explainReason("DEADLINE_IMMINENT");
    const b = explainReason("HIGH_ACADEMIC_VALUE");
    const c = explainReason("FITS_AVAILABLE_TIME");
    expect(explainRecommendation("Essay", ["DEADLINE_IMMINENT"])).toBe(`Work on Essay because ${a}.`);
    expect(explainRecommendation("Essay", ["DEADLINE_IMMINENT", "HIGH_ACADEMIC_VALUE"])).toBe(
      `Work on Essay because ${a}, and ${b}.`,
    );
    expect(
      explainRecommendation("Essay", ["DEADLINE_IMMINENT", "HIGH_ACADEMIC_VALUE", "FITS_AVAILABLE_TIME"]),
    ).toBe(`Work on Essay because ${a}, ${b}, and ${c}.`);
  });

  it("caps the justification at three reasons", () => {
    const four: ReasonCode[] = [
      "DEADLINE_IMMINENT",
      "HIGH_ACADEMIC_VALUE",
      "FITS_AVAILABLE_TIME",
      "SPACED_PRACTICE",
    ];
    expect(explainRecommendation("Essay", four)).not.toContain(explainReason("SPACED_PRACTICE"));
  });

  it("does not mutate the caller's codes", () => {
    const codes: ReasonCode[] = ["DEADLINE_IMMINENT", "HIGH_ACADEMIC_VALUE"];
    explainRecommendation("Essay", codes);
    expect(codes).toEqual(["DEADLINE_IMMINENT", "HIGH_ACADEMIC_VALUE"]);
  });
});

describe("themed wording keeps a plain reading underneath", () => {
  it("gives every block kind a plain name under any theme", () => {
    const kind = explainBlockKind("back_to_back", "quest");
    expect(kind.name).toBe("Gauntlet");
    expect(kind.plainName).toBe("Back-to-back");
  });

  it("shows an unknown block kind as its code rather than inventing a name", () => {
    expect(explainBlockKind("new_kind", "quest")).toEqual({
      name: "new_kind",
      hint: "",
      plainName: "new_kind",
    });
  });

  it("reads day load plainly for screen readers whatever the theme", () => {
    expect(explainDayLoad("heavy", "quest")).toBe("Perilous");
    expect(plainDayLoad("heavy")).toBe("Heavy");
  });

  it("returns plain labels from plainLabel", () => {
    expect(plainLabel("course")).toBe(label("course", "plain"));
  });
});
