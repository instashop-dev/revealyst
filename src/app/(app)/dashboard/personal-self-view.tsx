import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { CoachingCard } from "@/components/companion/coaching-card";
import {
  DataConfidenceCard,
  DataConfidenceProvider,
  MetricQualifier,
} from "@/components/companion/data-confidence";
import { MissionCard } from "@/components/companion/mission-card";
import { DailyNudgeCard } from "@/components/companion/daily-nudge-card";
import { DiagnosticDetails } from "@/components/companion/diagnostic-details";
import { GrowthJourneyCard } from "@/components/companion/growth-journey-card";
import { AgenticAdoptionCard } from "@/components/dashboard/agentic-adoption-card";
import { InfoTip } from "@/components/info-tip";
import { OnboardingInterim } from "@/components/onboarding-interim";
import { PageHeader } from "@/components/page-header";
import { ScoreCard, type ScoreCardData } from "@/components/scores/score-card";
import {
  fromPersonalScore,
  type PersonalScore,
} from "@/components/scores/score-card-model";
import { ShareScoreButton } from "@/components/share-score-button";
import { BudgetAlertBanner } from "@/components/spend/budget-alert-banner";
import { SyncStalenessBanner } from "@/components/sync-staleness-banner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listBenchmarks } from "@/db/benchmarks";
import {
  AGENTIC_WINDOW_DAYS,
  computeAgenticAdoption,
} from "@/lib/agentic-adoption";
import { detectDailySpike } from "@/lib/anomaly";
import { type AppContext } from "@/lib/api-context";
import { dashboardSummary } from "@/lib/api-impl";
import {
  buildDailyNudge,
  COMPANION_HEADER,
  DIAGNOSTIC_COPY,
} from "@/lib/companion-glossary";
import {
  MISSION_COPY,
  overallCapabilityBand,
} from "@/lib/capability-glossary";
import { buildDataConfidence } from "@/lib/data-confidence";
import { readMaturityView } from "@/lib/maturity";
import { readBudgetAlertForRole } from "@/lib/spend-governance";
import {
  CONCEPT_GLOSSARY,
  methodologyAnchor,
  SCORE_SLUGS,
  type ScoreSlug,
} from "@/lib/metrics-glossary";
import { isUsableConnection, syncedToolCount } from "@/lib/onboarding-guide";
import { timeStage } from "@/lib/request-timing";
import {
  connectionAttentionInputs,
  deriveAttention,
  personDeltaResult,
  personScoreDropAttribution,
  type DeltaResult,
} from "@/lib/score-insights";
import { deriveRecInteractionView } from "@/lib/rec-interactions";
import { recentlyShownRecIds } from "@/lib/recommendation-catalog";
import { periodFor, previousDay } from "@/scoring";
import { CAPABILITY_STATE_CONSTANTS } from "@/scoring/capability-state";
import { deriveMissionRows } from "@/scoring/mission-progress";
import { AttentionSection, DAY_MS, SpendGovernanceLine } from "./shared";

