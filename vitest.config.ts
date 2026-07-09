import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // `@/` component/lib code is normally NOT resolvable at Vitest runtime
    // (see CLAUDE.md's "Vitest resolves @/ only under tsc/Next" gotcha), so
    // most suites use relative imports instead. The new src/components/ui/*
    // wrappers follow the existing shadcn convention of `@/lib/utils` and
    // `@/components/ui/*` imports, so tests that render them need this
    // alias — added here rather than converting the components to relative
    // imports, which would break style-parity with tooltip.tsx/dialog.tsx.
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
      "packages/*/tests/**/*.test.ts",
    ],
    // PGlite (WASM Postgres) cold-starts slowly, especially with several
    // test files initializing instances concurrently.
    hookTimeout: 60_000,
    // Default environment stays "node" for the existing DB/API/scoring
    // suites (Vitest 4 dropped `environmentMatchGlobs`); component tests
    // opt into jsdom individually via a `// @vitest-environment jsdom`
    // pragma at the top of the file (see src/components/**/*.test.tsx).
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
