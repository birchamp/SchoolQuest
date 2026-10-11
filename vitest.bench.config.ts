import { defineConfig } from "vitest/config";

/**
 * The CPU ceilings (`*.bench.test.ts`), kept out of `pnpm test` (issue #30).
 *
 * They assert wall-clock time, so they run one file at a time with nothing else in the process
 * pool competing for the CPU they are measuring. Each still warms up and judges its fastest run
 * (be0f57a): a real regression is slow on every run, noise is not.
 */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.bench.test.ts", "apps/*/src/**/*.bench.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
