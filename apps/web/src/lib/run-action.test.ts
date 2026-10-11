import { describe, expect, it } from "vitest";
import { errorMessage, runAction } from "./run-action";

describe("errorMessage", () => {
  it("uses the thrown error's own message", () => {
    expect(errorMessage(new Error("The server is busy."), "fallback")).toBe("The server is busy.");
  });

  it("falls back for something that is not an Error", () => {
    expect(errorMessage("nope", "That did not save.")).toBe("That did not save.");
    expect(errorMessage(undefined, "That did not save.")).toBe("That did not save.");
  });

  it("falls back for an Error with no message, rather than showing a blank line", () => {
    expect(errorMessage(new Error("  "), "That did not save.")).toBe("That did not save.");
  });
});

describe("runAction", () => {
  function recorder() {
    const reports: (string | null)[] = [];
    return { reports, report: (m: string | null) => reports.push(m) };
  }

  it("clears the last failure, runs the action, and says it worked", async () => {
    const { reports, report } = recorder();
    let ran = false;
    const ok = await runAction(
      async () => {
        ran = true;
      },
      "fallback",
      report,
    );
    expect(ok).toBe(true);
    expect(ran).toBe(true);
    expect(reports).toEqual([null]);
  });

  it("catches a rejection and reports it instead of letting it escape", async () => {
    const { reports, report } = recorder();
    const ok = await runAction(
      () => Promise.reject(new Error("Could not reach the server.")),
      "fallback",
      report,
    );
    expect(ok).toBe(false);
    expect(reports).toEqual([null, "Could not reach the server."]);
  });

  it("catches a synchronous throw too", async () => {
    const { reports, report } = recorder();
    const ok = await runAction(
      () => {
        throw "bare string";
      },
      "Your plan could not be rebuilt.",
      report,
    );
    expect(ok).toBe(false);
    expect(reports.at(-1)).toBe("Your plan could not be rebuilt.");
  });
});
