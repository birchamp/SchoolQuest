import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The service worker must never answer an API read from cache while the network is there.
 *
 * Every write in the app is followed by a read of the same term or plan, and a cache-first
 * rule hands that read the state from before the write: the record is saved and the screen
 * says it is not (issue #6). Pinned against the config's text because the built worker is
 * not something a unit test can run; the rule is what decides the behaviour.
 */
describe("PWA runtime caching", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  const runtime = config.slice(config.indexOf("runtimeCaching"));

  it("reads term and plan data network-first", () => {
    expect(runtime).toContain('handler: "NetworkFirst"');
    expect(runtime).not.toContain("StaleWhileRevalidate");
    expect(runtime).not.toContain('"CacheFirst"');
  });

  it("still refuses to cache coach replies, sign-in and session writes at all", () => {
    expect(runtime).toMatch(/coach\|auth\|work-sessions[\s\S]{0,80}NetworkOnly/);
  });
});
