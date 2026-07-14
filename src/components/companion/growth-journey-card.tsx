import Link from "next/link";
import { Sparkles } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  companionLevelCopy,
  GROWTH_JOURNEY_COPY,
} from "@/lib/companion-glossary";
import type { MaturityLevelValue } from "@/lib/maturity-glossary";
import type { AttentionItem } from "@/lib/score-insights";

/**
 * The companion surface's HEADLINE card (W5-C deliverable 1). Leads with the
 * person's modeled maturity level — org-of-one, so the level is personally true
 * (errata §1.2(6)) — plus the single next step (the top gated coaching
 * recommendation). It renders NO raw 0–100 score: the level, not a number, is
 * the headline (errata §1.2(9) — no blended per-person "AI health" number
 * anywhere). Level name/tagline come ONLY from maturity-glossary via
 * `companionLevelCopy`; this component never invents a level name. Server-safe,
 * pure props.
 */
export function GrowthJourneyCard({
  level,
  stale,
  nextStep,
}: {
  level: MaturityLevelValue | null;
  stale: boolean;
  /** The top coaching recommendation (first `deriveAttention` item with
   * `kind === "recommendation"`), or null when none currently fires. */
  nextStep: AttentionItem | null;
}) {
  const copy = companionLevelCopy(level, stale);
  const lead = copy.placed
    ? GROWTH_JOURNEY_COPY.levelLead
    : stale
      ? GROWTH_JOURNEY_COPY.staleLead
      : GROWTH_JOURNEY_COPY.formingLead;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 py-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {GROWTH_JOURNEY_COPY.title}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm text-muted-foreground">{lead}</span>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {copy.name}
            </h2>
            {copy.placed ? (
              <Badge variant="outline" className="font-normal">
                {GROWTH_JOURNEY_COPY.levelBadge}
              </Badge>
            ) : null}
            <InfoTip
              label="Your maturity level"
              short="A modeled reading of how sophisticated your AI use is, across three measured axes — a leading indicator, not a productivity score. Levels use uncalibrated thresholds, so they're directional."
              detail="Your level looks at your last 12 weeks, so it can change as new activity comes in and older activity drops off. It only reflects the tools you connect."
              learnMoreHref="/maturity"
            />
          </div>
          <p className="text-sm text-muted-foreground max-w-prose">
            {copy.tagline}
          </p>
        </div>

        <NextStep item={nextStep} placed={copy.placed} />
      </CardContent>
    </Card>
  );
}

function NextStep({
  item,
  placed,
}: {
  item: AttentionItem | null;
  placed: boolean;
}) {
  // Only offer a "next step" once a level is placed — a next step without a
  // starting point is noise. When placed but no recommendation fires, say so
  // honestly rather than fabricate a task.
  if (!placed) return null;

  if (item === null) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">
          {GROWTH_JOURNEY_COPY.noNextStep.headline}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {GROWTH_JOURNEY_COPY.noNextStep.body}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {GROWTH_JOURNEY_COPY.nextStepLabel}
      </p>
      <p className="mt-1 text-sm font-medium">{item.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
      {item.href ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          nativeButton={false}
          render={<Link href={item.href} />}
        >
          Take a look
        </Button>
      ) : null}
    </div>
  );
}
