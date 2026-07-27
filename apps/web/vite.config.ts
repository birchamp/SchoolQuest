import { defineConfig } from "vite";
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
const isTauri = Boolean(process.env["TAURI_ENV_PLATFORM"]);

export default defineConfig({
  plugins: [
    react(),
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
