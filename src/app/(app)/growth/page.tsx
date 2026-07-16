import Link from "next/link";
import { redirect } from "next/navigation";
import { CapabilityProfileCard } from "@/components/companion/capability-profile-card";
import { GrowthJourneyCard } from "@/components/companion/growth-journey-card";
import { MilestoneCard } from "@/components/companion/milestone-card";
import { MissionBoard, type MissionBoardRow } from "@/components/companion/mission-board";
import { EmptyState } from "@/components/empty-state";
import { InfoTip } from "@/components/info-tip";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAppContext } from "@/lib/api-context";
import { GROWTH_PAGE_COPY } from "@/lib/capability-glossary";
import { readMaturityView } from "@/lib/maturity";
import { deriveCompanionMilestones } from "@/lib/milestones";
import { timeStage } from "@/lib/request-timing";
import { vendorLabel } from "@/lib/vendor-labels";
import { periodFor, previousDay } from "@/scoring";
import { completedStepCount } from "@/scoring/mission-progress";

export const dynamic = "force-dynamic";

/**
 * Growth — the personal improvement surface (U1.3). Where an individual sees
 * their capability decomposition, chooses what to get better at (missions), and
 * looks back on grounded milestones. Self-view ONLY: every read below is the
 * SIGNED-IN user's own (mastery.forUser / missions.progressForUser join
 * people.auth_user_id), never anyone else's — an admin sees their own growth
 * here, never a report on others (that stays the aggregate team surface).
 *
 * Gating (recorded assumption): a non-personal org redirects to /dashboard
 * rather than 404 — friendlier, and the nav only shows Growth for personal orgs
 * anyway. The SAME route activates for team-org members once T5.1 / W6-A clears
 * its dogfood gate (R7); nothing here is built ahead of that gate.
 */
