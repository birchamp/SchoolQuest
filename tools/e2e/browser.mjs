import { existsSync } from "node:fs";

/**
 * Where Chromium is, for every script under tools/e2e that drives the app.
 *
 * Three places, in order: `SQ_CHROMIUM` when someone points at a specific build; the browser
 * pre-installed in the hosted development container; and otherwise nothing, which lets
 * Playwright use the one `pnpm exec playwright install chromium` put where it looks by
 * default -- what CI does. The hard-coded container path used to be the only option, so the
 * same scripts could not run anywhere else.
 */
export function chromiumLaunchOptions() {
  const path = process.env.SQ_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null);
  return path ? { executablePath: path } : {};
}
