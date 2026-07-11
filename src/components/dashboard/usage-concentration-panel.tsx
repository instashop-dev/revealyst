import { ConfidenceBadge } from "@/components/analytics/confidence-badge";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { USAGE_CONCENTRATION_COPY } from "@/lib/analytics-glossary";
import {
  MIN_PEOPLE_FOR_DISTRIBUTION,
  type UsageConcentration,
} from "@/lib/usage-distribution";

const C = USAGE_CONCENTRATION_COPY;

/** The ACTUAL cohort share behind a "top N" figure: with 4 resolved people a
 * nominal "top 10%" cohort is really 1 of 4 = 25% — the label must say what
 * the math did, not the nominal cut point (F9). */
function actualCohortPct(count: number, resolvedPeople: number): number {
  return Math.round((count / resolvedPeople) * 100);
}

/**
 * Usage concentration (M4): share of ATTRIBUTED prompt volume (identity-
 * resolved people only — the InfoTip and the excluded-volume note say so)
 * from the heaviest slice of resolved users. Directional (uncalibrated cut
 * points, stated in the InfoTip) and aggregate-only — the heavy users are
 * counted, never named. Honest empty state below the resolved-people floor or
 * with no attributed volume (ratio honesty: no denominator, no ratio). With
 * few people the nominal 10%/25% cohorts collapse to the same set — then one
 * figure renders, labeled by its actual cohort share, instead of the same
 * number twice under two made-up percentages.
 */
export function UsageConcentrationPanel({
  concentration,
}: {
  concentration: UsageConcentration;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          {C.title}
          <InfoTip label={C.title} short={C.info} />
          <ConfidenceBadge tier={C.confidence} />
        </CardTitle>
        <CardDescription>{C.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!concentration.available ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{C.empty.title}</span>
            <span className="text-muted-foreground">
              {C.empty.body(MIN_PEOPLE_FOR_DISTRIBUTION)}
            </span>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-heading text-3xl font-semibold tabular-nums">
                  {Math.round(concentration.top25SharePct)}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {C.sentence(
                    actualCohortPct(
                      concentration.top25Count,
                      concentration.resolvedPeople,
                    ),
                    concentration.top25SharePct,
                    concentration.top25Count,
                  )}
                </span>
              </div>
              {concentration.top10Count !== concentration.top25Count ? (
                <div className="flex flex-col gap-0.5">
                  <span className="font-heading text-3xl font-semibold tabular-nums">
                    {Math.round(concentration.top10SharePct)}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {C.sentence(
                      actualCohortPct(
                        concentration.top10Count,
                        concentration.resolvedPeople,
                      ),
                      concentration.top10SharePct,
                      concentration.top10Count,
                    )}
                  </span>
                </div>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground">
              Across {concentration.resolvedPeople} identity-resolved people with
              recorded prompts.
              {concentration.excludedPrompts > 0 ? (
                <> {C.excludedNote(concentration.excludedPrompts)}</>
              ) : null}
            </span>
          </>
        )}
      </CardContent>
    </Card>
  );
}
