import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { VENDOR_IDS } from "../../src/contracts/attribution";
import type { RawPayloadEnvelope } from "../../src/contracts/connector";

// W1-S harness: the committed shape of a recorded vendor payload. Files in
// fixtures/vendor-payloads/<vendor>/*.json wrap the frozen RawPayloadEnvelope
// in recording metadata; this schema is what tests/vendor-fixtures.test.ts
// enforces in CI, and what connector replay tests load through.
// (Harness-owned, NOT a frozen contract — but `envelope` must stay assignable
// to RawPayloadEnvelope, which the type assertion below pins at compile time.)

const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/);

export const recordedPayloadFixtureSchema = z.object({
  meta: z.object({
    vendor: z.enum(VENDOR_IDS),
    recordedAt: z.string().datetime(),
    script: z.string().min(1),
    /** Committed recordings MUST have gone through the scrubber. */
    scrubbed: z.literal(true),
    endpoint: z.string().startsWith("/"),
    status: z.literal(200),
    page: z.number().int().min(2).optional(),
  }),
  envelope: z.object({
    kind: z.string().min(1),
    window: z.object({ start: isoDateTime, end: isoDateTime }).nullable(),
    payload: z.unknown(),
  }),
});
export type RecordedPayloadFixture = z.infer<
  typeof recordedPayloadFixtureSchema
> & { envelope: RawPayloadEnvelope };

export const VENDOR_PAYLOADS_DIR = join(
  process.cwd(),
  "fixtures",
  "vendor-payloads",
);

export type RecordedPayloadFile = {
  /** Path relative to fixtures/vendor-payloads, POSIX separators. */
  relPath: string;
  /** Vendor directory the file sits in (must equal meta.vendor). */
  vendorDir: string;
  raw: unknown;
};

/** Lists every committed recording (raw-parsed; validation is the caller's
 * job so the CI test can report WHICH file is invalid). */
export function listRecordedPayloadFiles(): RecordedPayloadFile[] {
  const entries = readdirSync(VENDOR_PAYLOADS_DIR, {
    recursive: true,
    withFileTypes: true,
  });
  const files: RecordedPayloadFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const abs = join(entry.parentPath, entry.name);
    const relPath = relative(VENDOR_PAYLOADS_DIR, abs).split(sep).join("/");
    files.push({
      relPath,
      vendorDir: relPath.split("/")[0],
      raw: JSON.parse(readFileSync(abs, "utf8")),
    });
  }
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Validated recordings for one vendor — what replay tests consume. */
export function loadRecordedPayloads(
  vendor: (typeof VENDOR_IDS)[number],
  kind?: string,
): RecordedPayloadFixture[] {
  return listRecordedPayloadFiles()
    .filter((f) => f.vendorDir === vendor)
    .map((f) => recordedPayloadFixtureSchema.parse(f.raw) as RecordedPayloadFixture)
    .filter((f) => (kind ? f.envelope.kind === kind : true));
}
