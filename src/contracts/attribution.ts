// Frozen W0-C attribution contracts (§6.1). The ladder orders how honestly
// a metric can be attributed: person (strongest) > key_project > account.
// The cardinal rule every consumer inherits: NEVER fabricate per-user
// numbers from key/account-level data — degraded attribution is surfaced,
// not redistributed.

export const ATTRIBUTION_LEVELS = [
  "person",
  "key_project",
  "account",
] as const;
export type AttributionLevel = (typeof ATTRIBUTION_LEVELS)[number];

/** Higher = stronger attribution. */
export const ATTRIBUTION_ORDER: Record<AttributionLevel, number> = {
  person: 2,
  key_project: 1,
  account: 0,
};

/**
 * The frozen propagation rule as code: anything derived from multiple
 * inputs (scores, rollups) carries the LOWEST attribution among them.
 */
export function lowestAttribution(
  levels: readonly AttributionLevel[],
): AttributionLevel {
  if (levels.length === 0) {
    throw new Error("lowestAttribution requires at least one input level");
  }
  return levels.reduce((lowest, level) =>
    ATTRIBUTION_ORDER[level] < ATTRIBUTION_ORDER[lowest] ? level : lowest,
  );
}

/** Vendor-visible actor kinds (mirrors the subject_kind pg enum). */
export const SUBJECT_KINDS = [
  "person",
  "api_key",
  "service_account",
  "workspace",
  "project",
  "account",
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** V1 connector ids (connections.vendor). Text in the DB — new vendors are
 * expected; growing this union is a normal (pre-W2-J) change, but REMOVING
 * or renaming an id post-freeze is an ADR. */
export const VENDOR_IDS = [
  "github_copilot",
  "cursor",
  "anthropic_console",
  "anthropic_claude_enterprise",
  "openai",
  "claude_code_local",
] as const;
export type VendorId = (typeof VENDOR_IDS)[number];
