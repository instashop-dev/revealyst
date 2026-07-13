import { PartyPopper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MILESTONE_COPY } from "@/lib/companion-glossary";
import type { Milestone } from "@/lib/milestones";

/**
 * The companion surface's celebratory card (W5-F deliverable 1). Positive-first:
 * it renders the period's grounded milestones — a new agentic session, a crossed
 * feature-breadth threshold, a new personal high, a steady weekly rhythm — each
 * drawn from measured, attributed activity (never a benchmark, never a
 * comparison to other people). Server-safe, pure props.
 *
 * It renders NOTHING when there are no milestones — never an empty shell and
 * never a fabricated celebration on thin data (invariant b). Milestones are
 * recompute-on-read (no storage): a milestone shows until the comparison that
 * produced it no longer holds (badge-until-superseded, §8.4).
 *
 * NO streak counter, NO daily anything, NO XP/leagues (the §8.4 NOT-list /
 * tripwire rule 7): the weekly-consistency milestone here is count-free
 * narrative, and there is no per-day mechanic anywhere on this card.
 */
export function MilestoneCard({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PartyPopper className="size-4 text-primary" aria-hidden="true" />
          {MILESTONE_COPY.title}
        </CardTitle>
        <CardDescription>{MILESTONE_COPY.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {milestones.map((milestone, i) => (
            <li
              key={`${milestone.kind}-${i}`}
              className="rounded-lg bg-muted/50 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{milestone.title}</p>
                <Badge variant="outline" className="font-normal">
                  {MILESTONE_COPY.badge}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {milestone.body}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
