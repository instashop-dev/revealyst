import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findViolations } from "../scripts/check-org-scope.mjs";

// Self-test for the D1b CI guard: the mechanical form of "raw table access
// outside src/db/** is a review-blocker".

describe("check-org-scope guard", () => {
  it("flags schema imports outside src/db/**", () => {
    const violations = findViolations([
      {
        path: "src/app/evil/route.ts",
        content: `import { people } from "../../db/schema";`,
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/imports a schema module/);
  });

  it("flags auth-schema imports too", () => {
    const violations = findViolations([
      {
        path: "src/lib/sneaky.ts",
        content: `import { user } from "../db/auth-schema";`,
      },
    ]);
    expect(violations).toHaveLength(1);
  });

  it("flags createDb calls outside the entrypoint allowlist", () => {
    const violations = findViolations([
      {
        path: "src/app/api/foo/route.ts",
        content: `const db = createDb(env);`,
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/createDb outside the allowlisted/);
  });

  it("allows the tenancy seam and entrypoints", () => {
    const violations = findViolations([
      { path: "src/db/org-scope.ts", content: `import { people } from "./schema";` },
      { path: "src/worker.ts", content: `const db = createDb(env);` },
      { path: "src/lib/auth.ts", content: `createDb(env)` },
      { path: "src/lib/api-context.ts", content: `createDb(env)` },
    ]);
    expect(violations).toHaveLength(0);
  });

  it("passes against the real source tree", () => {
    const output = execFileSync("node", ["scripts/check-org-scope.mjs"], {
      encoding: "utf8",
    });
    expect(output).toContain("org-scope guard: clean");
  });
});
