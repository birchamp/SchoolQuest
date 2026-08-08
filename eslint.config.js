import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/src-tauri/target/**",
      "**/drizzle/**",
      // Same scratch patterns .gitignore carries. Flat config does not read .gitignore,
      // so without these an untracked throwaway script under tools/ fails `pnpm lint`
      // for the whole workspace.
      "tools/**/.*.mjs",
      "tools/**/_tmp*",
      "tools/**/*.tmp.*",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The e2e harness is plain Node ESM, not app code: it has no tsconfig and lives
    // outside every workspace package, so it was picking up the default browser-less
    // globals and failing on `process`, `console`, and `fetch`.
    files: ["tools/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        // These run inside `page.evaluate`, so they execute in the browser even though
        // the file itself is a Node script.
        document: "readonly",
        getComputedStyle: "readonly",
        localStorage: "readonly",
        // Node 18+ ships the web upload primitives; the semester runner posts a real
        // multipart PDF through them, exactly as the browser does.
        FormData: "readonly",
        Blob: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    // Release plumbing, in the same position as the e2e harness above: plain Node ESM with no
    // tsconfig, run by the Windows installer workflow rather than bundled into anything.
    files: ["apps/desktop/scripts/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
