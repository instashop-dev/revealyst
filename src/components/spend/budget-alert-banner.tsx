import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/banner";
import { formatCents } from "@/lib/format";
import type { BudgetAlert } from "@/lib/spend-governance";

// The in-app spend-budget alert (W4-V). Renders when vendor-reported
// month-to-date spend has crossed a configured threshold. Honesty framing is
// mandatory (§9): the threshold is measured against VENDOR-REPORTED billed
// spend only — derived/estimated costs are shown separately on /spend and are
// not counted toward the budget, because they can overlap billed figures
// (invariant b, no double-count). Vendor spend data is day-grain and restated
// up to ~24h, so this is an OBSERVED-burn crossing, never a "before you
// overspend" guarantee. `showManageLink` adds a jump to /spend from the dashboard.
export function BudgetAlertBanner({
  alert,
  reportedCents,
  monthlyLimitCents,
  showManageLink = false,
}: {
  alert: BudgetAlert;
  reportedCents: number;
  monthlyLimitCents: number;
  showManageLink?: boolean;
}) {
  const pct = Math.round(alert.pctUsed);
  return (
    <Banner
      // Threshold-crossed-but-under-budget is a WARNING (it kept the
      // triangle icon pre-U0.4 too), never neutral info — only a full
      // over-budget state escalates to critical.
      tone={alert.overBudget ? "critical" : "warning"}
      title={
        alert.overBudget
          ? "AI spend is over budget this month"
          : `AI spend has reached ${alert.crossedThreshold}% of budget`
      }
    >
      <p>
        Vendor-reported spend so far this month is{" "}
        {formatCents(reportedCents)} of your {formatCents(monthlyLimitCents)}{" "}
        budget ({pct}%). Derived/estimated costs are shown separately and
        aren&apos;t counted toward the budget — they can overlap billed
        figures. Vendor spend data is day-grain and can be restated for up to
        ~24 hours, so this reflects observed billed burn, not a real-time
        overspend guarantee.
      </p>
      {showManageLink ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          nativeButton={false}
          render={<Link href="/spend" />}
        >
          View spend & budget
        </Button>
      ) : null}
    </Banner>
  );
}
