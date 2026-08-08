#!/usr/bin/env node
/**
 * Emits the `--config` overlay that `tauri build` merges over `tauri.conf.json`.
 *
 * Two things about a release build cannot live in the committed config, for opposite reasons.
 *
 * The API origin cannot, because it is not known until the build runs — and it is not enough to
 * set `VITE_API_URL` and stop there. A packaged Tauri window enforces `app.security.csp`, whose
 * `connect-src` in the committed config lists localhost and `*.workers.dev`. Point a build at an
 * API on a custom domain and the bundle is correct, the Worker is up, and every request is killed
 * by the webview before it leaves the machine. There is no status code and no console entry a
 * student would find; it reads as "nothing loads". So the origin the app was built for is written
 * into the CSP by the same step that sets `VITE_API_URL`, and the two cannot drift.
 *
 * The signing certificate cannot, because it is a secret. Passing the thumbprint here means the
 * repository holds no reference to a certificate it does not have: with no thumbprint the overlay
 * simply omits the signing keys and the build produces the same unsigned installer as before.
 *
 * The overlay is printed on one line so it can be handed to `tauri build --config` as a literal
 * argument. The CLI accepts either a JSON string or a path, but only the string form means the
 * same thing from every working directory and under both shells on a Windows runner.
 *
 *   pnpm tauri build --config "$(node scripts/build-config.mjs --api-url <origin>)"
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const baseConfigPath = join(here, "..", "src-tauri", "tauri.conf.json");

/**
 * Adds `origin` to the CSP's connect-src, leaving the rest of the policy exactly as committed.
 *
 * Rewriting the one directive rather than replacing the whole policy matters because the local
 * development origins in it are load-bearing: `pnpm tauri dev` talks to `wrangler dev` on 8787,
 * and a release-shaped CSP would break the loop every developer uses.
 */
function withConnectSrc(csp, origin) {
  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);

  const index = directives.findIndex((d) => d.startsWith("connect-src"));
  if (index === -1) return `${csp}; connect-src 'self' ${origin}`;

  const existing = directives[index].split(/\s+/);
  if (existing.includes(origin)) return csp;

  directives[index] = `${directives[index]} ${origin}`;
  return directives.join("; ");
}

/** The scheme and host of a URL, which is all a CSP source expression may carry. */
function cspOrigin(apiUrl) {
  const url = new URL(apiUrl);
  // A path or query on the API base would be silently ignored by CSP while still being prefixed
  // onto every request by the client, so the two would disagree about what is allowed.
  return url.origin;
}

function main(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) args.set(argv[i], argv[i + 1]);

  const apiUrl = args.get("--api-url");
  if (!apiUrl) throw new Error("--api-url is required");

  const base = JSON.parse(readFileSync(baseConfigPath, "utf8"));
  const overlay = {
    app: { security: { csp: withConnectSrc(base.app.security.csp, cspOrigin(apiUrl)) } },
  };

  const thumbprint = args.get("--thumbprint");
  if (thumbprint) {
    overlay.bundle = {
      windows: {
        certificateThumbprint: thumbprint.replace(/\s/g, "").toUpperCase(),
        // SHA-1 signatures have not been accepted by Windows for code signing since 2016.
        digestAlgorithm: "sha256",
      },
    };
  }

  process.stdout.write(JSON.stringify(overlay) + "\n");
}

main(process.argv.slice(2));
