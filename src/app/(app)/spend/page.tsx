import { redirect } from "next/navigation";
import { BudgetAlertBanner } from "@/components/spend/budget-alert-banner";
import { BudgetEditor } from "@/components/spend/budget-editor";
import { SpendByModel, SpendByTool } from "@/components/spend/spend-breakdown";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAppContext } from "@/lib/api-context";
import { formatCents } from "@/lib/format";
import {
  DEFAULT_ALERT_THRESHOLDS,
  readSpendGovernance,
  todayUtc,
} from "@/lib/spend-governance";

export const dynamic = "force-dynamic";

export default async function SpendPage() {
  const ctx = await requireAppContext();
  // Budget is admin governance (like Billing/Members); the routes enforce the
  // same 403 server-side.
  if (ctx.role !== "admin") {
    redirect("/dashboard");
  }

  const view = await readSpendGovernance(ctx.scope, todayUtc());
  const monthLabel = new Date(`${view.window.from}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <>
      <PageHeader
        title="Spend governance"
        description={`Budget, alerts, and a spend breakdown across your connected AI tools — ${monthLabel} so far.`}
      />

      {view.alert ? (
        <BudgetAlertBanner
          alert={view.alert}
          reportedCents={view.reportedCents}
          monthlyLimitCents={view.budget!.monthlyLimitCents}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly budget</CardTitle>
            <CardDescription>
              Set an org-wide monthly spend budget to get in-app alerts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BudgetEditor
              initialLimitCents={view.budget?.monthlyLimitCents ?? null}
              thresholds={view.budget?.alertThresholds ?? DEFAULT_ALERT_THRESHOLDS}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spend this month</CardTitle>
            <CardDescription>
              Observed month-to-date, vendor-reported and derived kept separate.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div className="flex flex-col">
              <span className="font-heading text-3xl font-semibold tabular-nums">
                {formatCents(view.reportedCents)}
              </span>
              <span className="text-xs text-muted-foreground">
                Vendor-reported
              </span>
            </div>
            {view.estimatedCents > 0 && (
              <div className="flex flex-col">
                <span className="font-heading text-2xl font-semibold tabular-nums text-muted-foreground">
                  {formatCents(view.estimatedCents)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Derived / estimated
                </span>
              </div>
            )}
            {view.budget ? (
              <div className="flex flex-col">
                <span className="font-heading text-2xl font-semibold tabular-nums">
                  {formatCents(view.budget.monthlyLimitCents)}
                </span>
                <span className="text-xs text-muted-foreground">Budget</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend by tool</CardTitle>
          <CardDescription>
            Where the month&apos;s spend went, by connected tool.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpendByTool
            byTool={view.byTool}
            reportedCents={view.reportedCents}
            estimatedCents={view.estimatedCents}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model mix</CardTitle>
          <CardDescription>
            Usage by model across tools that report it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpendByModel byModel={view.byModel} />
        </CardContent>
      </Card>
    </>
  );
}
