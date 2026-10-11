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
 * into the CSP by the same step that sets `VITE_API_URL`, and the two cannot drift. It also
 * replaces the development origins rather than joining them: a release talks to one API.
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

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const baseConfigPath = join(here, "..", "src-tauri", "tauri.conf.json");

/**
 * Replaces the CSP's connect-src with `'self'` plus `origin`, leaving every other directive
 * exactly as committed.
 *
 * The committed policy is the development one: `pnpm tauri dev` talks to `wrangler dev` on 8787,
 * and `*.workers.dev` covers any preview Worker. Those are load-bearing for the loop every
 * developer uses, which is why they stay in `tauri.conf.json`. A release built for one known API
 * origin needs none of them, and keeping them would let the installed app talk to a local port or
 * to any Worker on the shared `workers.dev` domain. So a release narrows connect-src to the one
 * origin it was built for instead of appending to the development list.
 */
export function withConnectSrc(csp, origin) {
  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);

  const narrowed = `connect-src 'self' ${origin}`;
  const index = directives.findIndex((d) => d.split(/\s+/)[0] === "connect-src");
  if (index === -1) directives.push(narrowed);
  else directives[index] = narrowed;
  return directives.join("; ");
}

/** The scheme and host of a URL, which is all a CSP source expression may carry. */
export function cspOrigin(apiUrl) {
  const url = new URL(apiUrl);
  // A path or query on the API base would be silently ignored by CSP while still being prefixed
  // onto every request by the client, so the two would disagree about what is allowed.
  return url.origin;
}

/**
 * The overlay for a given base config and arguments. Pure, so the release CSP can be tested
 * without running the script.
 */
export function buildOverlay(base, { apiUrl, thumbprint } = {}) {
  if (!apiUrl) throw new Error("--api-url is required");

  const overlay = {
    app: { security: { csp: withConnectSrc(base.app.security.csp, cspOrigin(apiUrl)) } },
  };

  if (thumbprint) {
    overlay.bundle = {
      windows: {
        certificateThumbprint: thumbprint.replace(/\s/g, "").toUpperCase(),
        // SHA-1 signatures have not been accepted by Windows for code signing since 2016.
        digestAlgorithm: "sha256",
      },
    };
  }

  return overlay;
}

function main(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) args.set(argv[i], argv[i + 1]);

  const base = JSON.parse(readFileSync(baseConfigPath, "utf8"));
  const overlay = buildOverlay(base, {
    apiUrl: args.get("--api-url"),
    thumbprint: args.get("--thumbprint"),
  });

  process.stdout.write(JSON.stringify(overlay) + "\n");
}

// Run only as a script, so the test can import the functions above without printing an overlay.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
