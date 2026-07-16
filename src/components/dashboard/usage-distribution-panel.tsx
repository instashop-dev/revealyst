import { ConfidencePill } from "@/components/confidence-pill";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONFIDENCE_LABELS,
  USAGE_DISTRIBUTION_COPY,
} from "@/lib/analytics-glossary";
import {
  MIN_PEOPLE_FOR_DISTRIBUTION,
  type UsageDistribution,
} from "@/lib/usage-distribution";

const C = USAGE_DISTRIBUTION_COPY;

/**
 * Within-org usage distribution (M3): band tally of active days per person +
 * median/p90, aggregate-only (counts and org-relative percentiles, never a
 * named individual). Honest empty state below the minimum resolved-people
 * floor — never a two-person "distribution".
 */
export function UsageDistributionPanel({
  distribution,
}: {
  distribution: UsageDistribution;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {C.title}
          <InfoTip label={C.title} short={C.info} />
          <ConfidencePill tier={C.confidence} label={CONFIDENCE_LABELS[C.confidence]} />
        </CardTitle>
        <CardDescription>{C.description(distribution.periodDays)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!distribution.available ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{C.empty.title}</span>
            <span className="text-muted-foreground">
              {C.empty.body(MIN_PEOPLE_FOR_DISTRIBUTION)}
            </span>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {distribution.bands.map((band) => {
                const pct =
                  distribution.resolvedPeople > 0
                    ? (band.count / distribution.resolvedPeople) * 100
                    : 0;
                return (
                  <li key={band.key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        {band.label}
                        <InfoTip
                          label={band.label}
                          short={C.bandHint[band.key]}
                        />
                        <span className="text-xs text-muted-foreground">
                          ({band.lowDays}–{band.highDays} days)
                        </span>
                      </span>
                      <span className="tabular-nums font-medium">
                        {band.count}{" "}
                        {band.count === 1 ? "person" : "people"}
                      </span>
                    </div>
                    <div
                      aria-hidden="true"
                      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-x-8 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
              <span>
                {C.medianLabel}:{" "}
                <span className="tabular-nums font-medium text-foreground">
                  {Math.round(distribution.medianActiveDays)}
                </span>
              </span>
              <span>
                {C.p90Label}:{" "}
                <span className="tabular-nums font-medium text-foreground">
                  {Math.round(distribution.p90ActiveDays)}
                </span>
              </span>
              <span>
                Resolved people:{" "}
                <span className="tabular-nums font-medium text-foreground">
                  {distribution.resolvedPeople}
                </span>
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
