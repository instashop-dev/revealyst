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
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

/**
 * User segmentation (§8), team-level and COUNT-ONLY in every visibility mode
 * (errata §1.2 (5) / §7.3): a personality label attached to a real name is the
 * thing §7.3 kills, so individual members are never listed — not even under
 * managed/full visibility. People without a per-person score are surfaced as
 * "unsegmented", never bucketed.
 *
 * Distribution completeness (P2c): `notYetActive` is the COUNT of tracked people
 * with no measured AI activity in the period yet (the honest complement of the
 * segmented + unsegmented-but-active people). It is a number, never a per-person
 * list — the same structural no-person-id contract the segment counts keep — so
 * the breakdown can disclose how much of the team it does not yet cover instead
 * of implying the segmented people are the whole team.
 */
export function SegmentBreakdown({
  distribution,
  notYetActive,
}: {
  distribution: SegmentDistribution;
  /** Tracked people with no activity yet this period — count only. Omitted (or
   * 0) renders no line, so a fully-active team shows nothing extra. */
  notYetActive?: number;
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
            You&apos;ll see how the team splits into usage groups here once
            people have their own scores.
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
        {notYetActive && notYetActive > 0 ? (
          <p className="text-xs text-muted-foreground">
            {TEAM_OVERVIEW_COPY.notYetActive(notYetActive)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
