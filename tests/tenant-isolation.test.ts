import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import {
  createFixtureOrg,
  loadFixture,
  type LoadedFixture,
} from "../src/db/fixtures";
import { benchmarkConsentForOrg } from "../src/db/benchmark-consent";
import { invitesForOrg } from "../src/db/invites";
import { forOrg } from "../src/db/org-scope";
import { shareLinksForOrg } from "../src/db/share-links";
import {
  applyPaddleSubscriptionEvent,
  subscriptionsForOrg,
} from "../src/db/subscriptions";
import * as schema from "../src/db/schema";
import type { CredentialEnv } from "../src/lib/credentials";

// THE W0 gate-item-6 suite: cross-org reads fail through the repository
// layer, cross-org rows are unrepresentable at the DB level, and every
// org-scoped table is swept — registry-driven, with a completeness
// assertion so a table added later cannot silently skip the sweep.

function testKek(): string {
  const bytes = new Uint8Array(32).fill(7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1:${btoa(binary)}`;
}
const ENV: CredentialEnv = { CREDENTIAL_KEK_CURRENT: testKek() };
const PERIOD = { start: "2026-06-01", end: "2026-06-30" };

const teamFixture = JSON.parse(
  readFileSync("fixtures/metric-records/team-30d.json", "utf8"),
);

let db: Db;
let orgA: string;
let orgB: string;
let A: LoadedFixture;
let B: LoadedFixture;
/** Every id belonging to org B — the sweep asserts none ever surfaces
 * through org A's scope. */
let bIds: Set<string>;

type Scope = ReturnType<typeof forOrg>;
type Ctx = { A: LoadedFixture; B: LoadedFixture; bDefinitionId: string };

// The registry: every read surface of OrgScopedDb, with the org-scoped
// tables it covers. The completeness test below fails if a table with an
// org_id column is not claimed by some entry (or documented as exempt).
const SCOPED_READS: Array<{
  name: string;
  tables: string[];
  run: (scope: Scope, ctx: Ctx) => Promise<unknown>;
}> = [
  { name: "people.list", tables: ["people"], run: (s) => s.people.list() },
  { name: "people.get(B)", tables: ["people"], run: (s, c) => s.people.get(c.B.people.alice) },
  { name: "teams.list", tables: ["teams"], run: (s) => s.teams.list() },
  { name: "teams.members(B)", tables: ["team_members"], run: (s, c) => s.teams.members(c.B.teams.core) },
  { name: "connections.list", tables: ["connections"], run: (s) => s.connections.list() },
  { name: "connections.get(B)", tables: ["connections"], run: (s, c) => s.connections.get(c.B.connections.anthropic) },
  { name: "subjects.list", tables: ["subjects"], run: (s) => s.subjects.list() },
  { name: "subjects.get(B)", tables: ["subjects"], run: (s, c) => s.subjects.get(c.B.subjects["alice-console"]) },
  { name: "identities.forSubject(B)", tables: ["identities"], run: (s, c) => s.identities.forSubject(c.B.subjects["shared-console"]) },
  { name: "identities.forPerson(B)", tables: ["identities"], run: (s, c) => s.identities.forPerson(c.B.people.bob) },
  { name: "metrics.records", tables: ["metric_records"], run: (s) => s.metrics.records({ metricKey: "active_day", from: PERIOD.start, to: PERIOD.end }) },
  { name: "metrics.signals(B)", tables: ["subject_day_signals"], run: (s, c) => s.metrics.signals({ subjectId: c.B.subjects["alice-console"], from: PERIOD.start, to: PERIOD.end }) },
  { name: "raw.get(B)", tables: ["raw_payloads"], run: (s, c) => s.raw.get(c.B.subjects["alice-console"]) },
  { name: "scores.definitions", tables: ["score_definitions"], run: (s) => s.scores.definitions() },
  // W4-U: org-scoped custom index rows (org_id set + `custom-` slug). B seeds
  // a `custom-b` definition, so a dropped org filter here leaks B's def id.
  { name: "scores.customDefinitions", tables: ["score_definitions"], run: (s) => s.scores.customDefinitions() },
  { name: "scores.results", tables: ["score_results"], run: (s) => s.scores.results({}) },
  { name: "billing.trackedUsers", tables: ["metric_records", "identities"], run: (s) => s.billing.trackedUsers(PERIOD) },
  { name: "heartbeats.list", tables: ["poll_heartbeats"], run: (s) => s.heartbeats.list() },
  { name: "auditLog.list", tables: ["audit_log"], run: (s) => s.auditLog.list() },
  // Budgets (ADR 0020): one row per org, keyed on the scope's orgId. Both orgs
  // seed a budget below, so B's budget id is in the leak universe — org A's
  // get() must surface only A's row.
  { name: "budgets.get", tables: ["budgets"], run: (s) => s.budgets.get() },
  // Budget-alert crossing state (ADR 0029): one row per (org, month), keyed on
  // the scope's orgId. Both orgs seed a claim for the same month below, so B's
  // row id is in the leak universe — org A's get() for that month must surface
  // only A's row (non-vacuous, mirrors budgets.get).
  {
    name: "budgetAlertState.get",
    tables: ["budget_alert_state"],
    run: (s) => s.budgetAlertState.get(PERIOD.start.slice(0, 7)),
  },
  // Renewal-reminder send-state (ADR 0032): one row per (connection, date,
  // threshold), FK'd to connections. Both orgs claim a reminder for their own
  // anthropic connection below, so B's row id joins the leak universe — org A's
  // list() must surface only A's rows (non-vacuous, mirrors budgetAlertState).
  {
    name: "renewalReminderState.list",
    tables: ["renewal_reminder_state"],
    run: (s) => s.renewalReminderState.list(),
  },
  // Digest preferences (ADR 0024): one row per (org, user), keyed on the
  // scope's orgId. Both orgs seed an enabled row below, so B's row id is in the
  // leak universe — org A's list() must surface only A's rows.
  {
    name: "digestPreferences.list",
    tables: ["digest_preferences"],
    run: (s) => s.digestPreferences.list(),
  },
  // Exec-report send state (ADR 0031): one row per org, keyed on the scope's
  // orgId. Both orgs claim a month below, so B's row id is in the leak universe
  // — org A's get() must surface only A's row (non-vacuous, mirrors budgets.get).
  {
    name: "execReportState.get",
    tables: ["exec_report_state"],
    run: (s) => s.execReportState.get(),
  },
  // Rec interaction state (ADR 0028): one row per (org, person, rec). Both orgs
  // seed a row for their own alice below, so keying `list` on B's alice puts a
  // B-owned personId in the leak universe — a dropped org filter would surface
  // B's row (non-vacuous, mirrors identities.forPerson(B)).
  {
    name: "recInteractions.list(B)",
    tables: ["rec_interaction_state"],
    run: (s, c) => s.recInteractions.list(c.B.people.alice),
  },
  // Role assignments (ADR 0030): org-scoped rows (org_id, person_id) → role.
  // Both orgs seed an assignment for their own alice below, so the B-side row
  // carries a B personId — org A's assignments() must surface only A's rows
  // (non-vacuous, mirrors recInteractions.list). The global `roles` reference
  // table has no org_id, so it is (correctly) outside the sweep.
  {
    name: "roles.assignments",
    tables: ["role_assignments"],
    run: (s) => s.roles.assignments(),
  },
  // Team → manager grants (ADR 0044): org-scoped rows keyed on (team_id,
  // user_id) with the composite tenant FK to teams. Both orgs seed a manager on
  // their own core team below, so keying `listForTeam` on B's core team puts a
  // B team uuid in the leak universe — a dropped org filter would surface B's
  // row (non-vacuous, mirrors teams.members).
  {
    name: "teamManagers.listForTeam(B)",
    tables: ["team_managers"],
    run: (s, c) => s.teamManagers.listForTeam(c.B.teams.core),
  },
  // Per-team admin settings (ADR 0045): one row per team, keyed on (org_id,
  // team_id). Both orgs seed a row on their own core team below (B's with
  // managers_see_individual_cost = true). `get` returns only settings VALUES
  // (a boolean, no uuid), so this generic uuid-leak sweep is a completeness
  // registration; the real cross-org guard — org A's get on B's team returns
  // DEFAULTS, not B's stored true — is the dedicated `it` below (mirrors the
  // connections.withCredential completeness-only entry).
  {
    name: "teamSettings.get(B)",
    tables: ["team_settings"],
    run: (s, c) => s.teamSettings.get(c.B.teams.core),
  },
  // Per-person capability state (ADR 0036): org-scoped rows (org_id, person_id,
  // capability). Both orgs seed a row for their own alice below, so keying
  // `forPerson` on B's alice puts a B personId in the leak universe — a dropped
  // org filter would surface B's row (non-vacuous, mirrors recInteractions).
  // The four capability-graph reference tables have no org_id and are outside
  // the sweep.
  {
    name: "mastery.forPerson(B)",
    tables: ["user_capability_state"],
    run: (s, c) => s.mastery.forPerson(c.B.people.alice),
  },
  // Per-capability team history rollup (ADR 0046): org-scoped count-only rows.
  // Both orgs seed a TEAM-scoped history row on their own core team below, so
  // the B-side row's `teamId` (the only uuid `list()` returns) is a B team uuid
  // in the leak universe — a dropped org filter would surface it (non-vacuous,
  // mirrors teamManagers.listForTeam). The row shape carries NO person id.
  {
    name: "capabilityHistory.list",
    tables: ["team_capability_history"],
    run: (s) => s.capabilityHistory.list(),
  },
  // Aggregate manager insight feed (ADR 0050): org-scoped count-only rows. Both
  // orgs seed a TEAM-scoped insight on their own core team below, so the B-side
  // row's `teamId` (a uuid `list()` returns) is a B team uuid in the leak
  // universe — a dropped org filter would surface it (non-vacuous, mirrors
  // capabilityHistory.list). The row carries NO person id.
  {
    name: "teamInsights.list",
    tables: ["team_insights"],
    run: (s) => s.teamInsights.list(),
  },
  // Manager notes (ADR 0053): org-scoped author-attributed coaching notes
  // (org, person). Both orgs seed a note about their own alice below. The
  // probe keys `listForPerson` on B's alice AND B's core team — the sharpest
  // cross-org shape: the membership row EXISTS in org B, so only the org
  // filter in the authz join stands between org A's scope and B's note (a
  // dropped filter would pass authz and a dropped filter on the notes read
  // would surface B's note uuid; non-vacuous by construction). The correct
  // result is `null` (unauthorized indistinguishable from missing) — pinned
  // by the dedicated cross-org test below.
  {
    name: "managerNotes.listForPerson(B)",
    tables: ["manager_notes"],
    run: (s, c) => s.managerNotes.listForPerson(c.B.people.alice, [c.B.teams.core]),
  },
  // Mission progress (ADR 0037): org-scoped opt-in rows (org, person, mission).
  // Both orgs seed a started mission for their own alice below, so B's row
  // carries a B personId — org A's progressForOrg must surface only A's rows.
  // The global missions/mission_steps reference tables have no org_id.
  {
    name: "missions.progressForOrg",
    tables: ["mission_progress"],
    run: (s) => s.missions.progressForOrg(),
  },
  // Recommendation exposures (ADR 0038): org-scoped append log (org, person,
  // rec, surface, day). Both orgs seed an exposure for their own alice below, so
  // B's row carries a B personId — org A's list() must surface only A's rows.
  // `list()` is server-side only (no manager route); this sweep is its guard.
  {
    name: "exposures.list",
    tables: ["recommendation_exposure"],
    run: (s) => s.exposures.list(),
  },
  // Recommendation catalog (ADR 0033): a nullable-org_id reference table like
  // score_definitions — global presets (org_id NULL) ∪ this org's own rows.
  // `list()` maps each row to the evaluator shape whose `id` IS the row's
  // `slug`, so B seeds an org-authored row with a UUID-valued slug (below): the
  // slug then joins the B-id leak universe AND is what `list()` returns, so a
  // dropped org filter would deterministically surface it (non-vacuous, the
  // score_definitions analogue for a content-mapping read).
  {
    name: "catalog.list",
    tables: ["recommendation_catalog"],
    run: (s) => s.catalog.list(),
  },
  // Desktop pairing codes (ADR 0047): consent-time rows keyed on the GLOBALLY
  // unique pairing handle. Both orgs seed a pairing below; keying `get` on B's
  // handle from org A's scope is the sharpest probe — the handle EXISTS
  // globally, so only the org filter stands between A and B's row (a dropped
  // filter deterministically surfaces it; non-vacuous by construction).
  {
    name: "desktopPairing.get(B)",
    tables: ["desktop_pairing_codes"],
    run: (s) => s.desktopPairing.get(bPairingHandle),
  },
  { name: "connectorRuns.list", tables: ["connector_runs"], run: (s) => s.connectorRuns.list() },
  { name: "connectorRuns.latest(B)", tables: ["connector_runs"], run: (s, c) => s.connectorRuns.latest(c.B.connections.anthropic) },
  // Credentials are read-only via withCredential, which throws for foreign
  // rows — asserted in its own test; listed here for completeness only.
  { name: "connections.withCredential", tables: ["connection_credentials"], run: async () => [] },
  // Invite reads live in src/db/invites.ts (ADR 0004), not on forOrg —
  // same org-scoping rules, swept via its own org-scoped factory.
  { name: "invites.listPending", tables: ["invites"], run: () => invitesForOrg(db, orgA).listPending() },
  // Share links + benchmark consent live in their own org-scoped factories
  // (ADR 0008), same rules. Public share resolution is a capability-token
  // read (asserted in share-links.test.ts), not an ambient org-scoped read.
  { name: "shareLinks.list", tables: ["share_links"], run: () => shareLinksForOrg(db, orgA).list() },
  // list(), not get(userId): a get keyed on an org-A-only userId can never
  // return org B's row regardless of the org filter (vacuous). list() is
  // org-filtered, so a dropped filter deterministically surfaces B's row.
  { name: "benchmarkConsent.list", tables: ["benchmark_consent"], run: () => benchmarkConsentForOrg(db, orgA).list() },
  // Subscriptions live in their own org-scoped factory (ADR 0009). The webhook
  // upsert (applyPaddleSubscriptionEvent) is a capability-style write keyed on
  // the passthrough orgId, not an ambient org-scoped read — list() is the
  // org-filtered read the sweep exercises.
  { name: "subscriptions.list", tables: ["subscriptions"], run: () => subscriptionsForOrg(db, orgA).list() },
];

/** Tables that legitimately carry org_id but sit outside the sweep. */
const EXEMPT_TABLES = new Set([
  "orgs", // the tenant root itself
  "org_members", // auth-owned; read only via membershipForUser (pre-scope)
]);

let bDefinitionId: string;
/** Org B's desktop-pairing handle (ADR 0047) — globally unique, so probing it
 * through org A's scope isolates the org filter itself. Assigned in
 * beforeAll, read only inside test bodies. */
let bPairingHandle!: string;

beforeAll(async () => {
  const pgliteDb = drizzle(new PGlite(), { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  db = pgliteDb as unknown as Db;

  orgA = (await createFixtureOrg(db, "iso-org-a", "team")).id;
  orgB = (await createFixtureOrg(db, "iso-org-b", "team")).id;
  A = await loadFixture(db, orgA, teamFixture);
  B = await loadFixture(db, orgB, teamFixture);

  // Round out both orgs' graphs: credentials, raw rows, heartbeats,
  // an org-custom score definition + result for B.
  for (const [orgId, loaded] of [
    [orgA, A],
    [orgB, B],
  ] as const) {
    const scoped = forOrg(db, orgId);
    await scoped.connections.storeCredential(
      loaded.connections.anthropic,
      "api_key",
      `sk-ant-${orgId}`,
      ENV,
    );
    await scoped.raw.insert({
      connectionId: loaded.connections.anthropic,
      vendor: "anthropic_console",
      kind: "usage_report.1d",
      payload: { org: orgId },
    });
    await scoped.heartbeats.record(`beat-${orgId}`);
    // A budget per org (ADR 0020) so budget ids join the leak universe and the
    // budgets sweep is non-vacuous.
    await scoped.budgets.set({ monthlyLimitCents: 100_000 });
    // A budget-alert crossing-state row per org (ADR 0029) for the same month,
    // so its row id joins the leak universe and the budgetAlertState sweep is
    // non-vacuous.
    await scoped.budgetAlertState.claimThreshold(PERIOD.start.slice(0, 7), 50);
    // An exec-report send-state row per org (ADR 0031): claim a month so its
    // row id joins the leak universe and the execReportState sweep is
    // non-vacuous (mirrors budgetAlertState).
    await scoped.execReportState.claimMonth(PERIOD.start.slice(0, 7));
    // A renewal-reminder claim per org (ADR 0032) on this org's anthropic
    // connection, so its row id joins the leak universe and the
    // renewalReminderState sweep is non-vacuous.
    await scoped.renewalReminderState.claim(
      loaded.connections.anthropic,
      "2026-08-01",
      30,
    );
    // A pending invite per org so the sweep's B-id universe includes one.
    const [inviter] = await db
      .insert(schema.user)
      .values({
        id: `iso-user-${orgId}`,
        name: "Iso Admin",
        email: `iso-${orgId}@example.com`,
      })
      .returning();
    await invitesForOrg(db, orgId).create(
      `invitee-${orgId}@example.com`,
      "member",
      inviter.id,
    );
    // An opt-in share link + a consent row per org (ADR 0008) so their B-side
    // ids join the leak universe and the sweep's assertions are non-vacuous.
    await shareLinksForOrg(db, orgId).create({
      personId: loaded.people.alice,
      scoreSlug: "fluency",
      publicLabel: "Ada",
      createdByUserId: inviter.id,
    });
    await benchmarkConsentForOrg(db, orgId).set(inviter.id, true);
    // An enabled digest preference per org (ADR 0024) so its row id joins the
    // leak universe and the digestPreferences sweep is non-vacuous.
    await scoped.digestPreferences.setEnabled(inviter.id, true);
    // A rec interaction row per org (ADR 0028) keyed on this org's alice, so
    // the B-side row carries a B personId and the recInteractions sweep is
    // non-vacuous.
    await scoped.recInteractions.set({
      personId: loaded.people.alice,
      recId: "adoption-active-days",
      state: "dismissed",
    });
    // A role assignment per org (ADR 0030) keyed on this org's alice, so the
    // B-side row carries a B personId and the roles.assignments sweep is
    // non-vacuous (mirrors the rec-interaction seed above).
    await scoped.roles.assign({
      personId: loaded.people.alice,
      roleSlug: "backend",
    });
    // A team-manager grant per org (ADR 0044) on this org's core team, keyed on
    // the org's own inviter user, so the B-side row carries a B team uuid and
    // the teamManagers.listForTeam sweep is non-vacuous (mirrors the role seed).
    await scoped.teamManagers.assign(loaded.teams.core, inviter.id);
    // A team-settings row per org (ADR 0045) on this org's core team, with the
    // toggle ON — so B genuinely stores `true` and the dedicated cross-org test
    // (org A's get on B's team must return the default `false`) is non-vacuous.
    await scoped.teamSettings.set(loaded.teams.core, {
      managersSeeIndividualCost: true,
    });
    // A capability-state row per org (ADR 0036) keyed on this org's alice, so
    // the B-side row carries a B personId and the mastery.forPerson sweep is
    // non-vacuous (mirrors the rec-interaction/role seeds above).
    await scoped.mastery.replaceForPerson(loaded.people.alice, [
      {
        personId: loaded.people.alice,
        capabilitySlug: "ai-coding-foundations",
        mastery: 0.5,
        confidence: 0.4,
        confidenceTier: "directional",
        evidenceCount: 3,
        lastEvidenceAt: "2026-06-15",
        staleness: 0,
        nextCapability: "feature-breadth",
        components: { active_days: { kind: "component", input: 50, contribution: 0.5 } },
      },
    ]);
    // A manager note per org (ADR 0053) about this org's alice, authored by
    // this org's inviter (who manages the core team per the grant above), so
    // the B-side row carries B person/note uuids and the managerNotes sweep +
    // the dedicated cross-org test below are non-vacuous.
    await scoped.managerNotes.create(
      loaded.people.alice,
      [loaded.teams.core],
      inviter.id,
      `coaching note for ${orgId}`,
      null,
    );
    // A started mission per org (ADR 0037) keyed on this org's alice, so the
    // B-side row carries a B personId and the missions.progressForOrg sweep is
    // non-vacuous (the mission slug is seeded globally by the migration).
    await scoped.missions.start(loaded.people.alice, "get-started-with-ai");
    // A TEAM-scoped capability-history row per org (ADR 0046) on this org's core
    // team, so the B-side row's teamId is a B team uuid in the leak universe and
    // the capabilityHistory.list sweep is non-vacuous (mirrors the team-manager
    // seed). Count-only — the row carries no person id.
    await scoped.capabilityHistory.upsertPeriod([
      {
        teamId: loaded.teams.core,
        capabilitySlug: "ai-coding-foundations",
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
        representedCount: 3,
        totalCount: 5,
        masteredCount: 1,
        developingCount: 2,
        confidenceTier: "directional",
      },
    ]);
    // A TEAM-scoped manager insight per org (ADR 0050) on this org's core team,
    // so the B-side row's teamId is a B team uuid in the leak universe and the
    // teamInsights.list sweep is non-vacuous (mirrors the capability-history
    // seed). Count-only — the row carries no person id.
    await scoped.teamInsights.upsertGenerated([
      {
        teamId: loaded.teams.core,
        category: "capability_gap",
        severity: "attention",
        subject: "ai-coding-foundations",
        params: { capabilitySlug: "ai-coding-foundations", mastered: 0, total: 3 },
        periodStart: PERIOD.start,
      },
    ]);
    // An exposure per org (ADR 0038) keyed on this org's alice, so the B-side
    // row carries a B personId and the exposures.list sweep is non-vacuous.
    await scoped.exposures.log([
      {
        personId: loaded.people.alice,
        recId: "adoption-active-days",
        surface: "digest",
        shownAt: "2026-06-15",
        experimentKey: null,
        variant: null,
      },
    ]);
    // A desktop pairing row per org (ADR 0047), consented by this org's
    // inviter user. Each org's handle is globally unique; B's is what the
    // desktopPairing.get(B) sweep probes through org A's scope, so its row id
    // joins the leak universe and the sweep is non-vacuous.
    const pairing = await scoped.desktopPairing.create({
      pairingId: `pair-${orgId}`,
      codeChallenge: "c".repeat(43),
      codeHash: "h".repeat(43),
      consentedUserId: inviter.id,
      deviceDisplayName: `Iso laptop ${orgId.slice(0, 8)}`,
      platform: "macos",
      architecture: "arm64",
      agentVersion: "0.1.0",
      installationId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 600_000),
    });
    if (orgId === orgB) {
      bPairingHandle = pairing.pairingId;
    }
    // An audit row per org (ADR 0010) whose target is a fixture team id, so
    // the B-side row carries a B id and the auditLog sweep is non-vacuous.
    await scoped.auditLog.record({
      actorUserId: inviter.id,
      action: "team.create",
      targetKind: "team",
      targetId: loaded.teams.core,
      metadata: { seededFor: orgId },
    });
    // A Team subscription per org (ADR 0009) so subscription ids join the leak
    // universe and the subscriptions sweep is non-vacuous.
    await applyPaddleSubscriptionEvent(db, {
      orgId,
      paddleSubscriptionId: `sub-${orgId}`,
      paddleCustomerId: `ctm-${orgId}`,
      occurredAt: new Date(`${PERIOD.start}T00:00:00Z`),
      status: "active",
      priceId: "pri_test",
      quantity: 5,
    });
    const run = await scoped.connectorRuns.start({
      connectionId: loaded.connections.anthropic,
      kind: "poll",
      windowStart: PERIOD.start,
      windowEnd: PERIOD.end,
    });
    await scoped.connectorRuns.finish(run.id, {
      subjectsSeen: 1,
      recordsUpserted: 1,
      signalsUpserted: 0,
      gaps: [],
    });
  }
  const [bDef] = await db
    .insert(schema.scoreDefinitions)
    .values({
      orgId: orgB,
      // `custom-` prefix (W4-U): exercises both the scores.definitions and the
      // scores.customDefinitions sweeps below with one B-owned org-scoped row.
      slug: "custom-b",
      version: 1,
      name: "B custom",
      subjectLevel: "org",
      components: [],
    })
    .returning();
  bDefinitionId = bDef.id;
  // W6-C (ADR 0033): an org-AUTHORED catalog row for B. Its `slug` is a UUID
  // string so it lands in the B-id leak universe (the beforeAll collects
  // uuid-shaped strings from B's rows) AND is exactly what `catalog.list()`
  // returns as each row's `id` — so org A's `catalog.list()` leaking B's row
  // would surface this uuid. Global presets (org_id NULL) are reference data,
  // shared by both orgs, and correctly outside the leak universe.
  await db.insert(schema.recommendationCatalog).values({
    orgId: orgB,
    slug: "11111111-1111-4111-8111-111111111111",
    version: 1,
    scoreSlug: "adoption",
    componentKey: "active_days",
    signalGroup: "active-days",
    title: "B org custom rec",
    body: "The active-days part of Adoption is measuring low.",
    requiredSignals: {
      comparators: [
        { kind: "measured" },
        { kind: "normalized-below", value: 40 },
        { kind: "min-weight", value: 0.2 },
      ],
    },
    benefit: "high",
    difficulty: "low",
    confidence: "high",
    insightKind: "adoption",
    suggestedActionType: "in-product-setting",
  });
  await forOrg(db, orgB).scores.upsertResults([
    {
      definitionId: bDef.id,
      subjectLevel: "org",
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
      periodGrain: "month",
      value: 42,
      attribution: "person",
      components: {},
    },
  ]);

  // The B-id universe: UUID values appearing in org B's rows and nowhere
  // in org A's — shared literals (pseudonyms, vendor names, enum values)
  // legitimately recur across orgs because both load the same fixture, so
  // only B-exclusive UUIDs are leak evidence.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const aIds = new Set<string>();
  bIds = new Set<string>();
  for (const table of Object.values(schema)) {
    if (!(table instanceof PgTable)) continue;
    const columns = getTableColumns(table);
    if (!("orgId" in columns) || getTableName(table) === "orgs") continue;
    const rows = (await db.select().from(table as never)) as Array<
      Record<string, unknown>
    >;
    for (const row of rows) {
      const target =
        row.orgId === orgB ? bIds : row.orgId === orgA ? aIds : null;
      if (!target) continue;
      for (const value of Object.values(row)) {
        if (typeof value === "string" && UUID_RE.test(value)) {
          target.add(value);
        }
      }
    }
  }
  bIds.delete(orgB); // the org id itself is not row data
  for (const shared of aIds) {
    bIds.delete(shared); // e.g. global preset definition ids
  }
  expect(bIds.size).toBeGreaterThan(12); // sanity: the universe is real
});

describe("registry-driven cross-org read sweep", () => {
  it("covers every org-scoped table (completeness tripwire)", () => {
    const covered = new Set(SCOPED_READS.flatMap((entry) => entry.tables));
    for (const table of Object.values(schema)) {
      if (!(table instanceof PgTable)) continue;
      const name = getTableName(table);
      if (EXEMPT_TABLES.has(name)) continue;
      if (!("orgId" in getTableColumns(table))) continue;
      expect(
        covered.has(name),
        `org-scoped table "${name}" is not covered by the isolation sweep — add a SCOPED_READS entry`,
      ).toBe(true);
    }
  });

  for (const entry of SCOPED_READS) {
    it(`${entry.name} never surfaces org B data through org A's scope`, async () => {
      const result = await entry.run(forOrg(db, orgA), { A, B, bDefinitionId });
      const serialized = JSON.stringify(result ?? null);
      for (const bId of bIds) {
        expect(
          serialized.includes(bId),
          `${entry.name} leaked org B id ${bId}`,
        ).toBe(false);
      }
    });
  }

  it("withCredential refuses org B's connection under org A's scope", async () => {
    await expect(
      forOrg(db, orgA).connections.withCredential(
        B.connections.anthropic,
        "api_key",
        ENV,
        async (p) => p,
      ),
    ).rejects.toThrow(/no api_key credential stored/);
  });

  it("managerNotes.listForPerson returns null for org B's person under org A's scope", async () => {
    // The sharpest cross-org probe (ADR 0053): B's alice IS a member of B's
    // core team, and B seeded a real note about her — so only the org filter
    // in the membership-JOIN authz stands between org A's scope and that note.
    const seen = await forOrg(db, orgA).managerNotes.listForPerson(
      B.people.alice,
      [B.teams.core],
    );
    expect(seen).toBeNull();
    // And B reads its own note — proving the seed is real, not absent.
    const bOwn = await forOrg(db, orgB).managerNotes.listForPerson(
      B.people.alice,
      [B.teams.core],
    );
    expect(bOwn).not.toBeNull();
    expect(bOwn!.length).toBe(1);
  });

  it("teamSettings.get returns defaults for org B's team under org A's scope", async () => {
    // The value-only guard the generic uuid sweep can't express: B stored
    // managers_see_individual_cost = true on B.teams.core in beforeAll; org A's
    // get keyed on that team must fall through the org filter to the DEFAULT
    // (false), never B's stored true.
    const seen = await forOrg(db, orgA).teamSettings.get(B.teams.core);
    expect(seen).toEqual({ managersSeeIndividualCost: false });
    // And B reads its own true — proving the seed is real, not absent.
    const bOwn = await forOrg(db, orgB).teamSettings.get(B.teams.core);
    expect(bOwn).toEqual({ managersSeeIndividualCost: true });
  });
});

