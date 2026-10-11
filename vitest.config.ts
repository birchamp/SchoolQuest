import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      // `.tsx` too: component tests render JSX (see ThemeAndTab.test.tsx).
      "apps/*/src/**/*.test.{ts,tsx}",
      // The installer and launchers live outside src/ and are not imported by anything, so
      // nothing else here would ever look at them.
      "tools/**/*.test.ts",
      // Same position: the desktop release plumbing is run by a workflow, never imported.
      "apps/desktop/scripts/**/*.test.ts",
    ],
    environment: "node",
  },
});
