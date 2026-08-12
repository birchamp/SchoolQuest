import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

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
    port: 5173,
    strictPort: true,
    proxy: {
      // `wrangler dev` serves the Worker on 8787; this keeps cookies same-origin in dev.
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },

  build: {
    outDir: "dist",
    sourcemap: true,
    target: isTauri ? "esnext" : "es2020",
  },
});