describe("cross-org rows are unrepresentable (composite FKs + AAD)", () => {
  it("a credential row copied into another org fails GCM authentication", async () => {
    // Simulate a DB-level exfiltration: copy org A's ciphertext row onto
    // org B's connection. The composite FK permits it (B's connection is
    // real), but the AAD binding (orgId:connectionId:kind) makes the
    // ciphertext undecryptable outside its original binding.
    const [aRow] = await db
      .select()
      .from(schema.connectionCredentials)
      .where(eq(schema.connectionCredentials.orgId, orgA));
    await db.insert(schema.connectionCredentials).values({
      orgId: orgB,
      connectionId: B.connections.copilot,
      kind: aRow.kind,
      ciphertextB64: aRow.ciphertextB64,
      ivB64: aRow.ivB64,
      wrappedDekB64: aRow.wrappedDekB64,
      dekIvB64: aRow.dekIvB64,
      kekVersion: aRow.kekVersion,
    });
    await expect(
      forOrg(db, orgB).connections.withCredential(
        B.connections.copilot,
        aRow.kind,
        ENV,
        async (p) => p,
      ),
    ).rejects.toThrow();
  });

  it("subjects, identities, team members, records, and results reject cross-org writes", async () => {
    // Consolidated gate-pack assertions (each also covered in its own
    // suite): every write path either pre-checks ownership or hits a
    // composite FK.
    await expect(
      forOrg(db, orgA).subjects.upsertMany(B.connections.anthropic, [
        { kind: "person", externalId: "smuggle" },
      ]),
    ).rejects.toThrow();
    await expect(
      forOrg(db, orgA).identities.link(
        A.subjects["alice-console"],
        B.people.alice,
        "manual",
      ),
    ).rejects.toThrow();
    await expect(
      forOrg(db, orgA).teams.addMember(A.teams.core, B.people.alice),
    ).rejects.toThrow();
    await expect(
      forOrg(db, orgA).metrics.upsertRecords([
        {
          subjectId: B.subjects["alice-console"],
          metricKey: "active_day",
          day: "2026-06-15",
          connectionId: A.connections.anthropic,
          value: 1,
          attribution: "person",
          sourceConnector: "test@1",
        },
      ]),
    ).rejects.toThrow();
    await expect(
      forOrg(db, orgA).scores.upsertResults([
        {
          definitionId: bDefinitionId,
          subjectLevel: "person",
          personId: B.people.alice,
          periodStart: PERIOD.start,
          periodEnd: PERIOD.end,
          periodGrain: "month",
          value: 1,
          attribution: "person",
          components: {},
        },
      ]),
    ).rejects.toThrow();
  });
});
