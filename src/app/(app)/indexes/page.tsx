import { redirect } from "next/navigation";
import { IndexTeaser } from "@/components/indexes/index-teaser";
import { IndexWorkbench } from "@/components/indexes/index-workbench";
import { PageHeader } from "@/components/page-header";
import { subscriptionsForOrg } from "@/db/subscriptions";
import { requireAppContext } from "@/lib/api-context";
import {
  AGGREGATION_OPTIONS,
  METRIC_OPTIONS,
} from "@/lib/custom-index-catalog";
import {
  groupCustomIndexes,
  groupCustomIndexResults,
  isCustomIndexEntitled,
  type CustomIndexResult,
} from "@/lib/custom-index-impl";

// Custom Index Builder (W4-U, §8.5). Admin-only (role-gated server-side, like
// /members) and Team-paid (§8.5 guardrail 6): entitled admins get the full
// builder; everyone else gets a teaser. A lapsed Team org still sees its
// existing indexes' last results in an explicit "paused" state (guardrail 5).
export const dynamic = "force-dynamic";

export default async function IndexesPage() {
  const ctx = await requireAppContext();
  // Guardrail 1 of two access gates: admin only. The API routes enforce the
  // same role server-side.
  if (ctx.role !== "admin") {
    redirect("/dashboard");
  }
  // A ~9-week window catches the latest monthly and rolling-28d recompute so
  // each active index can show its most recent computed value.
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 63 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // One round-trip stage: entitlement + the three reads the index list and its
  // results both derive from (customDefinitions is fetched once, not twice).
  const [entitlement, defRows, resultRows, teams] = await Promise.all([
    subscriptionsForOrg(ctx.db, ctx.org.id).current(),
    ctx.scope.scores.customDefinitions(),
    ctx.scope.scores.results({ from, to }),
    ctx.scope.teams.list(),
  ]);
  const entitled = isCustomIndexEntitled(entitlement.plan);
  const indexes = groupCustomIndexes(defRows);
  const results: Record<string, CustomIndexResult> = Object.fromEntries(
    groupCustomIndexResults(defRows, resultRows, teams),
  );

  return (
    <>
      <PageHeader
        title="Custom indexes"
        description="Compose your own AI-adoption index from the metric catalog — team and org level only. Custom indexes are private to your workspace: they never appear on the benchmark panel or on shareable score cards."
      />
      {entitled ? (
        <IndexWorkbench
          indexes={indexes}
          results={results}
          metrics={METRIC_OPTIONS}
          aggregations={AGGREGATION_OPTIONS}
        />
      ) : (
        <IndexTeaser indexes={indexes} results={results} />
      )}
    </>
  );
}
