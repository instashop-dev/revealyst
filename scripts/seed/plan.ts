// Shared contract between the demo-seed generator (personas.ts/activity.ts,
// pure) and the loader (load.ts, DB-effectful). scripts/** is outside the
// org-scope guard's scan, but everything here still flows through the same
// repo-layer/factory seams production uses — see README.md in this directory.
import type { FixtureGraph } from "../../src/db/fixtures";
import type { HonestyGap } from "../../src/contracts/connector";
import type {
  ScoreComponent,
  ScoreDefinitionInput,
} from "../../src/contracts/scores";

/**
 * Post-create state applied to a connection made by loadFixture. The
 * loader's precedence (load.ts's applyConnectionState) is fixed and NOT
 * combinable — earlier wins:
 *   1. status "error"   → connections.setStatus(id, "error", lastError)
 *   2. status "paused"  → connections.setStatus(id, "paused")
 *   3. synced: true     → connections.markSynced(id) (agent connections)
 *   4. status "active"  → connections.markPolled(id, { ok: true })
 * A spec combining e.g. status "active" + synced: true takes the `synced`
 * branch (3), never both.
 */
export type ConnectionStateSpec = {
  /** FixtureGraph connections[].key */
  connection: string;
  status?: "active" | "paused" | "error";
  lastError?: string;
  /** Sets lastSuccessAt/lastPolledAt (agent connections use markSynced). */
  synced?: boolean;
};

export type ConnectorRunSpec = {
  /** FixtureGraph connections[].key */
  connection: string;
  kind: "poll" | "backfill";
  outcome: "success" | "error";
  /** YYYY-MM-DD inclusive window the run claims to cover. */
  windowStart: string;
  windowEnd: string;
  subjectsSeen?: number;
  recordsUpserted?: number;
  signalsUpserted?: number;
  gaps?: HonestyGap[];
  /** Required when outcome is "error". */
  error?: string;
};

export type SeedUserSpec = {
  /** Local key so other specs (consent, invitedBy) can reference the user. */
  key: string;
  name: string;
  email: string;
  password: string;
  /** org_members role in the org this spec appears under. */
  orgRole: "admin" | "member";
  /** Platform-staff flag (user.role = 'admin'). */
  platformAdmin?: boolean;
  /** FixtureGraph people[].key to link via people.authUserId. */
  person?: string;
};

/**
 * `publishCustomDefinition` itself carries no entitlement check — that gate
 * lives at src/lib/custom-index-impl.ts's `assertCustomIndexEntitledForOrg`
 * (checked only by the /api/indexes route). recomputeOrg re-derives
 * `customIndexesEntitled` from the org's LIVE subscription, so a custom
 * index only actually gets scored when the plan also loads a `subscription`
 * (in practice: an entitling subscription spec is required for this org's
 * custom indexes to produce score_results, even though this type doesn't
 * enforce it).
 */
export type CustomIndexSpec = {
  /** Must match /^custom-[a-z0-9]+(-[a-z0-9]+)*$/. */
  slug: string;
  name: string;
  subjectLevel: "team" | "org";
  components: ScoreComponent[];
  archived?: boolean;
};

export type ShareLinkSpec = {
  /** FixtureGraph people[].key (must be linked to a seed user). */
  person: string;
  scoreSlug: string;
  publicLabel: string;
};

export type RecomputeSpec = {
  grain: "week" | "month" | "rolling_28d";
  /** YYYY-MM-DD anchor passed to periodFor. */
  anchorDay: string;
};

/** One pass of the derived chain the poller's `score-recompute` step runs
 * AFTER recomputeOrg (src/poller/process.ts): recomputeCapabilityState →
 * recomputeCapabilityHistory → (optionally) recomputeTeamInsights, all at
 * `asOfDay`. Runs after the plan's `recompute[]` loop so score components
 * exist. Two passes (prev-month end, then anchor) give the insights engine a
 * real prior-period capability history for its movement categories. */
export type DerivedRecomputeSpec = {
  /** YYYY-MM-DD day the derived chain treats as "today". */
  asOfDay: string;
  /** Also run recomputeTeamInsights at this pass (team orgs only — a
   * personal org's insights are MIN_PEOPLE-suppressed anyway). */
  teamInsights?: boolean;
};

