import { describe, expect, it } from "vitest";
import { findDuplicatePrefixes } from "../scripts/check-adr-numbers.mjs";

// Self-test for the T0.1 CI guard: ADR numbers must stay unique so "ADR NNNN"
// is a citable, unambiguous reference (docs/decisions/README.md).

describe("check-adr-numbers guard", () => {
  it("returns no duplicates for a clean ledger", () => {
    expect(
      findDuplicatePrefixes([
        "0001-tenant-isolation.md",
        "0002-something.md",
        "README.md",
      ]),
    ).toEqual([]);
  });

  it("flags an unallowlisted duplicate pair", () => {
    const duplicates = findDuplicatePrefixes([
      "0041-first.md",
      "0041-second.md",
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].prefix).toBe("0041");
    expect(duplicates[0].files).toEqual(["0041-first.md", "0041-second.md"]);
  });

  it("accepts the two bannered 0014 files", () => {
    expect(
      findDuplicatePrefixes([
        "0014-org-scope-batch-read-methods.md",
        "0014-personal-person-level-presets.md",
      ]),
    ).toEqual([]);
  });

  it("flags a third file landing on 0014 alongside the bannered pair", () => {
    const duplicates = findDuplicatePrefixes([
      "0014-org-scope-batch-read-methods.md",
      "0014-personal-person-level-presets.md",
      "0014-new-unrecorded-collision.md",
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].files).toHaveLength(3);
  });

  it("ignores non-md files and names without a 4-digit prefix", () => {
    expect(
      findDuplicatePrefixes([
        "0001-tenant-isolation.md",
        "0001-tenant-isolation.md.bak",
        "notes-0001.md",
        "README.md",
      ]),
    ).toEqual([]);
  });
});
