import { GraduationCap, TrendingDown, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PlateauResult } from "@/lib/plateau";
import { championSegment, type SegmentDistribution } from "@/lib/segments";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

const COPY = TEAM_OVERVIEW_COPY.training;

/**
 * Training-opportunities lead card (W5-H card c): the action-shaped read of who
 * to enable. Names a leading cohort ONLY through `championSegment`, which
 * enforces the de-anonymization floor (never singles out an individual in a
 * small org — deliverable 6 champion-floor). Pairs it with the plateau verdict
 * so "momentum stalled" and "here's where to focus" sit together. Segment and
 * concentration detail render beside it in the page.
 */
export function TrainingOpportunitiesCard({
  segments,
  plateau,
}: {
  segments: SegmentDistribution;
  plateau: PlateauResult;
}) {
  const champion = championSegment(segments);
  const anySegmented = segments.segments.some((s) => s.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <GraduationCap className="size-4 text-muted-foreground" />
          {COPY.title}
        </CardTitle>
        <CardDescription>{COPY.lead}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {/* Champions — floor-gated so a lone bucket occupant is never named. */}
        {champion ? (
          <p>{COPY.champions(champion.count, champion.label)}</p>
        ) : anySegmented ? (
          <p className="text-muted-foreground">{COPY.championsCold}</p>
        ) : (
          <p className="text-muted-foreground">
            You&apos;ll see who could use a hand here once people have their
            own scores.
          </p>
        )}

        {/* Plateau verdict — the detectors already applied every staleness /
         * sufficiency gate, so we only phrase the genuine verdict here. */}
        {plateau.kind === "plateau" ? (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <TrendingDown className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Active-people usage is down {plateau.declinePct}% from its peak
              over the last {plateau.decliningWeeks}{" "}
              {plateau.decliningWeeks === 1 ? "week" : "weeks"} — a prompt to
              check in, not a verdict that anything is wrong.
            </span>
          </p>
        ) : plateau.kind === "none" ? (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="size-3.5 shrink-0" />
            Active-people usage is holding or growing week to week.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