export type RoleAssignmentSpec = {
  /** FixtureGraph people[].key */
  person: string;
  /** Slug from the GLOBAL `roles` reference table (mig 0026). */
  roleSlug: string;
};

export type TeamManagerSpec = {
  /** FixtureGraph teams[].key */
  team: string;
  /** users[].key of the manager (a dashboard auth user, not a person). */
  user: string;
};

export type TeamSettingsSpec = {
  /** FixtureGraph teams[].key */
  team: string;
  managersSeeIndividualCost: boolean;
};

export type RenewalSpec = {
  /** FixtureGraph connections[].key */
  connection: string;
  /** YYYY-MM-DD user-entered renewal date (connections.renewal_date). */
  renewalDate: string;
  /**
   * T-thresholds (days-before) to pre-claim in renewal_reminder_state, as if
   * the reminder cron already sent them — so a live cron (dev or prod demo)
   * never emails a fixture address. The renewal CHIP renders from
   * connections.renewal_date, not from these claims.
   */
  claimThresholds?: number[];
};

export type DigestPreferenceSpec = {
  /** users[].key */
  user: string;
  enabled: boolean;
};

export type RecInteractionSpec = {
  /** FixtureGraph people[].key (must be linked to a seed user — interaction
   * state is self-view-only, so only a signed-in person's rows ever render). */
  person: string;
  /** recommendation_catalog slug (== CatalogRecommendation.id). */
  recId: string;
  state: "snoozed" | "dismissed" | "tried";
  /** YYYY-MM-DD; required narrative-wise when state is "snoozed". */
  snoozeUntilDay?: string;
};

export type RecExposureSpec = {
  /** FixtureGraph people[].key */
  person: string;
  /** recommendation_catalog slug. */
  recId: string;
  surface: "dashboard" | "digest";
  /** YYYY-MM-DD shown-at day (the exposure log's grain). */
  day: string;
};

export type PersonCreatedOnSpec = {
  /** FixtureGraph people[].key */
  person: string;
  /** YYYY-MM-DD the person became "known" to the org. Maturity's activation
   * denominator counts people by created_at AS OF each window end
   * (knownPeopleAsOf, src/lib/maturity.ts F3) — the fixture loader stamps
   * created_at = seed-run time, which postdates every data window, so
   * without this backdate the maturity LEVEL is structurally unplaceable
   * (activation divides by zero known people) on seeded data. */
  day: string;
};

export type MissionStartSpec = {
  /** FixtureGraph people[].key */
  person: string;
  /** Slug from the GLOBAL `missions` catalog (mig 0032). */
  missionSlug: string;
  /**
   * YYYY-MM-DD backdated opt-in day. Must precede any derivedRecompute pass
   * that could complete the mission, or the reducer's measured-crossing stamp
   * (completed_at = that pass's asOfDay) would predate the start.
   */
  startedOnDay: string;
};

