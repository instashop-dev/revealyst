import Link from "next/link";
import { ArrowRight, Check, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  buildOnboardingInterim,
  checklistForViewer,
  type ConnectionChannelInput,
  type IngestionEvidence,
} from "@/lib/onboarding-guide";

/**
 * The bridge between "connected" and "first scores" (F1.6). Shown on the
 * dashboard when usable connections exist but no scores have been computed
 * yet: what we've ingested so far, an honest channel-aware "when you'll see
 * scores" line, and a static first-week checklist. All copy comes from
 * src/lib/onboarding-guide.ts (G7); nothing here shows a teaser number.
 */
export function OnboardingInterim({
  connections,
  ingestionEvidence,
  isAdmin,
}: {
  connections: readonly ConnectionChannelInput[];
  ingestionEvidence?: IngestionEvidence;
  isAdmin: boolean;
}) {
  // scoresExist is false by construction at this call site (the dashboard only
  // renders this when no scores yet), but the helper stays the single source of
  // the derivation.
  const interim = buildOnboardingInterim({
    connections,
    scoresExist: false,
    ingestionEvidence,
  });
  if (!interim) return null;
  const steps = checklistForViewer(isAdmin);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-muted-foreground" />
          {interim.timing.headline}
        </CardTitle>
        <CardDescription>{interim.timing.detail}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {interim.connectedLabel && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Connected:</span>{" "}
            {interim.connectedLabel}
            {/* Channel-true suffix from the copy constants: "backfill in
             * progress" only when a poll vendor is present — the local Agent
             * is a one-shot client push with no backfill machinery. */}
            {interim.timing.connectionNote
              ? ` · ${interim.timing.connectionNote}.`
              : "."}
          </p>
        )}

        {interim.facts.length > 0 && (
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {interim.facts.map((fact) => (
              <div key={fact.key} className="flex flex-col">
                <span className="font-heading text-2xl font-semibold tabular-nums">
                  {fact.value}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fact.label}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Your first week</p>
          <ol className="flex flex-col gap-3">
            {steps.map((step) => (
              <li key={step.key} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                >
                  <Check className="size-3" />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium">{step.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {step.body}
                  </span>
                  {step.href && step.cta && (
                    <div className="pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={step.href} />}
                      >
                        {step.cta}
                        <ArrowRight data-icon="inline-end" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3" />
          Nothing here is estimated — scores only ever come from real,
          attributed metrics.
        </p>
      </CardContent>
    </Card>
  );
}
