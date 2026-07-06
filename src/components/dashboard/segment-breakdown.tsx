import type { SegmentDistribution } from "@/lib/segments";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * User segmentation (§8), team-level and count-first. In the private default
 * only counts show; managed/full visibility adds pseudonymous members. People
 * without a per-person score are surfaced as "unsegmented", never bucketed.
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
        <CardTitle>Segments</CardTitle>
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
              <li key={segment.segment} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span>{segment.label}</span>
                  <span className="tabular-nums font-medium">
                    {segment.count}
                  </span>
                </div>
                {segment.members.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {segment.members.map((member) => (
                      <Badge key={member.id} variant="secondary">
                        {member.displayName ?? member.pseudonym}
                      </Badge>
                    ))}
                  </div>
                ) : null}
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
