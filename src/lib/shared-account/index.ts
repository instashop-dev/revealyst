import type { forOrg } from "../../db/org-scope";
import { groupBy } from "../utils";
import type { VisibilityMode } from "../visibility";
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
 *
 * `externalId` carries the vendor account identifier, which is often a real
 * email (e.g. Cursor's `email:<address>`) — §7 privacy applies here exactly
 * as it does to people, so it's null unless `visibilityMode` permits it.
 */
export type SharedAccountFlag = {
  subjectId: string;
  /** The vendor-visible account identifier (not a person) — null in `private`
   * mode (the default), same redaction rule as `toPersonRef`'s displayName. */
  externalId: string | null;
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
    visibilityMode: VisibilityMode,
    window: { from: string; to: string },
    prefetched?: {
      /** e.g. dashboard-view.ts's single per-render `connections.list()`
       * fetch — pass to avoid a redundant query. */
      connections?: Awaited<ReturnType<OrgScope["connections"]["list"]>>;
      /** e.g. dashboard-view.ts's single per-render `metrics.allSignals`
       * fetch, shared with the activity heatmap — pass to avoid a
       * redundant query. */
      signalRows?: Awaited<ReturnType<OrgScope["metrics"]["allSignals"]>>;
      /** e.g. dashboard-view.ts's single per-render `subjects.list()`
       * fetch, shared with readDashboard — pass to avoid a redundant query. */
      subjects?: Awaited<ReturnType<OrgScope["subjects"]["list"]>>;
      /** e.g. dashboard-view.ts's single per-render `identities.all()`
       * fetch, shared with readDashboard — pass to avoid a redundant query. */
      identities?: Awaited<ReturnType<OrgScope["identities"]["all"]>>;
      /** Pre-fetched metric_records for the detector's volume metric
       * (tokens_input — the default; this path never overrides it). */
      volumeRecords?: Awaited<ReturnType<OrgScope["metrics"]["records"]>>;
    },
  ): Promise<SharedAccountFlag[]>;
}

const w2kSharedAccountSource: SharedAccountSource = {
  async flags(scope, visibilityMode, window, prefetched) {
    const [detected, subjects, connections, allIdentities] = await Promise.all([
      computeSharedAccountFlags(scope, {
        from: window.from,
        to: window.to,
        signalRows: prefetched?.signalRows,
        volumeRecords: prefetched?.volumeRecords,
      }),
      prefetched?.subjects ?? scope.subjects.list(),
      prefetched?.connections ?? scope.connections.list(),
      // Bulk identity reader (ADR 0014) instead of a per-flag
      // `identities.forSubject` fan-out — grouped by subjectId below.
      prefetched?.identities ?? scope.identities.all(),
    ]);
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const vendorByConnection = new Map(connections.map((c) => [c.id, c.vendor]));
    const identitiesBySubject = groupBy(allIdentities, (link) => link.subjectId);

    const enriched: SharedAccountFlag[] = [];
    for (const flag of detected) {
      const subject = subjectById.get(flag.subjectId);
      // The detector saw a subject id we can't resolve to a row — skip it
      // rather than render a flag with no account identity.
      if (!subject) continue;
      const links = identitiesBySubject.get(flag.subjectId) ?? [];
      enriched.push({
        subjectId: flag.subjectId,
        externalId: visibilityMode === "private" ? null : subject.externalId,
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
