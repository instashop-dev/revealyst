import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_COLLECTION_FIELDS,
  AGENT_NEVER_COLLECTED,
} from "../src/allowlist";

// Derive-from-code, forward direction (W5-G): the transparency panel must
// only ever NAME fields the parser genuinely reads. This test reads
// parse.ts's source and asserts every allowlist entry's `sourceToken`
// literally appears there — so the allowlist cannot claim a field the
// parser doesn't touch. The reverse (parser reads nothing beyond the list)
// is guarded on the OUTPUT side by `privacy.test.ts`'s KEY_ALLOWLIST.

const parseSource = readFileSync(
  fileURLToPath(new URL("../src/parse.ts", import.meta.url)),
  "utf8",
);

// Fields collected by the RESIDENT DESKTOP AGENT (Rust) rather than by this
// CLI's Claude Code log parser — so their `sourceToken` points at the Rust
// collector, not parse.ts, and is verified by the desktop agent's own tests
// (the collector's Rust unit tests + the root desktop-allowlist-drift suite),
// not here. Kept as an explicit, documented set so a typo can't silently
// exempt a CLI field (anti-vacuity below). Added by ADR 0057 (ai_tool_used) and
// ADR 0059 (the on-device work-type classifier's three outputs — task_category,
// iteration_depth, verification_behavior — produced by the Rust classifier, not
// this CLI parser).
const DESKTOP_COLLECTED_FIELDS = new Set([
  "ai_tool_used",
  "task_category",
  "iteration_depth",
  "verification_behavior",
]);

describe("collection allowlist ↔ parse.ts", () => {
  it("every CLI-collected field is actually read by the parser", () => {
    let checked = 0;
    for (const field of AGENT_COLLECTION_FIELDS) {
      if (DESKTOP_COLLECTED_FIELDS.has(field.field)) continue;
      checked += 1;
      expect(
        parseSource.includes(field.sourceToken),
        `parse.ts does not read "${field.sourceToken}" (field ${field.field})`,
      ).toBe(true);
    }
    // Anti-vacuity: the exemption never swallows the whole list.
    expect(checked).toBeGreaterThan(0);
  });

  it("every exempted field is a real allowlist field (no stale exemptions)", () => {
    const names = new Set(AGENT_COLLECTION_FIELDS.map((f) => f.field));
    for (const field of DESKTOP_COLLECTED_FIELDS) {
      expect(names.has(field), `stale desktop-collected exemption: ${field}`).toBe(
        true,
      );
    }
  });

  it("the never-collected copy names nothing the parser reads as a field", () => {
    // The denied items are prose, but they must not silently correspond to a
    // real read. Guard the load-bearing structural names explicitly: parse.ts
    // must never reference tool output, cwd, or git branch as fields.
    for (const banned of ["toolUseResult.stdout", "cwd", "gitBranch"]) {
      expect(parseSource).not.toContain(banned);
    }
    expect(AGENT_NEVER_COLLECTED.length).toBeGreaterThan(0);
  });

  it("exactly the model id, the four token counts, the AI-app label, and the three work-type signals leave the device", () => {
    // `ai_tool_used` (ADR 0057) is the desktop agent's closed-enum AI-app label —
    // a value that legitimately leaves the device, so it joins the sent set. It
    // is confined to a CLOSED enum on both the device and the server. ADR 0059
    // adds the work-type classifier's three OUTPUT signals: `task_category` (a
    // value from a CLOSED task-category enum) and two plain per-day counts,
    // `iteration_depth` / `verification_behavior`. The classifier reads prompt
    // text on-device to derive these; only the bounded label + counts leave — the
    // words never do (proven on the device by the Rust classifier's own tests).
    const sent = AGENT_COLLECTION_FIELDS.filter((f) => f.sent).map(
      (f) => f.field,
    );
    expect(sent.sort()).toEqual(
      [
        "ai_tool_used",
        "iteration_depth",
        "model",
        "task_category",
        "usage.cache_creation_input_tokens",
        "usage.cache_read_input_tokens",
        "usage.input_tokens",
        "usage.output_tokens",
        "verification_behavior",
      ].sort(),
    );
  });
});
