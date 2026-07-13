import { ShieldCheck } from "lucide-react";
import type { CollectedGap } from "@/lib/honesty-gaps";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HONESTY_GAP_GLOSSARY } from "@/lib/metrics-glossary";
import type { HonestyGapKind } from "@/lib/metrics-glossary";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

const COPY = TEAM_OVERVIEW_COPY.dataTrust;

/** Aggregate signal-coverage summary — counts only, never a per-named-person
 * list (invariant b / §7). `single` = identified people fed by exactly one
 * source; `total` = identified people with any coverage. */
export type CoverageAggregate = { single: number; total: number };

/**
 * Data Trust card (W5-H card e): the honesty surface. Folds the connector
 * reporting gaps and the per-person signal COVERAGE (aggregate) into one place
 * so a team admin sees how complete the picture is before trusting the numbers.
 * Shared-account flags render alongside it (their own component) in the page.
 */
export function DataTrustCard({
  coverage,
  gaps,
}: {
  coverage: CoverageAggregate | null;
  gaps: CollectedGap[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-muted-foreground" />
          {COPY.coverageTitle}
        </CardTitle>
        <CardDescription>{COPY.coverageDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {coverage === null || coverage.total === 0 ? (
          <p className="text-muted-foreground">{COPY.coverageEmpty}</p>
        ) : (
          <p>{COPY.coverageLine(coverage.single, coverage.total)}</p>
        )}

        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {COPY.gapsTitle}
            <InfoTip
              label={COPY.gapsTitle}
              short="Places a connector reports it can't fully attribute usage — surfaced, never silently narrowed."
            />
          </p>
          {gaps.length === 0 ? (
            <p className="text-muted-foreground">{COPY.gapsEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {gaps.map((gap) => {
                const meta = HONESTY_GAP_GLOSSARY[gap.kind as HonestyGapKind] as
                  | { label: string; shortWhat: string }
                  | undefined;
                return (
                  <li
                    key={`${gap.kind}:${gap.detail ?? ""}`}
                    className="flex flex-col gap-0.5"
                  >
                    <span className="font-medium">{meta?.label ?? gap.kind}</span>
                    <span className="text-xs text-muted-foreground">
                      {gap.detail ?? meta?.shortWhat ?? ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
