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

describe("collection allowlist ↔ parse.ts", () => {
  it("every allowlisted field is actually read by the parser", () => {
    for (const field of AGENT_COLLECTION_FIELDS) {
      expect(
        parseSource.includes(field.sourceToken),
        `parse.ts does not read "${field.sourceToken}" (field ${field.field})`,
      ).toBe(true);
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

  it("exactly the model id and the four token counts leave the device", () => {
    const sent = AGENT_COLLECTION_FIELDS.filter((f) => f.sent).map(
      (f) => f.field,
    );
    expect(sent.sort()).toEqual(
      [
        "model",
        "usage.cache_creation_input_tokens",
        "usage.cache_read_input_tokens",
        "usage.input_tokens",
        "usage.output_tokens",
      ].sort(),
    );
  });
});
