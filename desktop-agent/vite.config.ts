import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the Tauri webview frontend. The dev server port must match
// `build.devUrl` in src-tauri/tauri.conf.json.
export default defineConfig({
  plugins: [react()],
  // Inline PostCSS config: without this, Vite's config search walks UP past
  // desktop-agent/ and loads the repo root's postcss.config.mjs (Tailwind),
  // whose plugin is not in this tree's node_modules — CI-only build failure,
  // masked locally by the root node_modules.
  css: {
    postcss: { plugins: [] },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
