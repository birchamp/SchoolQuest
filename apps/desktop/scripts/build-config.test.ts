import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @ts-expect-error - plain .mjs run by the Windows installer workflow, no declaration file
import { buildOverlay, withConnectSrc } from "./build-config.mjs";

type Overlay = {
  app: { security: { csp: string } };
  bundle?: { windows: { certificateThumbprint: string; digestAlgorithm: string } };
};

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(here, "..", "src-tauri", "tauri.conf.json"), "utf8"));
const committedCsp: string = base.app.security.csp;

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.split(/\s+/)[0] === name);
}

describe("release CSP", () => {
  it("keeps the development origins in the committed config", () => {
    // `pnpm tauri dev` reads tauri.conf.json directly and talks to wrangler on 8787.
    const connect = directive(committedCsp, "connect-src") ?? "";
    expect(connect).toContain("http://localhost:8787");
    expect(connect).toContain("https://*.workers.dev");
  });

  it("narrows connect-src to the API origin a release is built for", () => {
    const overlay = buildOverlay(base, {
      apiUrl: "https://api.schoolquest.example/v1?x=1",
    }) as Overlay;
    const csp = overlay.app.security.csp;

    expect(directive(csp, "connect-src")).toBe(
      "connect-src 'self' https://api.schoolquest.example",
    );
    expect(csp).not.toContain("8787");
    expect(csp).not.toContain("*.workers.dev");
  });

  it("leaves every other directive as committed", () => {
    const csp = (buildOverlay(base, { apiUrl: "https://a.example" }) as Overlay).app.security.csp;
    for (const name of ["default-src", "img-src", "style-src"]) {
      expect(directive(csp, name)).toBe(directive(committedCsp, name));
    }
  });

  it("adds connect-src when the policy has none", () => {
    expect(withConnectSrc("default-src 'self'", "https://a.example")).toBe(
      "default-src 'self'; connect-src 'self' https://a.example",
    );
  });

  it("refuses to build without an API origin", () => {
    expect(() => buildOverlay(base, {})).toThrow(/--api-url/);
  });

  it("adds signing keys only when given a thumbprint", () => {
    expect((buildOverlay(base, { apiUrl: "https://a.example" }) as Overlay).bundle).toBeUndefined();
    const signed = buildOverlay(base, {
      apiUrl: "https://a.example",
      thumbprint: "ab cd ef",
    }) as Overlay;
    expect(signed.bundle?.windows).toEqual({
      certificateThumbprint: "ABCDEF",
      digestAlgorithm: "sha256",
    });
  });
});
