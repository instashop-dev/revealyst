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

/** Post-create state applied to a connection made by loadFixture. */
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
};

export type SeedPlan = {
  /** Last day WITH data (yesterday UTC when run live; fixed in tests). */
  anchorDay: string;
  orgs: SeedOrgPlan[];
  /** Flip one migration-seeded benchmarks row to status='verified'. */
  verifyBenchmarkRow?: boolean;
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
