// Shared honesty-gap collection. Connector `normalize()` emits per-vendor
// honesty gaps (src/contracts/connector.ts — degraded attribution reported,
// never papered over); the poller dedupes them onto `connector_runs.gaps`
// (jsonb). Both the personal self-view (src/lib/api-impl.ts `dashboardSummary`)
// and the team dashboard (src/lib/dashboard-view.ts `readDashboardView`, W4-W
// finding A5) surface the SAME gaps in the shared "needs attention" strip, so
// the collection lives here rather than being private to either reader.

/** A collected, UI-safe honesty gap: kind plus optional short detail. Matches
 * the `dashboardSummary` response `gaps` shape and `deriveAttention`'s input. */
export type CollectedGap = { kind: string; detail?: string };

/** Distinct honesty gaps across a run set, deduped on kind+detail. Runs store
 * gaps as jsonb; keep only well-formed `{ kind[, detail] }` entries. */
export function collectGaps(runs: Array<{ gaps: unknown }>): CollectedGap[] {
  const seen = new Map<string, CollectedGap>();
  for (const run of runs) {
    if (!Array.isArray(run.gaps)) {
      continue;
    }
    for (const gap of run.gaps) {
      if (
        typeof gap !== "object" ||
        gap === null ||
        typeof (gap as { kind?: unknown }).kind !== "string"
      ) {
        continue;
      }
      const kind = (gap as { kind: string }).kind;
      const rawDetail = (gap as { detail?: unknown }).detail;
      const detail = typeof rawDetail === "string" ? rawDetail : undefined;
      // Structured key so a literal separator inside kind/detail can't
      // collapse two distinct gaps into one.
      const key = JSON.stringify([kind, detail ?? null]);
      if (!seen.has(key)) {
        seen.set(key, detail !== undefined ? { kind, detail } : { kind });
      }
    }
  }
  return [...seen.values()];
}
