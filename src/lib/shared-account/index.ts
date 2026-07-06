import type { forOrg } from "../../db/org-scope";
import type {
  SharedAccountConfidence,
  SharedAccountReason,
} from "./heuristics";
import { computeSharedAccountFlags } from "./query";

type OrgScope = ReturnType<typeof forOrg>;

/**
 * A shared-account flag for the team dashboard: W2-K's usage-pattern detection
 * (§6.2 — round-the-clock / concurrency / volume-vs-median) enriched with the
 * display fields the panel renders (the account identifier, its vendor, and how
 * many resolved people are linked). The flag is metadata — adoption for the
 * people sharing the account is likely undercounted, never redistributed
 * per-person (invariant b).
 */
export type SharedAccountFlag = {
  subjectId: string;
  /** The vendor-visible account identifier (not a person). */
  externalId: string;
  vendor: string;
  /** Resolved people currently linked to this one subject. */
  identityCount: number;
  reasons: SharedAccountReason[];
  confidence: SharedAccountConfidence;
};

/** The dashboard's shared-account source — now backed by W2-K's real detector
 * (a local fixture during the W2-L build, per rule 2; swapped once W2-K
 * merged). */
export interface SharedAccountSource {
  flags(
    scope: OrgScope,
    window: { from: string; to: string },
  ): Promise<SharedAccountFlag[]>;
}

const w2kSharedAccountSource: SharedAccountSource = {
  async flags(scope, window) {
    const [detected, subjects, connections] = await Promise.all([
      computeSharedAccountFlags(scope, { from: window.from, to: window.to }),
      scope.subjects.list(),
      scope.connections.list(),
    ]);
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const vendorByConnection = new Map(connections.map((c) => [c.id, c.vendor]));

    const enriched: SharedAccountFlag[] = [];
    for (const flag of detected) {
      const subject = subjectById.get(flag.subjectId);
      // The detector saw a subject id we can't resolve to a row — skip it
      // rather than render a flag with no account identity.
      if (!subject) continue;
      const links = await scope.identities.forSubject(flag.subjectId);
      enriched.push({
        subjectId: flag.subjectId,
        externalId: subject.externalId,
        vendor: vendorByConnection.get(subject.connectionId) ?? "unknown",
        identityCount: links.length,
        reasons: flag.reasons,
        confidence: flag.confidence,
      });
    }
    return enriched;
  },
};

export function resolveSharedAccountSource(): SharedAccountSource {
  return w2kSharedAccountSource;
}
