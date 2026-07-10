import Link from "next/link";
import { PauseCircle, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  CustomIndexResult,
  CustomIndexView,
} from "@/lib/custom-index-impl";

// Shown to non-entitled admins (Personal/free, or a lapsed Team org). Pure
// upsell for orgs with no customs; for a LAPSED org that still has custom
// indexes, their last computed results render in an explicit "paused" state
// (§8.5 guardrail 5) — never silently stale, and never recomputing until the
// subscription resumes.
export function IndexTeaser({
  indexes,
  results,
}: {
  indexes: CustomIndexView[];
  results: Record<string, CustomIndexResult>;
}) {
  const active = indexes.filter((i) => i.status === "active");
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            Build your own index
          </CardTitle>
          <CardDescription>
            The Custom Index Builder lets an admin compose a bespoke
            AI-adoption index from the metric catalog — pick metrics, choose how
            they aggregate, set weights and normalization, preview against your
            own recent data, and publish a versioned definition that joins the
            nightly recompute. It is part of the Team plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Team- and org-level indexes over the same honest engine your presets use.</li>
            <li>Weights that must sum to 1, with live feedback as you build.</li>
            <li>Read-only preview against your recent data before you publish.</li>
            <li>Up to 10 active indexes, with archive and unarchive.</li>
          </ul>
          <div>
            <Button render={<Link href="/billing" />}>Upgrade to Team</Button>
          </div>
        </CardContent>
      </Card>

      {active.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PauseCircle className="size-4 text-muted-foreground" />
              Paused custom indexes
            </CardTitle>
            <CardDescription>
              Your Team subscription has lapsed, so these indexes have stopped
              recomputing. The figures below are the last values computed while
              your subscription was active — they are not being updated. Resume
              your subscription to start recomputing them again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {active.map((index) => {
              const result = results[index.slug];
              return (
                <div
                  key={index.slug}
                  className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-foreground/10"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{index.name}</span>
                    <Badge variant="outline" className="gap-1">
                      <PauseCircle className="size-3" />
                      Paused
                    </Badge>
                  </div>
                  <PausedResults result={result} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PausedResults({ result }: { result: CustomIndexResult | undefined }) {
  if (!result || result.entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No results were computed for this index before it was paused.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">
        Last computed for the period ending {result.periodEnd}
      </span>
      {result.entries.map((entry) => (
        <div
          key={`${entry.teamId ?? "org"}`}
          className="flex items-center justify-between"
        >
          <span className="text-muted-foreground">{entry.label}</span>
          <span className="font-medium tabular-nums">
            {Math.round(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
