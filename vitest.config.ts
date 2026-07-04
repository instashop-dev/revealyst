import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // PGlite (WASM Postgres) cold-starts slowly, especially with several
    // test files initializing instances concurrently.
    hookTimeout: 60_000,
  },
});
