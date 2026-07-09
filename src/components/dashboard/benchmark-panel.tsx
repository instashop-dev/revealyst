import type { BenchmarkSummary } from "@/lib/benchmarks";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CONCEPT_GLOSSARY, methodologyAnchor } from "@/lib/metrics-glossary";

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Org vs. industry norms (§8 L4). Benchmarks are load-bearing — a score is
 * meaningless without comparison. Sources are cited inline so the number is
 * auditable, and an org with no score shows "—", never an invented percentile.
 * Until founder-verified benchmark rows exist, the norms are MODELED estimates
 * and the copy here must say so (invariant b — no false provenance).
 */
export function BenchmarkPanel({
  benchmarks,
}: {
  benchmarks: BenchmarkSummary[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Benchmark
          <InfoTip
            label={CONCEPT_GLOSSARY.benchmarks.plainName}
            short={CONCEPT_GLOSSARY.benchmarks.shortWhat}
            learnMoreHref={`/methodology#${methodologyAnchor("benchmarks")}`}
          />
        </CardTitle>
        <CardDescription>
          Your scores vs. modeled industry norms — verified published
          benchmarks will replace these as sources are confirmed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {benchmarks.map((b) => (
          <div key={b.slug} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{b.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {b.orgValue == null ? "—" : Math.round(b.orgValue)} vs{" "}
                {Math.round(b.peerMedian)} median
              </span>
            </div>
            <div
              className="relative h-2 w-full rounded-full bg-muted"
              role="img"
              aria-label={
                b.orgValue == null
                  ? `${b.label}: no score yet, peer median ${Math.round(b.peerMedian)}`
                  : `${b.label}: your score ${Math.round(b.orgValue)} vs peer median ${Math.round(b.peerMedian)}`
              }
            >
              {/* peer median marker */}
              <div
                className="absolute top-[-2px] h-3 w-0.5 bg-muted-foreground/60"
                style={{ left: `${Math.max(0, Math.min(100, b.peerMedian))}%` }}
                aria-hidden
              />
              {b.orgValue != null ? (
                <div
                  className="absolute top-0 size-2 -translate-x-1/2 rounded-full bg-primary ring-2 ring-background"
                  style={{
                    left: `${Math.max(0, Math.min(100, b.orgValue))}%`,
                  }}
                  aria-hidden
                />
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {b.percentile == null
                ? "No score yet."
                : `${ordinal(Math.round(b.percentile))} percentile · ${b.source}`}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