export default async function GrowthPage() {
  const ctx = await requireAppContext();
  if (ctx.org.kind !== "personal") {
    redirect("/dashboard");
  }

  const today = new Date().toISOString().slice(0, 10);
  const period = periodFor("month", today);
  const prevPeriod = periodFor("month", previousDay(period.periodStart));

  // ONE flat Promise.all — round-trip depth 1 (G10), the same discipline as the
  // dashboard. readMaturityView is CALLED as an element of this batch so its own
  // internal flat Promise.all kicks off synchronously alongside the siblings
  // (never readDashboardView/readMaturityView back-to-back). It supplies the
  // hero level + the agentic-adoption result the milestone helper reads, so this
  // route adds no separate agentic reads.
  const [
    maturity,
    capabilityGraph,
    capabilityStates,
    missionCatalog,
    missionProgress,
    currentScores,
    prevScores,
    connections,
  ] = await timeStage("pageData", () =>
    Promise.all([
      readMaturityView(ctx.scope, today),
      ctx.scope.capabilities.graph(),
      ctx.scope.mastery.forUser(ctx.user.id),
      ctx.scope.missions.catalog(),
      ctx.scope.missions.progressForUser(ctx.user.id),
      // Current + previous month's OWN person score rows — the breadth baseline
      // the milestone helper crosses. Person-level only (team/org rows are never
      // this person's growth), so those rows are never fetched.
      ctx.scope.scores.results({
        from: period.periodStart,
        to: period.periodEnd,
        subjectLevel: "person",
      }),
      ctx.scope.scores.results({
        from: prevPeriod.periodStart,
        to: prevPeriod.periodEnd,
        subjectLevel: "person",
      }),
      // For the honest empty state's "which connector would add evidence" line.
      ctx.scope.connections.list(),
    ]),
  );

  const capabilityLabels = new Map(
    capabilityGraph.capabilities.map((c) => [c.slug, c.label]),
  );

  // Full capability list — every row that HAS a state row (zero-evidence
  // capabilities have no row, the engine rule; never a fabricated bar). Ordered
  // strongest-first by `mastery.forUser`.
  const capabilityRows = capabilityStates.map((s) => ({
    capabilitySlug: s.capabilitySlug,
    label: capabilityLabels.get(s.capabilitySlug) ?? s.capabilitySlug,
    mastery: s.mastery,
    confidenceTier: s.confidenceTier,
    nextCapability: s.nextCapability,
    lastEvidenceAt: s.lastEvidenceAt,
  }));

  // Missions — same status derivation as the Today active-strip (measured
  // mastery + opt-in progress), plus the completion DATE for the completed
  // timeline. Zero new queries beyond the batch above.
  const missionMasteryBySlug = new Map(
    capabilityStates.map((s) => [s.capabilitySlug, s.mastery]),
  );
  const missionStepsByMission = new Map<
    string,
    { capabilitySlug: string; targetMastery: number }[]
  >();
  for (const step of missionCatalog.steps) {
    const list = missionStepsByMission.get(step.missionSlug);
    const target = {
      capabilitySlug: step.capabilitySlug,
      targetMastery: step.targetMastery,
    };
    if (list) list.push(target);
    else missionStepsByMission.set(step.missionSlug, [target]);
  }
  const missionProgressBySlug = new Map(
    missionProgress.map((p) => [p.missionSlug, p]),
  );
  const missionRows: MissionBoardRow[] = missionCatalog.missions.map((m) => {
    const steps = missionStepsByMission.get(m.slug) ?? [];
    const prog = missionProgressBySlug.get(m.slug);
    const status = !prog
      ? ("not-started" as const)
      : prog.completedAt
        ? ("complete" as const)
        : ("in-progress" as const);
    return {
      slug: m.slug,
      title: m.title,
      summary: m.summary,
      status,
      stepsReached: completedStepCount(steps, missionMasteryBySlug),
      totalSteps: steps.length,
      completedAt: prog?.completedAt ? prog.completedAt.toISOString() : null,
    };
  });

  // Milestones — the SHARED helper (cannot drift from any other surface), fed
  // this route's own current/previous score rows + the agentic result from
  // readMaturityView (already computed over the same rows). Recompute-on-read,
  // zero storage.
  const milestones = deriveCompanionMilestones({
    currentScoreRows: currentScores,
    prevScoreRows: prevScores,
    agentic: maturity.numbers.agenticShare.agentic,
  });

  // Honest empty state (no capability evidence yet): name whether the person has
  // connected sources at all, so the guidance is real (connect a tool, or wait
  // for signal) — never a fabricated capability bar.
  const activeVendors = [
    ...new Set(
      connections
        .filter((c) => c.status === "active")
        .map((c) => vendorLabel(c.vendor)),
    ),
  ].sort();
  const hasCapabilities = capabilityRows.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={GROWTH_PAGE_COPY.title}
        description={GROWTH_PAGE_COPY.description}
      />

      {/* HERO: the level, framed as a narrative ladder (where you are + what it
          means) — the same maturity-glossary copy, expanded. Not a score chart,
          not a coaching CTA (that's Today). */}
      <GrowthJourneyCard
        level={maturity.level}
        stale={maturity.stale}
        nextStep={null}
        variant="growth"
      />

      {/* Desktop 7/5 split: capabilities lead, missions + milestones rail. */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <div className="flex items-center gap-1.5">
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              {GROWTH_PAGE_COPY.capabilitiesHeading}
            </h2>
            <InfoTip
              label={GROWTH_PAGE_COPY.confidenceInfo.label}
              short={GROWTH_PAGE_COPY.confidenceInfo.short}
            />
          </div>
          {hasCapabilities ? (
            <CapabilityProfileCard
              rows={capabilityRows}
              labels={capabilityLabels}
              fullList
            />
          ) : (
            <EmptyState
              title={GROWTH_PAGE_COPY.empty.headline}
              description={
                activeVendors.length > 0
                  ? `${GROWTH_PAGE_COPY.empty.withSources} Connected: ${activeVendors.join(", ")}.`
                  : GROWTH_PAGE_COPY.empty.noSources
              }
            >
              {activeVendors.length === 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/connections" />}
                >
                  {GROWTH_PAGE_COPY.empty.connectLabel}
                </Button>
              ) : null}
            </EmptyState>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <MissionBoard missions={missionRows} />
          <MilestoneCard milestones={milestones} />
        </div>
      </div>
    </div>
  );
}
