import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INGEST_FIXTURE_RELATIVE_PATH,
  renderAgentIngestFixtureJson,
} from "../scripts/generate-agent-ingest-fixture.mjs";
import { agentIngestRequestSchema } from "../src/contracts/api";

// Desktop Agent plan T4.1 (law 3/4): the Rust desktop sync engine hand-mirrors
// the FROZEN `agentIngestRequestSchema` (contracts-v1) and round-trips the
// checked-in fixture at `desktop-agent/src-tauri/fixtures/agent-ingest-request.json`
// (embedded via include_str! in `sync/batch.rs`). This suite closes the loop
// the Rust side cannot: the fixture cannot drift from the frozen schema.
// Editing the schema without `npm run generate:desktop-ingest-fixture`, or
// hand-editing the JSON, fails here — which flags that the Rust struct needs
// re-syncing under the same ADR (frozen-contract rule 1).
//
// Root Vitest excludes desktop-agent/ code, but READING a JSON file that lives
// there is fine — no desktop TS is compiled; the generator imports only
// src/contracts.

describe("desktop ingest fixture drift (T4.1)", () => {
  it("checked-in fixture equals a fresh render byte-for-byte", () => {
    const checkedIn = readFileSync(INGEST_FIXTURE_RELATIVE_PATH, "utf8");
    expect(checkedIn).toBe(renderAgentIngestFixtureJson());
  });

  it("the checked-in fixture is a legal AgentIngestRequest", () => {
    const checkedIn = JSON.parse(
      readFileSync(INGEST_FIXTURE_RELATIVE_PATH, "utf8"),
    );
    // The frozen schema accepts it AND parsing is an identity transform (the
    // fixture already carries every default the schema would apply, so the
    // Rust side sees exactly these bytes on the wire).
    const parsed = agentIngestRequestSchema.parse(checkedIn);
    expect(parsed).toEqual(checkedIn);
  });

  it("renders LF-only, deterministic output (byte comparison relies on it)", () => {
    const rendered = renderAgentIngestFixtureJson();
    expect(rendered).not.toContain("\r");
    expect(rendered.endsWith("\n")).toBe(true);
    // Idempotent: rendering twice is byte-identical.
    expect(renderAgentIngestFixtureJson()).toBe(rendered);
  });
});
