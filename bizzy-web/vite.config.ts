import { resolve } from "node:path";
import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    port: 4200,
  },
  resolve: {
    alias: {
      "~": resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    viteReact(),
    tailwindcss(),
    // Installable from the browser ("Add to Home Screen" on iOS). The service
    // worker keeps the whole build, so the app opens at once and offline, and
    // a deploy's new build waits until the user reloads (see UpdatePrompt):
    // never mid-form. Off in `vite dev`.
    VitePWA({
      registerType: "prompt",
      // UpdatePrompt's useRegisterSW registers it.
      injectRegister: false,
      manifest: {
        name: "Bizzy",
        short_name: "Bizzy",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // The light theme's background; index.html sets the theme's own.
        background_color: "#ffffff",
        theme_color: "#ffffff",
        // From `pnpm pwa:icons` (pwa-assets.config.ts).
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2}"],
        // Client routes get the app; the privacy page is its own document.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/privacy\.html$/],
      },
    }),
  ],
});
