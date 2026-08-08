import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      // The installer and launchers live outside src/ and are not imported by anything, so
      // nothing else here would ever look at them.
      "tools/**/*.test.ts",
    ],
    environment: "node",
  },
});
