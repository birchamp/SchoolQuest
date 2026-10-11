import { describe, expect, it } from "vitest";
import { latestRequest } from "./latest-request";

describe("latestRequest", () => {
  it("lets a lone request write its answer", () => {
    const requests = latestRequest();
    const ticket = requests.begin();
    expect(requests.isCurrent(ticket)).toBe(true);
  });

  it("drops an older response that arrives after a newer request started", async () => {
    const requests = latestRequest();
    let shown: string | null = null;
    const load = async (answer: string, delayMs: number) => {
      const ticket = requests.begin();
      await new Promise((r) => setTimeout(r, delayMs));
      if (requests.isCurrent(ticket)) shown = answer;
    };
    // The focus reload starts first and answers last; the save's reload must win.
    await Promise.all([load("older", 20), load("newer", 1)]);
    expect(shown).toBe("newer");
  });

  it("keeps separate counters apart", () => {
    const a = latestRequest();
    const b = latestRequest();
    const ticket = a.begin();
    b.begin();
    b.begin();
    expect(a.isCurrent(ticket)).toBe(true);
  });
});