export async function PersonalSelfView({
  ctx,
  connectionsPromise,
}: {
  ctx: AppContext;
  // Passed in flight (not awaited) so it overlaps the pageData batch below —
  // resolved inside that batch's single Promise.all, then the onboarding gate
  // is evaluated on the result before any card renders.
  connectionsPromise: ReturnType<AppContext["scope"]["connections"]["list"]>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const period = periodFor("month", today);
  const prevPeriod = periodFor("month", previousDay(period.periodStart));
  // Independent reads (one Postgres round trip each on Workers→Hyperdrive→
  // Neon) — gathered concurrently rather than run one after another. The
  // previous-period score read is separate from `dashboardSummary`'s window
  // (which stays the current month, feeding "Spend this month") — it exists
  // purely to compute a same-definition-version delta, never to widen what
  // spend is summed over.
  // Kicked off once, then handed to BOTH `dashboardSummary` (which otherwise
  // fetches its own definitions internally, via hydrateScoreResults) and this
  // Promise.all directly — one definitions query per page load, not two,
  // while staying at round-trip depth 1 (dashboardSummary awaits the same
  // in-flight promise rather than starting a second query).
  const definitionsPromise = ctx.scope.scores.definitions();
  // A wider window than the current-month summary, purely so the agentic
  // adoption card has ~12 weeks to draw a real trend line (the lib slices to
  // its own AGENTIC_WINDOW_DAYS window ending today — this fetch matches it).
  // Org-of-one, so these rows are the viewer's own — the person-day rate IS
  // their personal rate.
  const agenticFrom = new Date(Date.now() - (AGENTIC_WINDOW_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const [
    connections,
    summary,
    verifiedBenchmarks,
    definitions,
    prevScores,
    budgetAlert,
    personalActiveDay,
    personalAgentActive,
    personalIdentities,
    personalSpend,
    maturity,
    recInteractions,
    recommendations,
    capabilityGraph,
    capabilityStates,
    missionCatalog,
    missionProgress,
    exposures,
  ] = await timeStage("pageData", () =>
      Promise.all([
        // Onboarding-gate read, folded in here so it overlaps the rest of the
        // batch instead of serializing ahead of the page (round-trip depth 1).
        connectionsPromise,
        dashboardSummary(
          ctx.scope,
          ctx.org.visibilityMode,
          { from: period.periodStart, to: period.periodEnd },
          { definitions: definitionsPromise },
        ),
        // Personal self-view compares against the "overall" segment — an
        // enterprise/smb norm is not this solo user's peer group.
        listBenchmarks(ctx.db, { status: "verified", segment: "overall" }),
        definitionsPromise,
        // Person-level only — this read exists purely to compute a
        // same-definition-version personal delta, so team/org-level rows
        // (which `personDeltaResult` would filter out in JS anyway) are
        // never fetched from Postgres in the first place.
        ctx.scope.scores.results({
          from: prevPeriod.periodStart,
          to: prevPeriod.periodEnd,
          subjectLevel: "person",
        }),
        // The month-to-date budget alert (W4-V), role-gated like TeamOverview's:
        // a personal-kind org CAN have an invited member (org-of-one machinery is
        // identical to Team), and the budget limit is admin-configured governance
        // — for a member the read is skipped entirely, not fetched-then-hidden.
        // Null also when no budget is set or no threshold is crossed.
        readBudgetAlertForRole(ctx.scope, ctx.role, today),
        // Agentic adoption inputs (F1.4). Numerator + denominator over the
        // wider trend window; the rate + weekly trend derive in JS below.
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
        // Identity links resolve the agentic rows' subject-days to
        // person-days — the same human often spans several vendor subjects
        // (review F1). Fetched inside this flat Promise.all: +1 query, still
        // round-trip depth 1.
        ctx.scope.identities.all(),
        // F2.3 (I2): reported spend over the same wide window, so the spend
        // spike detector has a trailing 28-day baseline (the current-month
        // summary window is too short). Org-of-one, so these rows are the
        // viewer's own spend. The ONE new stage-1 read this feature adds on the
        // personal path — inside this flat Promise.all, still round-trip depth
        // 1 (no new sequential stage).
        ctx.scope.metrics.records({
          metricKey: "spend_cents",
          from: agenticFrom,
          to: today,
        }),
        // Growth Journey headline (W5-C): the modeled maturity LEVEL — for an
        // org-of-one it is personally true (errata §1.2(6)). readMaturityView
        // does its OWN flat Promise.all internally, and because it is CALLED
        // here as an element of this outer Promise.all its internal reads are
        // kicked off synchronously (before its first await) alongside the
        // reads above — so the whole batch stays round-trip depth 1 (G10). We
        // never call readDashboardView + readMaturityView back-to-back; the
        // personal path composes maturity into this single existing stage.
        readMaturityView(ctx.scope, today),
        // W5-D: the signed-in person's recommendation interaction state
        // (snoozed/dismissed/tried), resolved by auth user INSIDE the query so
        // it needs no personId (unknown until `summary` resolves) and folds
        // into this flat Promise.all — +1 query, still round-trip depth 1 (G10).
        // Self-view by construction: returns only the caller's OWN person's
        // states (empty when no person is linked yet).
        ctx.scope.recInteractions.statesForUser(ctx.user.id),
        // W6-C (ADR 0033): the per-org recommendation catalog — ONE read folded
        // into this flat Promise.all (+1 query, still round-trip depth 1),
        // evaluated in memory by `deriveAttention` below (§8.2 perf floor).
        ctx.scope.catalog.list(),
        // W7-1: the capability graph (labels + prerequisite edges), same batch
        // — the coaching card's label source AND the W7-3 prerequisite gate.
        ctx.scope.capabilities.graph(),
        // W7-2: the signed-in user's OWN capability state (self-view), folded
        // into this depth-1 batch via a people.auth_user_id join so it needs no
        // resolved tracked personId ahead of the batch.
        ctx.scope.mastery.forUser(ctx.user.id),
        // W7-5: the global mission catalog + the signed-in user's own progress
        // (self-view), same batch.
        ctx.scope.missions.catalog(),
        ctx.scope.missions.progressForUser(ctx.user.id),
        // COACH-004 novelty: the signed-in person's OWN recommendation exposures
        // (self-view — the namespace joins people.auth_user_id), folded into this
        // flat Promise.all (+1 query, still round-trip depth 1). Recently-shown
        // recs score novelty 0 so guidance rotates. Empty when no person is
        // linked yet → every rec is fresh (byte-identical to pre-P7).
        ctx.scope.exposures.forUser(ctx.user.id),
      ]),
    );
  // Onboarding gate (evaluated here, after the overlapped read above, rather
  // than as a serial hop ahead of the batch): a fresh personal workspace with
  // no usable connection has nothing to show — send it to the focused
  // onboarding flow (W2-H) before rendering any card. An errored connection
  // (e.g. a rejected key at first attempt) does NOT count as connected, so a
  // bad first key can't strand the user on an empty dashboard; /onboarding
  // itself never redirects here, so there is no loop. `redirect()` throws, so
  // the batch's other (empty, on a fresh org) results are simply discarded.
  //
  // Fix 4: use the ONE shared `isUsableConnection` predicate (excludes both
  // "error" AND "paused") that the onboarding stepper uses — previously this
  // gate only excluded "error", so a user whose only connection was PAUSED saw
  // a bare empty dashboard instead of onboarding. This deliberately changes
  // behavior: a paused-only user now goes to /onboarding (resuming at the
  // connect step), matching what the interim/onboarding surfaces already treat
  // as "not ingesting".
  const hasUsableConnection = connections.some((c) =>
    isUsableConnection({ vendor: c.vendor, status: c.status }),
  );
  if (!hasUsableConnection) {
    redirect("/onboarding");
  }
  const agentic = computeAgenticAdoption({
    agentActiveRows: personalAgentActive,
    activeDayRows: personalActiveDay,
    identityLinks: personalIdentities,
    windowTo: today,
  });
  const scores = new Map<string, PersonalScore>(
    summary.scores
      .filter((s) => s.subjectLevel === "person" && s.periodGrain === "month")
      .map((s) => [s.definitionSlug, s]),
  );
  const prevMonthLabel = new Date(
    `${prevPeriod.periodStart}T00:00:00Z`,
  ).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  const deltas = new Map<ScoreSlug, DeltaResult | null>(
    SCORE_SLUGS.map((slug) => {
      const score = scores.get(slug);
      return [
        slug,
        personDeltaResult({
          currentValue: score?.value ?? null,
          currentVersion: score?.definitionVersion,
          prevRows: prevScores,
          definitions,
          slug,
          grain: "month",
          previousPeriodLabel: prevMonthLabel,
        }),
      ];
    }),
  );

  // Share the headline (fluency) score, and only once it's actually computed —
  // a share link to a "still computing" card isn't worth minting.
  const fluencyComputed = scores.has("fluency");
  const personId =
    summary.scores.find((s) => s.person)?.person?.id ?? null;

  // W7-1/W7-3: derive the capability label map + prerequisite edges from the
  // graph fetched above (zero new queries), and the person's eligibility context
  // for the coaching gates.
  const capabilityLabels = new Map(
    capabilityGraph.capabilities.map((c) => [c.slug, c.label]),
  );
  const capabilityPrereqs = new Map<string, string[]>();
  for (const dep of capabilityGraph.dependencies) {
    const list = capabilityPrereqs.get(dep.capabilitySlug);
    if (list) list.push(dep.requiresSlug);
    else capabilityPrereqs.set(dep.capabilitySlug, [dep.requiresSlug]);
  }
  const masteredCapabilities = new Set(
    capabilityStates
      .filter((s) => s.mastery >= CAPABILITY_STATE_CONSTANTS.MASTERED_THRESHOLD)
      .map((s) => s.capabilitySlug),
  );
  const connectedTools = new Set(
    connections.filter((c) => c.status === "active").map((c) => c.vendor),
  );
  // Safeguard (reliability-first): the prerequisite gate fails closed, so on
  // DIRECTIONAL-only mastery a forming person (nothing yet mastered) would be
  // gated down to root recs. Apply it ONLY once the person has established ≥1
  // capability; a forming person keeps the full coaching set. Tune away once
  // mastery is measured (P8).
  const prereqGateActive = masteredCapabilities.size > 0;

  // W7-5: mission card rows — status derived from the person's MEASURED mastery
  // (the same numbers the reducer uses to complete a mission) + their opt-in
  // progress, via the SHARED derivation (cannot drift from the Growth board).
  // Zero new queries — all from the batch above. The active strip below ignores
  // the extra `completedAt` field the helper returns.
  const missionRows = deriveMissionRows({
    catalog: missionCatalog,
    capabilityStates,
    progress: missionProgress,
  });

  // Build each card's data once, up front, so the F1.1 coaching gate and the
  // rendered cards read the SAME `componentRows` (one `formatComponentDetail`
  // per score, zero new queries — these are the already-fetched score rows).
  const cardData = new Map<ScoreSlug, ScoreCardData>(
    SCORE_SLUGS.map((slug) => [
      slug,
      fromPersonalScore({
        slug,
        score: scores.get(slug) ?? null,
        definitions,
        delta: deltas.get(slug) ?? null,
      }),
    ]),
  );
  // Coaching recommendations only consider scores that actually exist (G4 — no
  // guidance off a not-yet-computed score); gating (measured-and-weak) is
  // centralized inside deriveAttention.
  const scoreComponents = SCORE_SLUGS.filter((slug) => scores.has(slug)).map(
    (slug) => ({ slug, components: cardData.get(slug)!.componentRows }),
  );

  // F1.3 driver attribution: personScoreDropAttribution resolves the previous
  // row through the SAME selection personDeltaResult diffs against (shared
  // selector in score-insights.ts), so the named driver can't desynchronize
  // from the delta beside it. Zero new queries — prevScores is already fetched.
  const scoreDrops = SCORE_SLUGS.map((slug) => ({ slug, d: deltas.get(slug) }))
    .filter(
      (x): x is { slug: ScoreSlug; d: Extract<DeltaResult, { kind: "delta" }> } =>
        x.d?.kind === "delta",
    )
    .map((x) => {
      const score = scores.get(x.slug);
      return {
        slug: x.slug,
        delta: x.d.delta,
        attribution: score
          ? personScoreDropAttribution({
              currentVersion: score.definitionVersion,
              currentComponents: score.components,
              prevRows: prevScores,
              definitions,
              slug: x.slug,
              grain: "month",
            })
          : undefined,
      };
    });
  // F2.3 (I2): the viewer's own spend spike, staleness-gated (G5) inside
  // detectDailySpike. Org-of-one, so the daily spend total IS the viewer's. No
  // plateau on the self-view: a one-person "active-people cohort" is degenerate
  // (detectPlateau would return `insufficient`), so it's not computed here.
  const spendAnomaly = detectDailySpike({
    metric: "spend",
    records: personalSpend,
    today,
    connections,
  });
  const anomalies = spendAnomaly.kind === "spike" ? [spendAnomaly.signal] : [];
  // The identity-link callout is admin-gated the same way /reconcile itself
  // is — a non-admin member can't act on it, so it's never surfaced to them
  // (rather than shown and then dead-ending). It's further gated on having no
  // computed score yet (old behavior) — once scores are computing, the
  // unresolved-usage callout would just be noise alongside real numbers.
  // Both guards are shaped as raw facts and gated INSIDE deriveAttention now
  // (not by this call site's ternary) — see deriveAttention's unresolvedUsage
  // doc comment for why.
  //
  // W5-D interaction view is HOISTED above deriveAttention (COACH-004): its
  // `triedRecIds` is the fatigue set (a mild rank penalty), and it still drives
  // the downstream suppression filter. Pure derivation from the already-fetched
  // rows — zero new queries.
  const now = new Date();
  const { suppressedRecIds, triedRecIds } = deriveRecInteractionView(
    recInteractions,
    now,
  );
  // COACH-004 novelty: recs shown to this person within the lookback window
  // (from their own exposures) score novelty 0 so guidance rotates. Empty on a
  // person with no exposure history → every rec fresh (byte-identical output).
  const recentlyShown = recentlyShownRecIds(exposures, now);
  const attentionItems = deriveAttention({
    connections: connectionAttentionInputs(connections),
    unresolvedUsage: {
      count: summary.unresolvedSubjects,
      viewerIsAdmin: ctx.role === "admin",
      scoresExist: scores.size > 0,
    },
    // W7 Data Confidence: honesty gaps no longer render as one info Alert each
    // in the attention strip — they are aggregated into the single Data
    // Confidence card + drawer below (built from `summary.gaps`). Passing []
    // here removes the stacked banners without touching rec selection/order
    // (gaps never influenced coaching recs — they were separate info items).
    gaps: [],
    sharedAccountCount: 0,
    scoreDrops,
    scoreComponents,
    // W6-C: the per-org catalog fetched in this same flat Promise.all,
    // evaluated in memory here (§8.2 perf floor).
    recommendations,
    // W7-1: display-only capability labels for the coaching card.
    capabilityLabels,
    // W7-3 (now live): stage-1 eligibility. Role/tool always applied (inert for
    // the universal launch recs, future-proof); the prerequisite gate only once
    // the person has established ≥1 capability (the forming-user safeguard).
    connectedTools,
    ...(prereqGateActive ? { masteredCapabilities, capabilityPrereqs } : {}),
    // W7-4: the person's connected-source count (active connections' distinct
    // vendors) → the honest confidence disclosure on each coaching rec.
    coverageSourceCount: connectedTools.size,
    // COACH-004: fatigue (already "tried" recs, a mild penalty) + novelty
    // (recently-shown recs, novelty 0). Both derived above from this person's
    // own rows; empty sets leave the ranking byte-identical to pre-P7.
    fatigueRecIds: triedRecIds,
    recentlyShownRecIds: recentlyShown,
    anomalies,
  });
  // W5-C companion composition (positive-first, level-forward): the coaching
  // recommendations get their OWN dedicated card + seed the Growth Journey's
  // single next step, so they are PULLED OUT of the generic attention strip
  // (which keeps only the action alerts + early-warning signals — no
  // duplication). The top rec is the headline next step.
  const allCoachingRecs = attentionItems.filter(
    (i) => i.kind === "recommendation",
  );
  // W5-D: honour this person's interaction state — a dismissed rec, and a
  // snoozed one whose snooze hasn't expired, drop off the card entirely (and so
  // never seed the Growth Journey's next step below). A "tried" rec stays,
  // flagged so the card shows a "tried" indicator instead of the mark-tried
  // button. `suppressedRecIds`/`triedRecIds` were derived once, above, from the
  // already-fetched rows (no new query) and reused here + as the fatigue set.
  const coachingRecs = allCoachingRecs.filter(
    (i) => !(i.recId && suppressedRecIds.has(i.recId)),
  );
  const attentionStripItems = attentionItems.filter(
    (i) => i.kind !== "recommendation",
  );
  const topNextStep = coachingRecs[0] ?? null;
  // Daily nudge: ONE fresh fact from the last sync (never a dashboard, never a
  // freshness demand — principle 7). Built purely from data already in hand;
  // `maturity.dataAsOf` is the freshest successful sync across connections.
  const dailyNudge = buildDailyNudge({
    freshestSyncAt: maturity.dataAsOf,
    agentic,
    spendCents: summary.spendCents,
    hasScores: scores.size > 0,
  });

  // U1.1: the growth cluster (capability profile, missions catalog, milestones)
  // MOVED to the /growth route — the slow-moving improvement surface no longer
  // dilutes the daily Today surface. The active-mission STRIP stays (below), so
  // an in-flight mission remains a one-glance nudge here; its catalog + the
  // milestone timeline live on /growth. Milestone derivation is now the shared
  // `deriveCompanionMilestones` helper, called only on /growth (its inputs — the
  // current/previous score rows + agentic — are all in that route's own batch).
  const activeMissions = missionRows.filter((m) => m.status === "in-progress");

  // W7 Data Confidence: aggregate the raw honesty gaps into one trust story
  // (state + summary + grouped disclosures) — read-path only, built from data
  // already in hand. `dataAsOf` is the freshest successful sync (last checked);
  // a hard "sync-failed" state needs an errored connection AND no usable data.
  const dataConfidence = buildDataConfidence({
    gaps: summary.gaps,
    connectionErrored: connections.some((c) => c.status === "error"),
    hasData: scores.size > 0 || summary.activePeople > 0,
    lastCheckedAt: maturity.dataAsOf,
    now: new Date(),
    // T1.5 (TEL-016): re-homes the deleted orphaned signal-coverage badge onto
    // this always-relevant card, so a 1-source person can see their source
    // coverage without a rec being surfaced. Reuses the same `connectedTools`
    // already computed above for the coaching gate — zero new queries.
    sourceCount: connectedTools.size,
  });
  const costDisclosed = dataConfidence.groups.some(
    (g) => g.category === "cost-estimates",
  );
  // The "Partial" activity qualifier deep-links to whichever affected category
  // is actually present (coverage preferred), so the drawer opens on a real
  // section rather than an absent one.
  const coverageDisclosed = dataConfidence.groups.some(
    (g) => g.category === "coverage",
  );
  const importDisclosed = dataConfidence.groups.some(
    (g) => g.category === "import-quality",
  );
  const activityCategory = coverageDisclosed
    ? ("coverage" as const)
    : importDisclosed
      ? ("import-quality" as const)
      : null;
  // Don't show a reassuring "Reliable" card on a brand-new account that has no
  // data yet — surface the card only once there's data to trust, or something
  // to disclose (a non-reliable state). Minimal-by-default.
  const showDataConfidence =
    scores.size > 0 ||
    summary.activePeople > 0 ||
    dataConfidence.state !== "reliable";

  return (
    <DataConfidenceProvider model={dataConfidence}>
      <PageHeader
        title={COMPANION_HEADER.title}
        description={COMPANION_HEADER.description}
      >
        {fluencyComputed && personId && (
          <ShareScoreButton
            personId={personId}
            scoreSlug="fluency"
            defaultLabel={ctx.user.name ?? "My AI"}
          />
        )}
      </PageHeader>

      {budgetAlert ? (
        <BudgetAlertBanner
          alert={budgetAlert.alert}
          reportedCents={budgetAlert.reportedCents}
          monthlyLimitCents={budgetAlert.monthlyLimitCents}
          showManageLink
        />
      ) : null}

      <SyncStalenessBanner connections={connections} />

      {/* Action alerts + early-warning signals only — coaching recommendations
       * moved to their dedicated CoachingCard below, and honesty-gap disclosures
       * moved to the single Data Confidence card (no stacked banners). */}
      <AttentionSection items={attentionStripItems} />

      {/* HERO (U1.1): the companion headline is the page's dominant action —
       * level-forward, positive-first, its next-step CTA the one thing to do.
       * Leads with the modeled maturity level + the single next step (the
       * first-sync aha — "You're at <level>, here's the one thing to try next" —
       * NOT a raw score). No blended per-person "AI health" number anywhere
       * (errata §1.2(9)). Full-width above the actions/rail split below. */}
      <GrowthJourneyCard
        level={maturity.level}
        stale={maturity.stale}
        nextStep={topNextStep}
        // W7-4 follow-up: null until mastery is MEASURED (OTel/P8) — today all
        // capability state is directional, so this stays null and the modeled
        // maturity level remains the headline.
        capabilityBand={overallCapabilityBand(capabilityStates)}
      />

      {/* 12-col split (U1.1): the daily ACTIONS (coaching + the active-mission
       * strip) lead on the left; the RAIL (one fresh signal + the trust card)
       * sits alongside on desktop and stacks under the actions on mobile. */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          {/* Next best actions: the two weakest-first coaching recs (display
           * cap only — selection/order stay deriveAttention's, pinned by the
           * digest-parity test). This route logs NO exposures (only the digest
           * does, keyed to what IT shows), so the display cap can't desync any
           * exposure log. The hero already surfaces rec #1 as the next step. */}
          <CoachingCard
            recommendations={coachingRecs.slice(0, 2)}
            personId={personId}
            triedRecIds={[...triedRecIds]}
          />

          {/* Active-mission STRIP: in-progress missions only — a one-glance
           * nudge to keep going. The full catalog + completed timeline live on
           * /growth. Renders the strip only when a mission is in flight; the
           * "All missions" link is always offered so the catalog is reachable. */}
          {activeMissions.length > 0 ? (
            <MissionCard missions={activeMissions} />
          ) : null}
          <Link
            href="/growth"
            className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {MISSION_COPY.allLink}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <DailyNudgeCard nudge={dailyNudge} />

          {/* W7 Data Confidence: ONE compact card replacing the disclosure
           * banner stack. Answers "can I trust this?" and opens a details
           * drawer. Inside DataConfidenceProvider so the drawer is shared with
           * the inline metric qualifiers in the expander below. */}
          {showDataConfidence ? <DataConfidenceCard /> : null}
        </div>
      </div>

      {scores.size === 0 && (
        // Connected, but no person scores computed yet — the F1.6 cliff. The
        // interim bridge renders ABOVE the still-computing score cards (the
        // grid below stays — its null-state cards explain each score): an
        // honest, sync-state-aware "here's what we ingested; first scores
        // by …" plus the first-week checklist. Ingestion evidence derives
        // from data already in hand (summary + connections) — zero new reads.
        // Renders nothing when no usable (non-errored, non-paused) connection
        // exists (buildOnboardingInterim's `none` channel).
        <OnboardingInterim
          connections={connections}
          ingestionEvidence={{
            activePeople: summary.activePeople,
            unresolvedSubjects: summary.unresolvedSubjects,
            connectionsSynced: syncedToolCount(connections),
          }}
          isAdmin={ctx.role === "admin"}
        />
      )}

      {/* The diagnostic layer is DEMOTED behind ONE expander (U1.1), collapsed
       * by default: the raw 0–100 score grid PLUS the agentic-adoption card, the
       * spend one-liner, and the benchmarks card — the slow, numbers-heavy depth
       * a beginner never needs to open. The level + next step above are what to
       * act on. A plain-English intro sets that expectation. */}
      <DiagnosticDetails>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{DIAGNOSTIC_COPY.intro}</p>

          <div className="grid gap-4 md:grid-cols-3">
            {SCORE_SLUGS.map((slug) => (
              <ScoreCard key={slug} data={cardData.get(slug)!} />
            ))}
          </div>

          <AgenticAdoptionCard
            data={agentic}
            qualifier={
              activityCategory ? (
                <MetricQualifier
                  qualifier="partial"
                  category={activityCategory}
                  metricLabel="Activity totals"
                />
              ) : undefined
            }
          />

          {/* Spend as a compact one-line summary + drill-through to the full
           * /spend page (the same pattern Team uses). Renders nothing when there
           * is no spend yet. The estimated-spend breakdown + its methodology
           * note live on /spend. */}
          <SpendGovernanceLine
            spendCents={summary.spendCents}
            spendCentsEstimated={summary.spendCentsEstimated}
            costPerActiveUser={maturity.numbers.costPerActiveUser}
            estimatedQualifier={
              costDisclosed && summary.spendCentsEstimated > 0 ? (
                <MetricQualifier
                  qualifier="estimated"
                  category="cost-estimates"
                  metricLabel="AI spend"
                />
              ) : undefined
            }
          />

          {/* J1: the modeled-norms comparison panel (BenchmarkPanel) is
           * deliberately NOT rendered here. A single person vs. an org-modeled
           * peer curve is an unsupported comparison, and it previously sat right
           * above the verified-benchmarks card explaining "we don't show
           * unverified figures" — a direct contradiction. The team dashboard
           * keeps the panel; its own copy discloses the modeled-estimate
           * provenance (see CONCEPT_GLOSSARY.benchmarks).
           *
           * The benchmark opt-in (`BenchmarkConsentToggle`) lives on
           * Settings → Privacy (U3 / D-U5) — this card links there instead of
           * rendering a second copy of the toggle (one control, one home). */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                Benchmarks
                <InfoTip
                  label="Benchmarks"
                  short={CONCEPT_GLOSSARY.benchmarks.shortWhat}
                  learnMoreHref={`/methodology#${methodologyAnchor("benchmarks")}`}
                />
              </CardTitle>
              <CardDescription>
                How your scores compare to published norms.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {verifiedBenchmarks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Published benchmarks are being verified against primary sources
                  and will appear here — we don&apos;t show unverified figures.
                </p>
              ) : (
                <ul className="flex flex-col gap-3 text-sm">
                  {verifiedBenchmarks.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-4">
                      <span className="min-w-0">
                        <span className="font-medium capitalize">{b.scoreSlug}</span>
                        <span className="text-muted-foreground"> · {b.metricLabel}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {b.value !== null
                          ? `${b.value}${b.valueUnit === "percent" ? "%" : ""}`
                          : b.rangeLow !== null && b.rangeHigh !== null
                            ? `${b.rangeLow}–${b.rangeHigh}${b.valueUnit === "percent" ? "%" : ""}`
                            : "—"}
                        <span className="ml-2 text-xs">({b.sourceName})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t pt-4 text-sm text-muted-foreground">
                Want to help improve benchmarks anonymously? Manage that in{" "}
                <Link
                  href="/settings/privacy"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Settings → Privacy
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      </DiagnosticDetails>
    </DataConfidenceProvider>
  );
}
