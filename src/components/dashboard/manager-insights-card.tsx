import { Lightbulb } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TeamInsightRow } from "@/db/org-scope/team-insights";
import {
  MANAGER_INSIGHTS_COPY,
  renderTeamInsight,
  TEAM_INSIGHT_SEVERITY_LABEL,
} from "@/lib/team-insights-glossary";

// Aggregate manager insight feed card (TCI Phase 2-F, ADR 0050). Renders the
// OPEN feed (≤3) with plain-English copy composed from the glossary at render
// time — the DB stores NO prose. COUNT-ONLY: the row prop carries a category +
// count-only params + a capability subject slug, NEVER a person id or name, so
// no individual's data can leak through this card (structurally impossible).
// Server component; the per-insight dismiss is a small client leaf.
import { TeamInsightDismissButton } from "./team-insight-dismiss-button";

// The severity → left-accent color. Destructive/red is deliberately NOT used
// for any variant here — the strongest manager insight is "worth a look", not a
// critical alert (that framing is reserved for genuine failures elsewhere).
const ACCENT: Record<string, string> = {
  attention: "border-l-primary",
  opportunity: "border-l-primary/60",
  info: "border-l-muted-foreground/40",
};

export function ManagerInsightsCard({
  insights,
  capabilityLabels,
}: {
  insights: readonly TeamInsightRow[];
  /** Capability slug → display label (global reference data) for the glossary. */
  capabilityLabels: ReadonlyMap<string, string>;
}) {
  const labelFor = (slug: string) => capabilityLabels.get(slug) ?? slug;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="size-4 text-primary" aria-hidden="true" />
          {MANAGER_INSIGHTS_COPY.title}
        </CardTitle>
        <CardDescription>{MANAGER_INSIGHTS_COPY.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {MANAGER_INSIGHTS_COPY.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {insights.map((insight) => {
              const copy = renderTeamInsight(insight, labelFor);
              return (
                <li
                  key={insight.id}
                  className={`flex flex-col gap-1 rounded-lg border-l-2 bg-muted/50 px-3 py-2 ${
                    ACCENT[insight.severity] ?? ACCENT.info
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{copy.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {TEAM_INSIGHT_SEVERITY_LABEL[insight.severity] ??
                        insight.severity}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{copy.body}</p>
                  <div className="mt-1">
                    <TeamInsightDismissButton id={insight.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
