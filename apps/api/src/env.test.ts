import { describe, expect, it } from "vitest";
import { isDevMode } from "./env.js";

/**
 * The flag that unlocks on-screen sign-in links, error detail and a client-chosen clock.
 *
 * It used to be inferred from "no mail provider configured", which a public deployment can
 * satisfy by accident. Only an explicit value may turn it on.
 */
describe("isDevMode", () => {
  it("is off when nothing set it, whatever the mail configuration", () => {
    expect(isDevMode({})).toBe(false);
    expect(isDevMode({ DEV_MODE: undefined })).toBe(false);
    expect(isDevMode({ DEV_MODE: "" })).toBe(false);
    expect(isDevMode({ DEV_MODE: "false" })).toBe(false);
    expect(isDevMode({ DEV_MODE: "yes" })).toBe(false);
  });

  it("is on only for the values the dev scripts pass", () => {
    expect(isDevMode({ DEV_MODE: "true" })).toBe(true);
    expect(isDevMode({ DEV_MODE: "1" })).toBe(true);
  });
});
