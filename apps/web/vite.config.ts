import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The version this bundle was built from, baked in so the diagnostics log a student copies can
 * name it. Read straight off package.json rather than an env var, which is only set when Vite is
 * launched through an npm/pnpm script -- the desktop launcher spawns it directly.
 */
const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
})();

/**
 * One build, two shells.
 *
 * The same bundle is served as the installable PWA and loaded by the Tauri desktop
 * window. Tauri sets TAURI_ENV_PLATFORM during its build, which is how we drop the
 * service worker from the desktop bundle — a desktop app caching itself offline is
 * redundant and makes updates confusing.
 */

/**
 * A way for the app to stop itself.
 *
 * Closing the browser tab stops nothing: both servers keep running, invisibly, and the next
 * launch trips over the ports they still hold. The only shutdown that existed was Ctrl-C in a
 * console window that a student has usually minimised and reasonably assumes is not their
 * problem -- so "how do I close this?" had no answer anywhere on screen.
 *
 * `configureServer` runs only when Vite is serving, so this route exists in development and is
 * absent from the built bundle the PWA and the packaged desktop app load. It signals the pid
 * `tools/dev.mjs` put in the environment, which is the same SIGTERM that Ctrl-C sends -- the
 * existing `stopAll` then takes both halves down cleanly, once.
 */
function shutdownRoute(): Plugin {
  return {
    name: "schoolquest-shutdown",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__shutdown", (req, res) => {
        // POST only, so a prefetch or a stray link cannot stop someone's app.
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        const pid = Number(process.env["SCHOOLQUEST_DEV_PID"]);
        res.setHeader("Content-Type", "application/json");

        if (!Number.isInteger(pid) || pid <= 0) {
          // Vite started on its own rather than under the launcher. Stopping just this half
          // would leave the API running, which is worse than saying so.
          res.statusCode = 501;
          res.end(JSON.stringify({ error: "not started by the SchoolQuest launcher" }));
          return;
        }

        res.end(JSON.stringify({ ok: true }));
        // After the response, so the browser is told before the server goes away.
        setTimeout(() => {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // Already gone. Nothing to stop, which is the outcome asked for.
          }
        }, 150);
      });
    },
  };
}

const isTauri = Boolean(process.env["TAURI_ENV_PLATFORM"]);

export default defineConfig({
  plugins: [
    react(),
    shutdownRoute(),
    ...(isTauri
      ? []
      : [
          VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["favicon.svg"],
            manifest: {
              name: "SchoolQuest",
              short_name: "SchoolQuest",
              description: "Know what to work on now, and trust that the rest is protected.",
              theme_color: "#1e1b4b",
              background_color: "#0b0b12",
              display: "standalone",
              orientation: "portrait",
              start_url: "/",
              icons: [
                { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
                { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
                {
                  src: "/icon-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "maskable",
                },
              ],
            },
            workbox: {
              globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
              // pdf.js is only reachable from syllabus upload, which is desktop-only.
              // Precaching ~470 KB into every phone install would be pure waste.
              globIgnores: ["**/pdf-*.js", "**/pdf.worker-*.{js,mjs}"],
              runtimeCaching: [
                {
                  // The plan is read constantly and changes rarely within a session:
                  // serve from cache immediately, refresh in the background.
                  urlPattern: /\/api\/(terms|plans)\//,
                  handler: "StaleWhileRevalidate",
                  options: {
                    cacheName: "plan-data",
                    expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
                  },
                },
                {
                  // Coach replies and mutations must never be served stale.
                  urlPattern: /\/api\/(coach|auth|work-sessions)/,
                  handler: "NetworkOnly",
                },
              ],
            },
          }),
        ]),
  ],

  server: {
    // Bind IPv4 loopback explicitly rather than letting Vite default to `localhost`.
    //
    // On Windows `localhost` resolves to IPv6 `::1` first, so a default-host Vite binds only to
    // `::1`. Everything else here speaks IPv4: `tools/dev.mjs` polls `127.0.0.1:5173` to know when
    // to open the browser and then opens `http://127.0.0.1:5173`, and the `/api` proxy below targets
    // `127.0.0.1:8787`. With Vite on `::1` only, that poll never connects -- so the desktop launcher
    // never opened a browser at all, even though the page was reachable if you typed `localhost:5173`
    // by hand (a browser falls back to IPv4; a raw socket to 127.0.0.1 does not). Pinning the host
    // lines Vite up with the rest of the stack. Invisible to CI, which never runs the Windows path.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // `wrangler dev` serves the Worker on 8787; this keeps cookies same-origin in dev.
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },

  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },

  build: {
    outDir: "dist",
    sourcemap: true,
    target: isTauri ? "esnext" : "es2020",
  },
});
