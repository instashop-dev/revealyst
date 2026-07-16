import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_FIXTURE_RELATIVE_PATH,
  renderDiagnosticsFixtureJson,
} from "../scripts/generate-desktop-diagnostics-fixture.mjs";
import { diagnosticBundleSchema } from "../src/lib/desktop-diagnostics";

// Desktop Agent plan T4.3 (law 3/4): the Rust desktop diagnostics builder
// hand-mirrors the STRICT `diagnosticBundleSchema` (`src/lib/desktop-diagnostics.ts`)
// and round-trips the checked-in fixture at
// `desktop-agent/src-tauri/fixtures/desktop-diagnostics-bundle.json` (embedded
// via include_str! in `diagnostics.rs`). This suite closes the loop the Rust
// side cannot: the fixture cannot drift from the schema. Editing the schema
// without `npm run generate:desktop-diagnostics-fixture`, or hand-editing the
// JSON, fails here — flagging that the Rust struct needs re-syncing.
//
// Root Vitest excludes desktop-agent/ code, but READING a JSON file that lives
// there is fine — no desktop TS is compiled; the generator imports only the
// diagnostics schema.

describe("desktop diagnostics fixture drift (T4.3)", () => {
  it("checked-in fixture equals a fresh render byte-for-byte", () => {
    const checkedIn = readFileSync(DIAGNOSTICS_FIXTURE_RELATIVE_PATH, "utf8");
    expect(checkedIn).toBe(renderDiagnosticsFixtureJson());
  });

  it("the checked-in fixture is a legal DiagnosticBundle", () => {
    const checkedIn = JSON.parse(
      readFileSync(DIAGNOSTICS_FIXTURE_RELATIVE_PATH, "utf8"),
    );
    // The strict schema accepts it AND parsing is an identity transform (the
    // fixture carries no field the schema would strip/add, so the Rust side
    // sees exactly these bytes on the wire).
    const parsed = diagnosticBundleSchema.parse(checkedIn);
    expect(parsed).toEqual(checkedIn);
  });

  it("renders LF-only, deterministic output (byte comparison relies on it)", () => {
    const rendered = renderDiagnosticsFixtureJson();
    expect(rendered).not.toContain("\r");
    expect(rendered.endsWith("\n")).toBe(true);
    expect(renderDiagnosticsFixtureJson()).toBe(rendered);
  });
});
