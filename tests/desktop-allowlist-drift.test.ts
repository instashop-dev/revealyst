import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GENERATED_RELATIVE_PATH,
  renderDesktopAllowlistJson,
} from "../scripts/generate-agent-allowlist-json.mjs";
import {
  AGENT_COLLECTION_FIELDS,
  AGENT_NEVER_COLLECTED,
} from "../src/lib/agent-collection-schema";
import { AI_TOOL_IDS } from "../src/contracts/metrics";

// Desktop Agent plan T3.1 (law 3): the Rust desktop agent embeds
// `desktop-agent/src-tauri/generated/allowlist.json` at compile time; the
// single source of truth stays `src/lib/agent-collection-schema.ts` (itself
// pinned byte-identical to the CLI allowlist by agent-cli-contract.test.ts,
// which the CLI package in turn pins to parse.ts). This suite closes the
// third leg: the checked-in generated artifact cannot drift from the TS
// schema — editing the schema without `npm run generate:desktop-allowlist`,
// or hand-editing the JSON, fails here.
//
// Root Vitest excludes desktop-agent/ code, but READING a file that lives
// there is fine — no desktop TS is compiled; the generator itself is a repo
// script that imports only src/lib.

describe("desktop allowlist artifact drift (T3.1)", () => {
  it("checked-in allowlist.json equals a fresh render byte-for-byte", () => {
    const checkedIn = readFileSync(GENERATED_RELATIVE_PATH, "utf8");
    expect(checkedIn).toBe(renderDesktopAllowlistJson());
  });

  it("the render is a full projection of the TS schema (anti-vacuity)", () => {
    const doc = JSON.parse(renderDesktopAllowlistJson()) as {
      fields: {
        field: string;
        label: string;
        purpose: string;
        sent: boolean;
        sourceToken: string;
      }[];
      neverCollected: string[];
      closedEnums: Record<string, string[]>;
    };
    // Every schema field appears exactly once, with identical wording —
    // the desktop trust surface renders the same claims as the app panel.
    expect(doc.fields).toHaveLength(AGENT_COLLECTION_FIELDS.length);
    for (const source of AGENT_COLLECTION_FIELDS) {
      const projected = doc.fields.find((f) => f.field === source.field);
      expect(projected).toEqual({
        field: source.field,
        label: source.label,
        purpose: source.purpose,
        sent: source.sent,
        sourceToken: source.sourceToken,
      });
    }
    expect(doc.neverCollected).toEqual([...AGENT_NEVER_COLLECTED]);
    // Determinism the byte comparison relies on: sorted field order, LF-only.
    const names = doc.fields.map((f) => f.field);
    expect(names).toEqual([...names].sort());
    expect(renderDesktopAllowlistJson()).not.toContain("\r");
  });

  it("crosses the closed AI-app enum to the Rust validator (ADR 0057)", () => {
    // The device validator reads the CLOSED value set for `ai_tool_used` from
    // this same generated artifact (plan law 5) — so it must carry the frozen
    // contract's AI_TOOL_IDS verbatim, and `ai_tool_used` must be a sent field.
    const doc = JSON.parse(renderDesktopAllowlistJson()) as {
      fields: { field: string; sent: boolean }[];
      closedEnums: Record<string, string[]>;
    };
    expect(doc.closedEnums.ai_tool_used).toEqual([...AI_TOOL_IDS]);
    // Determinism: the enum is sorted (the byte comparison relies on it).
    expect(doc.closedEnums.ai_tool_used).toEqual(
      [...doc.closedEnums.ai_tool_used].sort(),
    );
    const field = doc.fields.find((f) => f.field === "ai_tool_used");
    expect(field?.sent, "ai_tool_used must be a sent field").toBe(true);
  });
});
