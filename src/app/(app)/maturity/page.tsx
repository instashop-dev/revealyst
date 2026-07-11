import { MaturityReport } from "@/components/maturity/maturity-report";
import { PageHeader } from "@/components/page-header";
import { requireAppContext } from "@/lib/api-context";
import { readMaturityView } from "@/lib/maturity";
import { timeStage } from "@/lib/request-timing";

// AI Maturity Model report (F2.1 / research §10) — the market's first
// telemetry-derived maturity model + the one-page board artifact. Pure lib
// composite over existing org-scoped readers (readMaturityView does ONE flat
// Promise.all, round-trip depth 1); no new tables, no ADR — v1 recomputes at
// request time from unpurged data. Auth + shell + the free-band paywall come
// from the (app) layout. Every read goes through ctx.scope (forOrg).

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI maturity · Revealyst",
};

export default async function MaturityPage() {
  const ctx = await requireAppContext("/maturity");
  const today = new Date().toISOString().slice(0, 10);
  const view = await timeStage("pageData", () =>
    readMaturityView(ctx.scope, today),
  );

  const isPersonal = ctx.org.kind === "personal";
  return (
    <>
      <PageHeader
        title="AI maturity"
        description={
          isPersonal
            ? "Where your AI use sits on the maturity model — measured axes, a modeled level, and the numbers behind it. Tap any info icon for a plain-English explanation."
            : "Where your organization sits on the AI maturity model — measured across breadth, depth, and consistency — plus the board-legible numbers behind it. The level is a modeled, leading indicator, not a productivity claim."
        }
      />
      <div className="mt-6">
        <MaturityReport view={view} orgKind={ctx.org.kind} />
      </div>
    </>
  );
}
