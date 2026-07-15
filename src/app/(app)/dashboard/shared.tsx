import type { ReactNode } from "react";
import Link from "next/link";
import { Info, Lightbulb, TriangleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCents } from "@/lib/format";
import { type CostPerActiveUserNumber } from "@/lib/maturity";
import { type AttentionItem } from "@/lib/score-insights";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** A wide lookback so the dashboard shows the latest scored period regardless
 * of which grain the recompute wrote (nightly rolling_28d, monthly, …). */
export function dashboardWindow(): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - 180 * DAY_MS).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}

// ─── "Needs attention" strip — shared between the personal and team views ───

function attentionActionLabel(href: string): string {
  if (href === "/reconcile") return "Match accounts";
  if (href === "/connections") return "Go to Connections";
  return "View";
}

function AttentionAlert({ item }: { item: AttentionItem }) {
  const isAction = item.severity === "action";
  const isRecommendation = item.kind === "recommendation";
  return (
    <Alert>
      {isAction ? (
        <TriangleAlert />
      ) : isRecommendation ? (
        <Lightbulb className="text-muted-foreground" />
      ) : (
        <Info className="text-muted-foreground" />
      )}
      <AlertTitle className={isAction ? undefined : "text-muted-foreground"}>
        <span className="inline-flex items-center gap-2">
          {item.title}
          {isRecommendation ? (
            <Badge variant="outline" className="font-normal">
              Guidance
            </Badge>
          ) : null}
        </span>
      </AlertTitle>
      <AlertDescription>
        <p>{item.body}</p>
        {item.href ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            nativeButton={false}
            render={<Link href={item.href} />}
          >
            {attentionActionLabel(item.href)}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** Renders `deriveAttention`'s output as one Alert per item, ordered as
 * returned (action severity first, then info, each impact-ranked). Renders
 * nothing when there is nothing to surface — never an empty section shell. */
export function AttentionSection({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <AttentionAlert key={`${item.severity}-${i}-${item.title}`} item={item} />
      ))}
    </div>
  );
}

/** Deliverable 5: Spend Governance as a one-LINE exec summary (the full /spend
 * page stays). Reported spend + the measured cost-per-active-person + a link to
 * manage budgets. Reported/measured only — never an estimated or ROI figure
 * (invariant b). */
export function SpendGovernanceLine({
  spendCents,
  spendCentsEstimated,
  costPerActiveUser,
  estimatedQualifier,
}: {
  spendCents: number;
  spendCentsEstimated: number;
  costPerActiveUser: CostPerActiveUserNumber;
  /** Data-confidence "Estimated" chip, rendered only when a live cost-estimate
   * disclosure affects the spend figure (invariant b: mark only affected). */
  estimatedQualifier?: ReactNode;
}) {
  if (spendCents === 0 && spendCentsEstimated === 0) return null;
  const cpu = costPerActiveUser.cost;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 text-sm">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground">AI spend this period:</span>
          <span className="font-medium tabular-nums">
            {formatCents(spendCents)} total
          </span>
          {spendCentsEstimated > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              (+{formatCents(spendCentsEstimated)} estimated)
            </span>
          ) : null}
          {estimatedQualifier}
          {cpu ? (
            <span className="text-muted-foreground tabular-nums">
              · {formatCents(cpu.centsPerUnit)} per active person
            </span>
          ) : null}
        </span>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/spend" />}
        >
          <Wallet data-icon="inline-start" />
          Manage budgets
        </Button>
      </CardContent>
    </Card>
  );
}
