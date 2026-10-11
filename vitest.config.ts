import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      // The installer and launchers live outside src/ and are not imported by anything, so
      // nothing else here would ever look at them.
      "tools/**/*.test.ts",
    ],
    // Wall-clock CPU ceilings run on their own (`pnpm test:bench`, vitest.bench.config.ts).
    // Timed inside the parallel suite they measured whatever else the machine was doing and
    // failed on runs where the code had not changed (issue #30).
    exclude: [...configDefaults.exclude, "**/*.bench.test.ts"],
    environment: "node",
  },
});
