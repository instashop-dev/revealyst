import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line -- harness shares the recorder's scrub detector
import { createScrubber, findScrubViolations } from "../scripts/record/scrub.mjs";
import {
  VENDOR_PAYLOADS_DIR,
  listRecordedPayloadFiles,
  recordedPayloadFixtureSchema,
} from "./harness/vendor-payloads";

// W1-S CI gate over the recorded-payload pipeline (rule 2): every committed
// recording under fixtures/vendor-payloads/ must (a) parse against the
// fixture-envelope schema, (b) sit in the directory matching its vendor,
// (c) carry an envelope kind namespaced by that vendor, and (d) contain zero
// identifying material — the scrub lint. Recordings are produced ONLY by
// scripts/record/*.mjs against real accounts; hand-written files that happen
// to pass the schema still violate rule 2 and get caught in review.

const files = listRecordedPayloadFiles();

describe("scrubber (scripts/record/scrub.mjs)", () => {
  it("pseudonymizes identifying keys deterministically, preserving joins", () => {
    const { scrub } = createScrubber();
    const a = scrub({
      actor: { type: "user_actor", email_address: "Real.Person@corp.com" },
      api_key_id: "apikey_01XYZ",
      organization_id: "org_real",
    });
    const b = scrub({
      actor: { type: "user_actor", email_address: "Real.Person@corp.com" },
      api_key_id: "apikey_01XYZ",
      organization_id: "org_other",
    });
    // Same real value -> same pseudonym (joins survive across files)…
    expect(a.actor.email_address).toBe(b.actor.email_address);
    expect(a.actor.email_address).toBe("user-1@scrubbed.example");
    expect(a.api_key_id).toBe(b.api_key_id);
    // …different real values -> different pseudonyms.
    expect(a.organization_id).not.toBe(b.organization_id);
    // Non-identifying data untouched.
    expect(a.actor.type).toBe("user_actor");
  });

  it("scrubs identifying values embedded in free text and id lists", () => {
    const { scrub } = createScrubber();
    const out = scrub({
      description: "spend for jane@corp.com via sk-ant-admin01-abc123def",
      account_ids: ["acct_1", "acct_2", "acct_1"],
    });
    expect(out.description).not.toContain("jane@corp.com");
    expect(out.description).toContain("sk-ant-REDACTED");
    expect(out.account_ids[0]).toBe(out.account_ids[2]);
    expect(out.account_ids[0]).not.toBe(out.account_ids[1]);
    expect(out.account_ids[0]).not.toBe("acct_1");
  });

  it("scrubbed output passes the violation scan; raw input fails it", () => {
    const raw = {
      actor: { email_address: "dev@company.io" },
      note: "key sk-ant-api03-secretsecret",
    };
    expect(findScrubViolations(raw).length).toBeGreaterThan(0);
    const { scrub } = createScrubber();
    expect(findScrubViolations(scrub(raw))).toEqual([]);
  });

  it("leaves metric numbers alone (the data connectors normalize)", () => {
    const { scrub } = createScrubber();
    const out = scrub({
      core_metrics: { num_sessions: 7, lines_of_code: { added: 120, removed: 4 } },
      estimated_cost: { amount: 1234.5, currency: "USD" },
      amount: "123.45",
    });
    expect(out.core_metrics).toEqual({
      num_sessions: 7,
      lines_of_code: { added: 120, removed: 4 },
    });
    expect(out.estimated_cost.amount).toBe(1234.5);
    expect(out.amount).toBe("123.45");
  });
});

describe("recorded vendor payloads", () => {
  it("directory exists with its README (W1-S owns it)", () => {
    expect(existsSync(join(VENDOR_PAYLOADS_DIR, "README.md"))).toBe(true);
  });

  it("reports recording coverage", () => {
    // Informational, never failing: which vendors have recordings yet.
    const byVendor = new Map<string, number>();
    for (const f of files) {
      byVendor.set(f.vendorDir, (byVendor.get(f.vendorDir) ?? 0) + 1);
    }
    const coverage = [...byVendor.entries()]
      .map(([v, n]) => `${v}: ${n} file(s)`)
      .join(", ");
    console.log(
      files.length === 0
        ? "no recordings committed yet — founder runs scripts/record/anthropic.mjs with live keys"
        : `recordings: ${coverage}`,
    );
    expect(true).toBe(true);
  });

  it.each(files.map((f) => [f.relPath, f] as const))(
    "%s matches the recorded-fixture envelope schema",
    (_relPath, file) => {
      const parsed = recordedPayloadFixtureSchema.parse(file.raw);
      expect(parsed.meta.vendor).toBe(file.vendorDir);
      expect(parsed.envelope.kind.startsWith(`${parsed.meta.vendor}.`)).toBe(
        true,
      );
    },
  );

  it.each(files.map((f) => [f.relPath, f] as const))(
    "%s contains no identifying material (scrub lint)",
    (_relPath, file) => {
      expect(findScrubViolations(file.raw)).toEqual([]);
    },
  );
});
