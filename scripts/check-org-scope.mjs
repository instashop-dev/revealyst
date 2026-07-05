// Mechanical enforcement of the tenancy rule (CLAUDE.md): every
// application query goes through the org-scoped repository layer in
// src/db/org-scope.ts — raw table access outside src/db/** is a
// review-blocker, and with an agent fleet writing code independently,
// convention will not survive without a machine check (D1b,
// docs/decisions/0001). Runs in CI; exits 1 on any violation.
//
//   node scripts/check-org-scope.mjs
//
// Rules over src/**/*.ts(x):
//  1. Only src/db/** may import the schema modules (db/schema,
//     db/auth-schema) — table objects are how raw queries happen.
//  2. createDb may only be called from the allowlisted entrypoints below;
//     everything else must receive a Db or an OrgScopedDb.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SCHEMA_IMPORT_RE =
  /(?:import|export)[^;]*?from\s+["'][^"']*(?:db\/schema|db\/auth-schema|\.\/schema|\.\/auth-schema)["']/;
const CREATE_DB_RE = /\bcreateDb\s*\(/;

/** Files allowed to import schema modules (the tenancy seam itself). */
const SCHEMA_ZONE = ["src/db/"];
/** Files allowed to call createDb (request/queue entrypoints). */
const CREATE_DB_ALLOWLIST = new Set([
  "src/worker.ts",
  "src/lib/auth.ts",
  "src/app/dashboard/page.tsx",
  "src/db/client.ts", // its own definition
]);

export function findViolations(files) {
  const violations = [];
  for (const { path, content } of files) {
    const normalized = path.split(sep).join("/");
    const inSchemaZone = SCHEMA_ZONE.some((zone) =>
      normalized.startsWith(zone),
    );
    if (!inSchemaZone && SCHEMA_IMPORT_RE.test(content)) {
      violations.push(
        `${normalized}: imports a schema module outside src/db/** — go through forOrg() (src/db/org-scope.ts)`,
      );
    }
    if (!CREATE_DB_ALLOWLIST.has(normalized) && CREATE_DB_RE.test(content)) {
      violations.push(
        `${normalized}: calls createDb outside the allowlisted entrypoints (${[...CREATE_DB_ALLOWLIST].join(", ")})`,
      );
    }
  }
  return violations;
}

function collectFiles(dir, root) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full, root));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      files.push({
        path: relative(root, full),
        content: readFileSync(full, "utf8"),
      });
    }
  }
  return files;
}

const invokedDirectly = process.argv[1]?.endsWith("check-org-scope.mjs");
if (invokedDirectly) {
  const root = process.cwd();
  const violations = findViolations(collectFiles(join(root, "src"), root));
  if (violations.length > 0) {
    console.error("org-scope guard: raw table access detected\n");
    for (const v of violations) {
      console.error(`  ✗ ${v}`);
    }
    process.exit(1);
  }
  console.log("org-scope guard: clean");
}
