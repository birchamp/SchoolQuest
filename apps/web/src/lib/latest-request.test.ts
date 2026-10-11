import { describe, expect, it } from "vitest";
import { afterOvertaken, latestRequest } from "./latest-request";

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

  it("re-reads after an overtaken load committed a plan, and only then", () => {
    expect(afterOvertaken(true)).toBe("reread");
    expect(afterOvertaken(false)).toBe("drop");
  });

  it("ends on the newest plan when the older of two stale loads commits last", async () => {
    // A model of `loadPlan` against a server whose generate bumps the version. Load A reads a
    // stale plan and goes to generate; load B starts, reads the same stale plan, commits N+1 and
    // shows it. A lost the unique-index race, retried server-side and commits N+2 after B -- so
    // A's reread is overtaken, and without a fresh read N+1 stays on screen.
    const requests = latestRequest();
    let version = 5;
    let shown = 0;
    let generates = 0;
    const tick = () => new Promise<void>((r) => setTimeout(r, 0));
    let openGate!: () => void;
    const bCommitted = new Promise<void>((r) => (openGate = r));

    const load = async (opts: { beforeCommit?: Promise<void>; onCommit?: () => void }) => {
      const ticket = requests.begin();
      const current = version;
      await tick();
      if (!requests.isCurrent(ticket)) return;
      // Stale only before anything has been generated today: the fresh read finds today's plan.
      if (generates > 0 && !opts.beforeCommit && !opts.onCommit) {
        shown = current;
        return;
      }
      await (opts.beforeCommit ?? tick());
      version += 1;
      generates += 1;
      opts.onCommit?.();
      const reread = version;
      await tick();
      if (!requests.isCurrent(ticket)) {
        if (afterOvertaken(true) === "reread") await load({});
        return;
      }
      shown = reread;
    };

    const a = load({ beforeCommit: bCommitted });
    await tick(); // A's first read lands while it is still current.
    const b = load({ onCommit: openGate });
    await Promise.all([a, b]);

    expect(version).toBe(7);
    expect(shown).toBe(7);
    // The fresh read found today's plan and did not generate again: no loop.
    expect(generates).toBe(2);
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
