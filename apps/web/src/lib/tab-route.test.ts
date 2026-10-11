import { describe, expect, it } from "vitest";
import { DEFAULT_TAB, TABS, tabFromHash } from "./tab-route";

describe("tabFromHash", () => {
  it("reads every tab back from its own hash", () => {
    for (const tab of TABS) expect(tabFromHash(`#${tab}`)).toBe(tab);
  });

  it("accepts the hash without its leading #", () => {
    expect(tabFromHash("week")).toBe("week");
  });

  it("lands on the radar for an empty, unknown or stale hash", () => {
    expect(DEFAULT_TAB).toBe("radar");
    expect(tabFromHash("")).toBe("radar");
    expect(tabFromHash("#")).toBe("radar");
    expect(tabFromHash("#calendar")).toBe("radar");
    expect(tabFromHash("#Week")).toBe("radar");
  });
});
