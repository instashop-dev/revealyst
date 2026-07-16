import type { CorrelationResult } from "@/lib/correlation";
import type { Narrative } from "@/lib/narrative";
import { PeriodNarrativeCard } from "@/components/dashboard/period-narrative-card";
import { Button } from "@/components/ui/button";
import { TEAM_OVERVIEW_COPY } from "@/lib/team-overview-copy";

/**
 * Team overview narrative hero (U4.1). Promotes the shipped
 * `PeriodNarrativeCard` above the five-card fold as the page's opening
 * diagnosis, and renders ONE call to action beneath it — a same-page jump to
 * the training section (`#team-training`), the single safe enablement move.
 *
 * Reorder-only: it renders exactly the data the card already received inside
 * section (a); nothing new is computed or read. Server-safe (typed props, no
 * hooks) — the CTA is a plain in-page anchor, so no soft-nav/router involved.
 */
export function TeamNarrativeHero({
  narrative,
  correlations,
}: {
  narrative: Narrative;
  correlations: readonly CorrelationResult[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <PeriodNarrativeCard narrative={narrative} correlations={correlations} />
      <div>
        <Button
          size="sm"
          nativeButton={false}
          render={<a href="#team-training" />}
        >
          {TEAM_OVERVIEW_COPY.hero.ctaLabel}
        </Button>
      </div>
    </section>
  );
}
