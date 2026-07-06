import type { forOrg } from "../../db/org-scope";
import { fixtureSharedAccountSource } from "./fixture";

type OrgScope = ReturnType<typeof forOrg>;

/**
 * A subject that multiple people share (§6.2). The flag is metadata — adoption
 * for these people is likely undercounted because the vendor exposes only
 * account-level activity, never redistributed per person (invariant b). The
 * `identityCount` people who share it stay pseudonymous.
 */
export type SharedAccountFlag = {
  subjectId: string;
  connectionId: string;
  vendor: string;
  /** The vendor-visible account identifier (not a person). */
  externalId: string;
  /** How many resolved people are linked to this one subject. */
  identityCount: number;
};

/** The swap seam: today a fixture that derives flags from identity fan-out;
 * W2-K replaces the impl with its real shared-account detector. */
export interface SharedAccountSource {
  flags(scope: OrgScope): Promise<SharedAccountFlag[]>;
}

export function resolveSharedAccountSource(): SharedAccountSource {
  return fixtureSharedAccountSource;
}
