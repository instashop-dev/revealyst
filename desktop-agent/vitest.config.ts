import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Desktop-agent test config — run from this directory only. The repo-root
// Vitest config does NOT pick up this tree (its include globs cover src/,
// tests/, and packages/*/tests only).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
