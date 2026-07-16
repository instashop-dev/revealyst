// Desktop Agent diagnostics-contract fixture (Desktop Agent plan T4.3; law 3/4).
//
// The desktop agent's "Send diagnostics" builder
// (`desktop-agent/src-tauri/src/diagnostics.rs`) POSTs a counts/versions/
// states/sanitized-logs bundle to `POST /api/desktop/diagnostics`. That body
// must match the STRICT `diagnosticBundleSchema` shape exactly
// (`src/lib/desktop-diagnostics.ts`). The Rust `DiagnosticBundle` struct is
// hand-mirrored; this script emits the canonical fixture the Rust contract test
// round-trips against, produced by PARSING the example through the real zod
// schema — so the fixture is, by construction, exactly what the schema accepts
// and emits. If the schema changes, this render changes, and both the Rust
// struct and the drift test must be updated together.
//
// Run with the repo's standard TS-script runner:
//
//   npm run generate:desktop-diagnostics-fixture
//
// Output is DETERMINISTIC — object keys sorted deeply, 2-space indent, trailing
// newline, LF endings — so `tests/desktop-diagnostics-fixture-drift.test.ts`
// can compare the checked-in artifact byte-for-byte against a fresh render.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { diagnosticBundleSchema } from "../src/lib/desktop-diagnostics";

export const DIAGNOSTICS_FIXTURE_RELATIVE_PATH = path.join(
  "desktop-agent",
  "src-tauri",
  "fixtures",
  "desktop-diagnostics-bundle.json",
);

/**
 * A canonical bundle. Every value is a legal member of the strict schema
 * (enums, version/slug patterns, bounded ints, an ISO-8601 datetime, and
 * already-scrubbed log lines) so the parse below is an identity transform. The
 * OPTIONAL `queueCounts.uploaded`/`failed` are deliberately omitted — the Rust
 * builder does not populate them in Phase 1, so leaving them off keeps the
 * fixture equal to what the Rust struct serializes (both sides omit them).
 */
const EXAMPLE = {
  agentVersion: "0.1.0",
  platform: "macos",
  architecture: "arm64",
  connectorStates: [
    { id: "claude_code", state: "ready" },
    { id: "cursor", state: "collecting" },
  ],
  queueCounts: { pending: 3, quarantined: 2 },
  lastSuccessfulSync: "2026-07-16T12:34:56.000Z",
  configVersion: 7,
  policyVersion: "0",
  updateState: "up_to_date",
  logTail: ["healthy line", "another healthy line"],
};

/** Recursively sort object keys so the render is order-independent. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])]),
    );
  }
  return value;
}

/**
 * Render the diagnostics fixture as the exact string checked in at
 * `desktop-agent/src-tauri/fixtures/desktop-diagnostics-bundle.json`. Pure — the
 * drift test calls this directly and compares bytes. The example is PARSED
 * through the strict schema first, so a value the schema would reject can never
 * be committed as a "valid" fixture.
 */
export function renderDiagnosticsFixtureJson() {
  const parsed = diagnosticBundleSchema.parse(EXAMPLE);
  return `${JSON.stringify(sortKeysDeep(parsed), null, 2)}\n`;
}

function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const outPath = path.join(repoRoot, DIAGNOSTICS_FIXTURE_RELATIVE_PATH);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderDiagnosticsFixtureJson(), "utf8");
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
