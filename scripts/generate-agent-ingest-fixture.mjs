// Desktop Agent ingest-contract fixture (Desktop Agent plan T4.1; law 3/4).
//
// The desktop sync engine (`desktop-agent/src-tauri/src/sync/`) POSTs a
// day-aggregate body to the EXISTING `POST /api/agent/ingest` endpoint
// (D-DA-3: day-aggregates ride the existing pipe, no new endpoint). That body
// must match the FROZEN `agentIngestRequestSchema` shape exactly (contracts-v1,
// `src/contracts/api.ts`). The Rust struct is hand-mirrored; this script emits
// the canonical fixture the Rust contract test round-trips against, and it is
// produced by PARSING the example through the frozen zod schema — so the
// fixture is, by construction, exactly what the schema accepts and emits
// (defaults applied). If the frozen schema changes, this render changes, and
// both the Rust struct and the drift test must be updated in the same ADR.
//
// Run with the repo's standard TS-script runner (this .mjs imports a .ts
// module, which plain `node` cannot resolve):
//
//   npm run generate:desktop-ingest-fixture   (= tsx scripts/generate-agent-ingest-fixture.mjs)
//
// Output is DETERMINISTIC — object keys sorted deeply, 2-space indent,
// trailing newline, LF endings (pinned by .gitattributes) — so
// `tests/desktop-ingest-fixture-drift.test.ts` can compare the checked-in
// artifact byte-for-byte against a fresh render.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { agentIngestRequestSchema } from "../src/contracts/api";

export const INGEST_FIXTURE_RELATIVE_PATH = path.join(
  "desktop-agent",
  "src-tauri",
  "fixtures",
  "agent-ingest-request.json",
);

/**
 * A canonical two-day, single-person day-aggregate. The ORDER of the arrays
 * here is the order the Rust batch builder produces from an equivalent queue
 * (subjects deduped in first-seen order; records concatenated per event in
 * event order; window = min/max day) — the Rust builder test compares against
 * this fixture element-by-element, so keep the two in lockstep.
 *
 * Every value is a legal member of the frozen enums (metricKey, attribution,
 * subject kind, gap kind, sourceGranularity) so the schema parse below is an
 * identity transform rather than a rejection.
 */
const EXAMPLE = {
  agentVersion: "0.1.0",
  summarizerVersion: 1,
  window: { start: "2026-07-15", end: "2026-07-16" },
  subjects: [
    {
      kind: "person",
      externalId: "user-abc",
      email: null,
      displayName: null,
    },
  ],
  records: [
    {
      subject: { kind: "person", externalId: "user-abc" },
      metricKey: "prompts",
      day: "2026-07-15",
      dim: "",
      value: 12,
      attribution: "person",
    },
    {
      subject: { kind: "person", externalId: "user-abc" },
      metricKey: "sessions",
      day: "2026-07-15",
      dim: "",
      value: 2,
      attribution: "person",
    },
    {
      subject: { kind: "person", externalId: "user-abc" },
      metricKey: "model_requests",
      day: "2026-07-15",
      dim: "claude-sonnet-4",
      value: 8,
      attribution: "person",
    },
    {
      subject: { kind: "person", externalId: "user-abc" },
      metricKey: "prompts",
      day: "2026-07-16",
      dim: "",
      value: 5,
      attribution: "person",
    },
  ],
  signals: [
    {
      subject: { kind: "person", externalId: "user-abc" },
      day: "2026-07-15",
      hours: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 1, 0, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      peakConcurrency: 1,
      sourceGranularity: "1h",
    },
  ],
  gaps: [
    {
      kind: "other",
      detail: "Some sessions on 2026-07-16 could not be attributed to a source file.",
    },
  ],
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
 * Render the ingest fixture as the exact string checked in at
 * `desktop-agent/src-tauri/fixtures/agent-ingest-request.json`. Pure — the
 * drift test calls this directly and compares bytes. The example is PARSED
 * through the frozen schema first, so a value the schema would reject can
 * never be committed as a "valid" fixture.
 */
export function renderAgentIngestFixtureJson() {
  const parsed = agentIngestRequestSchema.parse(EXAMPLE);
  return `${JSON.stringify(sortKeysDeep(parsed), null, 2)}\n`;
}

function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const outPath = path.join(repoRoot, INGEST_FIXTURE_RELATIVE_PATH);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderAgentIngestFixtureJson(), "utf8");
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
