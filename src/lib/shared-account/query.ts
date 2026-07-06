// DB query path for W2-K shared-account detection. Reads an org's subjects,
// a volume metric, and the intra-day signals through the frozen forOrg
// surface, then runs the pure detectSharedAccounts. Adds NO new query
// surface to src/db/org-scope.ts (a frozen contract).

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
 * heuristic. Signals are read per subject: the frozen surface has no bulk
 * subject_day_signals reader (a bulk reader is a deferred ADR — see PR
 * notes), so the reads are gathered concurrently rather than run serially.
 */
export async function computeSharedAccountFlags(
  scoped: Scoped,
  opts: {
    from: string;
    to: string;
    volumeMetricKey?: string;
    config?: Partial<SharedAccountConfig>;
  },
): Promise<SharedAccountFlag[]> {
  const volumeMetricKey = opts.volumeMetricKey ?? "tokens_input";

  const [subjectRows, volumeRecords] = await Promise.all([
    scoped.subjects.list(),
    scoped.metrics.records({
      metricKey: volumeMetricKey,
      from: opts.from,
      to: opts.to,
    }),
  ]);

  const volumeBySubject = new Map<string, number>();
  for (const record of volumeRecords) {
    volumeBySubject.set(
      record.subjectId,
      (volumeBySubject.get(record.subjectId) ?? 0) + record.value,
    );
  }

  const signalRowsPerSubject = await Promise.all(
    subjectRows.map((subject) =>
      scoped.metrics.signals({
        subjectId: subject.id,
        from: opts.from,
        to: opts.to,
      }),
    ),
  );
  // subject_day_signals rows are structurally a superset of SubjectDaySignal,
  // so they pass straight through — detectSharedAccounts reads only the four
  // fields it needs.
  const signals: SubjectDaySignal[] = signalRowsPerSubject.flat();

  return detectSharedAccounts({
    signals,
    volumeBySubject,
    config: opts.config,
  });
}
