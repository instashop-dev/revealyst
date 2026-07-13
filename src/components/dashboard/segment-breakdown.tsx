import type { SegmentDistribution } from "@/lib/segments";
import { InfoTip } from "@/components/info-tip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CONCEPT_GLOSSARY } from "@/lib/metrics-glossary";

/**
 * User segmentation (§8), team-level and COUNT-ONLY in every visibility mode
 * (errata §1.2 (5) / §7.3): a personality label attached to a real name is the
 * thing §7.3 kills, so individual members are never listed — not even under
 * managed/full visibility. People without a per-person score are surfaced as
 * "unsegmented", never bucketed.
 */
export function SegmentBreakdown({
  distribution,
}: {
  distribution: SegmentDistribution;
}) {
  const total = distribution.segments.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Segments
          <InfoTip
            label={CONCEPT_GLOSSARY.segments.plainName}
            short={CONCEPT_GLOSSARY.segments.shortWhat}
          />
        </CardTitle>
        <CardDescription>
          How the team splits across AI-adoption maturity.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {total === 0 ? (
          <p className="text-muted-foreground">
            No per-person scores yet — segmentation appears once individual
            scoring is available.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {distribution.segments.map((segment) => (
              <li
                key={segment.segment}
                className="flex items-center justify-between gap-2"
              >
                <span>{segment.label}</span>
                <span className="tabular-nums font-medium">
                  {segment.count}
                </span>
              </li>
            ))}
          </ul>
        )}
        {distribution.unsegmented > 0 ? (
          <p className="text-xs text-muted-foreground">
            {distribution.unsegmented}{" "}
            {distribution.unsegmented === 1 ? "person" : "people"} not yet
            segmented (no individual score — often shared-account activity).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
