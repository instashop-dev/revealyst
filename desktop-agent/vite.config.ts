import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the Tauri webview frontend. The dev server port must match
// `build.devUrl` in src-tauri/tauri.conf.json.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
