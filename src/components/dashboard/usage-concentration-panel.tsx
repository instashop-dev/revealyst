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

/**
 * Usage concentration (M4): share of prompt volume from the heaviest slice of
 * users. Directional (uncalibrated cut points, stated in the InfoTip) and
 * aggregate-only — the heavy users are counted, never named. Honest empty
 * state below the resolved-people floor or with no prompt volume (ratio
 * honesty: no denominator, no ratio).
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
                  {C.sentence(25, concentration.top25SharePct, concentration.top25Count)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-heading text-3xl font-semibold tabular-nums">
                  {Math.round(concentration.top10SharePct)}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {C.sentence(10, concentration.top10SharePct, concentration.top10Count)}
                </span>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">
              Across {concentration.resolvedPeople} people with recorded prompts.
            </span>
          </>
        )}
      </CardContent>
    </Card>
  );
}
