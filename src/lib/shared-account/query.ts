// DB query path for W2-K shared-account detection. Reads an org's volume
// metric and its intra-day signals through the frozen forOrg surface, then
// runs the pure detectSharedAccounts. Adds NO new query surface to
// src/db/org-scope.ts (a frozen contract) — signals come from ADR 0017's
// `metrics.allSignals` bulk reader, added there under that ADR.

import type { forOrg } from "../../db/org-scope";
import {
  detectSharedAccounts,
  type SharedAccountConfig,
  type SharedAccountFlag,
  type SubjectDaySignal,
} from "./heuristics";

type Scoped = ReturnType<typeof forOrg>;

/**
 * Computes shared-account flags for one time window. Volume is the summed
 * value of `volumeMetricKey` (default tokens_input) per subject over the
 * window — a magnitude proxy; the team median is derived from it inside the
 * heuristic. Signals are read with ONE org-wide `metrics.allSignals` call
 * (ADR 0017) instead of fanning out one `metrics.signals` query per subject.
 */
export async function computeSharedAccountFlags(
  scoped: Scoped,
  opts: {
    from: string;
    to: string;
    volumeMetricKey?: string;
    config?: Partial<SharedAccountConfig>;
    /** Pre-fetched org-wide signal rows (e.g. dashboard-view.ts's single
     *  fetch, shared with the activity heatmap) — pass to avoid a
     *  redundant `allSignals` call when the caller already has them. */
    signalRows?: Awaited<ReturnType<Scoped["metrics"]["allSignals"]>>;
    /** Pre-fetched metric_records for `volumeMetricKey` over the window —
     *  MUST be the rows for that exact key (the default is tokens_input);
     *  pass only when the caller fetched them itself (dashboard-view.ts). */
    volumeRecords?: Awaited<ReturnType<Scoped["metrics"]["records"]>>;
  },
): Promise<SharedAccountFlag[]> {
  const volumeMetricKey = opts.volumeMetricKey ?? "tokens_input";

  const [volumeRecords, signalRows] = await Promise.all([
    opts.volumeRecords ??
      scoped.metrics.records({
        metricKey: volumeMetricKey,
        from: opts.from,
        to: opts.to,
      }),
    opts.signalRows ??
      scoped.metrics.allSignals({ from: opts.from, to: opts.to }),
  ]);

  const volumeBySubject = new Map<string, number>();
  for (const record of volumeRecords) {
    volumeBySubject.set(
      record.subjectId,
      (volumeBySubject.get(record.subjectId) ?? 0) + record.value,
    );
  }

  // subject_day_signals rows are structurally a superset of SubjectDaySignal,
  // so they pass straight through — detectSharedAccounts reads only the four
  // fields it needs.
  const signals: SubjectDaySignal[] = signalRows;

  return detectSharedAccounts({
    signals,
    volumeBySubject,
    config: opts.config,
  });
}
