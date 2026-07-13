import { Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DAILY_NUDGE_COPY, type DailyNudge } from "@/lib/companion-glossary";

/**
 * The daily nudge card (W5-C deliverable 3): ONE fresh fact drawn from the most
 * recent sync — never a dashboard, never a data-freshness demand (principle 7).
 * The single fact is chosen by the pure `buildDailyNudge` builder; this
 * component renders nothing when there's no fresh, positive fact to show (so a
 * stale surface stays quiet rather than nagging). Server-safe, pure props.
 */
export function DailyNudgeCard({ nudge }: { nudge: DailyNudge | null }) {
  if (nudge === null) return null;
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-5">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Zap className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {DAILY_NUDGE_COPY.title}
          </span>
          <p className="text-sm font-medium">{nudge.headline}</p>
          <p className="text-sm text-muted-foreground">{nudge.detail}</p>
          {nudge.asOf ? (
            <p className="text-xs text-muted-foreground">
              {DAILY_NUDGE_COPY.asOfLead}{" "}
              {new Date(nudge.asOf).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