export type SeedOrgPlan = {
  name: string;
  kind: "personal" | "team";
  visibilityMode?: "private" | "managed" | "full";
  /**
   * Personal orgs: when the org should come from the real signup path
   * (ensureOrgOfOne — clones person-level presets), set this to the key of
   * the users[] entry whose personal org receives the graph. Team orgs and
   * plain fixture orgs leave it unset (createFixtureOrg).
   */
  bootstrapUser?: string;
  users?: SeedUserSpec[];
  graph: FixtureGraph;
  connectionStates?: ConnectionStateSpec[];
  connectorRuns?: ConnectorRunSpec[];
  budget?: { monthlyLimitCents: number; alertThresholds?: number[] };
  subscription?: {
    status: "active" | "trialing" | "past_due" | "paused" | "canceled";
    quantity: number;
  };
  /**
   * Extra org-scoped score definitions inserted via loadScoreDefinitions
   * (the W2-H placeholder seam). Personal orgs get person-level preset
   * clones automatically (ensureOrgOfOne); a TEAM org that should render
   * the segments panel needs person-level clones seeded here, standing in
   * for W2-I's canonical segmentation job.
   */
  scoreDefinitions?: ScoreDefinitionInput[];
  customIndexes?: CustomIndexSpec[];
  shareLinks?: ShareLinkSpec[];
  invites?: { email: string; role: "admin" | "member" }[];
  /** users[].key → granted */
  benchmarkConsent?: { user: string; granted: boolean }[];
  auditEvents?: {
    /** users[].key of the actor. */
    actor: string;
    action: string;
    targetKind: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }[];
  /** Score recomputes to run after loading, in order. */
  recompute: RecomputeSpec[];
  /** Backdated people.created_at days (maturity activation denominators). */
  peopleCreatedOn?: PersonCreatedOnSpec[];
  /** Person → engineering-role assignments (roles namespace, mig 0026). */
  roleAssignments?: RoleAssignmentSpec[];
  /** Team → manager-user grants (teamManagers namespace, mig 0036). */
  teamManagers?: TeamManagerSpec[];
  /** Per-team settings rows (teamSettings namespace, mig 0039). Teams
   * without a spec stay at the absent-row defaults — the contrast case. */
  teamSettings?: TeamSettingsSpec[];
  /**
   * Monthly executive-memo state (mig 0028). `claimCurrentMonth` pre-claims
   * the anchor month so a live cron never emails a fixture address before
   * the demo data decays.
   */
  execReport?: { enabled: boolean; claimCurrentMonth?: boolean };
  /** User-entered connection renewal dates + pre-claimed reminder state. */
  renewals?: RenewalSpec[];
  /**
   * Budget-alert thresholds to pre-claim for the anchor month
   * (budget_alert_state CAS, mig 0025) — the thresholds the engineered MTD
   * spend has already crossed, so a live poll never re-emails them.
   */
  budgetClaimedThresholds?: number[];
  /** Explicit weekly-digest opt-in/out rows (absent row = lane default). */
  digestPreferences?: DigestPreferenceSpec[];
  /** Coaching-rec interaction states (snoozed/dismissed/tried, mig 0024). */
  recInteractions?: RecInteractionSpec[];
  /** Recommendation-exposure log rows (mig 0033) — days within
   * RECENTLY_SHOWN_LOOKBACK_DAYS of the anchor exercise novelty rotation. */
  recExposures?: RecExposureSpec[];
  /** Backdated mission opt-ins (mission_progress, mig 0032). Completion is
   * NEVER seeded — it must come from the derivedRecompute reducer pass. */
  missionStarts?: MissionStartSpec[];
  /** Derived-chain passes (capability state → history → insights), run
   * AFTER the recompute loop, in order. */
  derivedRecompute?: DerivedRecomputeSpec[];
};

export type SeedPlan = {
  /** Last day WITH data (yesterday UTC when run live; fixed in tests). */
  anchorDay: string;
  orgs: SeedOrgPlan[];
  /** Flip one migration-seeded benchmarks row (identified by scoreSlug +
   * componentKey) to status='verified'. */
  verifyBenchmark?: { scoreSlug: string; componentKey: string };
  /**
   * Extra org memberships for already-seeded users, applied AFTER the org
   * loop (both the user and the target org must exist by then) — the
   * workspace-switcher demo (a user in ≥2 orgs). Keys are the user's email
   * and the target org's exact plan `name` (prefixed by applyProdSafety).
   */
  crossOrgMemberships?: { email: string; orgName: string; role: "admin" | "member" }[];
  /**
   * Which org each listed user's switcher should resolve as ACTIVE — applied
   * last, via the production switchActiveOrg seam (stamps
   * org_members.last_active_at, ADR 0051). Without this, a cross-org member's
   * active org falls to created_at order, which the loader doesn't control.
   */
  activeWorkspaces?: { email: string; orgName: string }[];
};

/** Implemented in activity.ts (pure — no I/O, deterministic per anchor). */
export type BuildDemoSeedPlan = (anchorDay: string) => SeedPlan;

/** Implemented in load.ts. Returns per-org summaries for the CLI/tests. */
export type LoadSeedPlanResult = {
  orgs: {
    name: string;
    orgId: string;
    people: number;
    subjects: number;
    records: number;
    signals: number;
    scoreResults: number;
  }[];
};
