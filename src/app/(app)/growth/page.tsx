import Link from "next/link";
import { redirect } from "next/navigation";
import { CapabilityFullListCard } from "@/components/companion/capability-full-list-card";
import { GrowthJourneyCard } from "@/components/companion/growth-journey-card";
import { MilestoneCard } from "@/components/companion/milestone-card";
import { MissionBoard, type MissionBoardRow } from "@/components/companion/mission-board";
import { EmptyState } from "@/components/empty-state";
import { InfoTip } from "@/components/info-tip";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAppContext } from "@/lib/api-context";
import {
  AGENTIC_WINDOW_DAYS,
  computeAgenticAdoption,
} from "@/lib/agentic-adoption";
import { GROWTH_PAGE_COPY } from "@/lib/capability-glossary";
import { readMaturityView } from "@/lib/maturity";
import { deriveCompanionMilestones } from "@/lib/milestones";
import { timeStage } from "@/lib/request-timing";
import { vendorLabel } from "@/lib/vendor-labels";
import { periodFor, previousDay } from "@/scoring";
import { deriveMissionRows } from "@/scoring/mission-progress";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  // The agentic-adoption inputs span a wider trend window ending TODAY — the
  // SAME window the dashboard's AgenticAdoptionCard uses (windowTo: today), so
  // the two surfaces never disagree by a day on first-agent-session / weekly
  // cadence (readMaturityView's window ends YESTERDAY, so its agentic result is
  // deliberately NOT reused for the milestone gates here).
  const agenticFrom = new Date(Date.now() - (AGENTIC_WINDOW_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);

  // ONE flat Promise.all — round-trip depth 1 (G10), the same discipline as the
  // dashboard. readMaturityView is CALLED as an element of this batch so its own
  // internal flat Promise.all kicks off synchronously alongside the siblings
  // (never readDashboardView/readMaturityView back-to-back). It supplies the
  // hero level; the agentic result the milestone helper reads is computed here
  // from active_day/agent_active/identities over the window ending TODAY.
  const [
    maturity,
    capabilityGraph,
    capabilityStates,
    missionCatalog,
    missionProgress,
    currentScores,
    prevScores,
    connections,
    people,
    personalActiveDay,
    personalAgentActive,
    personalIdentities,
  ] = await timeStage("pageData", () =>
    Promise.all([
      readMaturityView(ctx.scope, today),
      ctx.scope.capabilities.graph(),
      ctx.scope.mastery.forUser(ctx.user.id),
      ctx.scope.missions.catalog(),
      ctx.scope.missions.progressForUser(ctx.user.id),
      // Current + previous month's person score rows — the breadth baseline the
      // milestone helper crosses. In a personal org with an invited member these
      // include OTHER people's rows too, so they are filtered to the caller's
      // OWN person below (invariant b — never celebrate someone else's breadth).
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
      // Resolve the CALLER's own person id (people.auth_user_id → id) so the
      // score rows above can be filtered to this person's growth only. An
      // EXISTING namespace method (people.list) — no frozen org-scope change.
      ctx.scope.people.list(),
      // Agentic-adoption inputs over the window ending TODAY (see agenticFrom) —
      // numerator + denominator + identity links; the rate + weekly trend derive
      // in JS below via computeAgenticAdoption(windowTo: today).
      ctx.scope.metrics.records({
        metricKey: "active_day",
        from: agenticFrom,
        to: today,
      }),
      ctx.scope.metrics.records({
        metricKey: "agent_active",
        from: agenticFrom,
        to: today,
      }),
      ctx.scope.identities.all(),
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

  // Missions — the SHARED derivation (cannot drift from the Today active-strip):
  // status from measured mastery + opt-in progress, plus the completion DATE for
  // the completed timeline. Zero new queries beyond the batch above.
  const missionRows: MissionBoardRow[] = deriveMissionRows({
    catalog: missionCatalog,
    capabilityStates,
    progress: missionProgress,
  });

  // Resolve the caller's own person id, then keep ONLY this person's score rows
  // for the milestone breadth baseline. If no person is linked to the signed-in
  // user, pass empty rows (no milestone — honest, never someone else's data).
  const callerPersonId =
    people.find((p) => p.authUserId === ctx.user.id)?.id ?? null;
  const ownCurrentScores = callerPersonId
    ? currentScores.filter((r) => r.personId === callerPersonId)
    : [];
  const ownPrevScores = callerPersonId
    ? prevScores.filter((r) => r.personId === callerPersonId)
    : [];

  // The person's own agentic adoption over the window ending TODAY — computed
  // exactly like personal-self-view.tsx, so the milestone gates match the
  // dashboard's AgenticAdoptionCard to the day.
  const agentic = computeAgenticAdoption({
    agentActiveRows: personalAgentActive,
    activeDayRows: personalActiveDay,
    identityLinks: personalIdentities,
    windowTo: today,
  });

  // Milestones — the SHARED helper (cannot drift from any other surface), fed
  // this route's own current/previous score rows (person-scoped) + the agentic
  // result computed above. Recompute-on-read, zero storage.
  const milestones = deriveCompanionMilestones({
    currentScoreRows: ownCurrentScores,
    prevScoreRows: ownPrevScores,
    agentic,
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
          {/* The full-list card guards its own empty state (move-the-gate-inside):
              on no evidenced rows it renders this connect-oriented empty state
              instead of an empty card shell. */}
          <CapabilityFullListCard
            rows={capabilityRows}
            labels={capabilityLabels}
            emptyState={
              <EmptyState
                variant="inline"
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
            }
          />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <MissionBoard missions={missionRows} />
          <MilestoneCard milestones={milestones} />
        </div>
      </div>
    </div>
  );
}
