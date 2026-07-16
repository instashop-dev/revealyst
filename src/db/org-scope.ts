import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers, orgs, scoreDefinitions } from "./schema";
import { auditLogNamespace } from "./org-scope/audit-log";
import { billingNamespace } from "./org-scope/billing";
import { budgetAlertStateNamespace } from "./org-scope/budget-alert-state";
import { budgetsNamespace } from "./org-scope/budgets";
import { capabilitiesNamespace } from "./org-scope/capabilities";
import { capabilityHistoryNamespace } from "./org-scope/capability-history";
import { catalogNamespace } from "./org-scope/catalog";
import { connectionsNamespace } from "./org-scope/connections";
import { connectorRunsNamespace } from "./org-scope/connector-runs";
import { desktopPairingNamespace } from "./org-scope/desktop-pairing";
import { digestPreferencesNamespace } from "./org-scope/digest-preferences";
import { execReportStateNamespace } from "./org-scope/exec-report-state";
import { exposuresNamespace } from "./org-scope/exposures";
import { heartbeatsNamespace } from "./org-scope/heartbeats";
import { identitiesNamespace } from "./org-scope/identities";
import { masteryNamespace } from "./org-scope/mastery";
import { memberSpendNamespace } from "./org-scope/member-spend";
import { metricsNamespace } from "./org-scope/metrics";
import { missionsNamespace } from "./org-scope/missions";
import { orgNamespace } from "./org-scope/org";
import { peopleNamespace } from "./org-scope/people";
import { rawNamespace } from "./org-scope/raw";
import { recInteractionsNamespace } from "./org-scope/rec-interactions";
import { renewalReminderStateNamespace } from "./org-scope/renewal-reminder-state";
import { rolesNamespace } from "./org-scope/roles";
import { scoresNamespace } from "./org-scope/scores";
import { subjectsNamespace } from "./org-scope/subjects";
import { teamManagersNamespace } from "./org-scope/team-managers";
import { teamSettingsNamespace } from "./org-scope/team-settings";
import { teamsNamespace } from "./org-scope/teams";

// The org-scoped input types live next to their namespace factories now (the
// W5-A public-API-preserving split, ADR 0027) and are re-exported here so
// external `import { ... } from "../db/org-scope"` sites keep resolving
// unchanged.
export type { CreateConnectionInput } from "./org-scope/connections";
export type { CreateDesktopPairingInput } from "./org-scope/desktop-pairing";
export type {
  MetricRecordUpsert,
  SubjectDaySignalUpsert,
} from "./org-scope/metrics";
export type { CreatePersonInput } from "./org-scope/people";
export type { RawPayloadInsert } from "./org-scope/raw";
export type { ScoreResultUpsert } from "./org-scope/scores";
export type { SubjectDescriptor } from "./org-scope/subjects";

/**
 * Resolves a user's org membership — the one query that runs *before* an
 * org scope exists (it's how the scope is established). Lives here so the
 * tenancy seam stays in a single reviewed module.
 */
export async function membershipForUser(db: Db, userId: string) {
  const [membership] = await db
    .select({
      orgId: orgMembers.orgId,
      orgName: orgs.name,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(eq(orgMembers.userId, userId))
    .orderBy(orgMembers.createdAt)
    .limit(1);
  return membership;
}

/**
 * Creates a user's org of one + admin membership if they have none, and
 * returns their membership. Transactional (no org without membership) and
 * idempotent (re-running returns the existing membership) — Better Auth's
 * `after` hooks run post-commit, so a hook failure must be recoverable on
 * the next request rather than leaving the user permanently org-less.
 * Concurrent first requests serialize on the orgs.bootstrap_user_id unique
 * constraint: the losing insert no-ops and adopts the winner's org, so two
 * orgs for one signup are unrepresentable (the W0-C race fix).
 */
export async function ensureOrgOfOne(
  db: Db,
  user: { id: string; name?: string | null; email: string },
) {
  const existing = await membershipForUser(db, user.id);
  if (existing) {
    return existing;
  }
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(orgs)
      .values({
        name: user.name || user.email,
        kind: "personal",
        bootstrapUserId: user.id,
      })
      .onConflictDoNothing({ target: orgs.bootstrapUserId })
      .returning({ id: orgs.id });
    const orgId =
      inserted?.id ??
      (
        await tx
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.bootstrapUserId, user.id))
      )[0]?.id;
    if (orgId) {
      await tx
        .insert(orgMembers)
        .values({ orgId, userId: user.id, role: "admin" })
        .onConflictDoNothing();
      // ADR 0014: a personal org's dashboard (PersonalSelfView) renders only
      // subjectLevel='person' scores, but the global presets (drizzle/0009)
      // are team-level and a personal org has no teams — so it would never
      // produce a score row. Clone the global team presets into org-scoped
      // person-level definitions for this org (components identical; the
      // globals stay the single source of truth). Idempotent via
      // onConflictDoNothing so the signup-race loser and the per-request
      // re-call (api-context) don't duplicate. Backfill for existing orgs is
      // drizzle/0017; ensureOrgOfOne only creates personal orgs, so no kind
      // guard is needed here.
      const teamPresets = await tx
        .select()
        .from(scoreDefinitions)
        .where(
          and(
            isNull(scoreDefinitions.orgId),
            eq(scoreDefinitions.subjectLevel, "team"),
            eq(scoreDefinitions.status, "active"),
          ),
        );
      if (teamPresets.length > 0) {
        await tx
          .insert(scoreDefinitions)
          .values(
            teamPresets.map((d) => ({
              orgId,
              slug: d.slug,
              version: d.version,
              name: d.name,
              subjectLevel: "person" as const,
              components: d.components,
              status: d.status,
            })),
          )
          .onConflictDoNothing();
      }
    }
  });
  const membership = await membershipForUser(db, user.id);
  if (!membership) {
    throw new Error(`org bootstrap failed for user ${user.id}`);
  }
  return membership;
}

/**
 * Org-scoped repository layer — the tenancy rule's enforcement point.
 *
 * Every query in application code goes through `forOrg(db, orgId)`; raw
 * table access outside this module is a review-blocker (CLAUDE.md). W0-C
 * freezes the full contract (RLS or this layer, decided there); this is
 * the walking-skeleton version proving the shape: the org filter is
 * applied inside the layer, so call sites cannot forget it.
 *
 * W5-A (ADR 0027) split each namespace into a self-contained factory under
 * `src/db/org-scope/` — this is now a thin composition root. The returned
 * object's shape (and therefore `OrgScopedDb`) is byte-for-byte unchanged;
 * every namespace is independent (verified zero cross-namespace calls), so
 * a future table-adding workstream extends one factory in isolation.
 */
export function forOrg(db: Db, orgId: string) {
  return {
    orgId,
    org: orgNamespace(db, orgId),
    people: peopleNamespace(db, orgId),
    teams: teamsNamespace(db, orgId),
    teamManagers: teamManagersNamespace(db, orgId),
    teamSettings: teamSettingsNamespace(db, orgId),
    connections: connectionsNamespace(db, orgId),
    connectorRuns: connectorRunsNamespace(db, orgId),
    desktopPairing: desktopPairingNamespace(db, orgId),
    subjects: subjectsNamespace(db, orgId),
    identities: identitiesNamespace(db, orgId),
    metrics: metricsNamespace(db, orgId),
    raw: rawNamespace(db, orgId),
    scores: scoresNamespace(db, orgId),
    billing: billingNamespace(db, orgId),
    auditLog: auditLogNamespace(db, orgId),
    heartbeats: heartbeatsNamespace(db, orgId),
    budgets: budgetsNamespace(db, orgId),
    budgetAlertState: budgetAlertStateNamespace(db, orgId),
    execReportState: execReportStateNamespace(db, orgId),
    renewalReminderState: renewalReminderStateNamespace(db, orgId),
    digestPreferences: digestPreferencesNamespace(db, orgId),
    recInteractions: recInteractionsNamespace(db, orgId),
    roles: rolesNamespace(db, orgId),
    catalog: catalogNamespace(db, orgId),
    capabilities: capabilitiesNamespace(db, orgId),
    capabilityHistory: capabilityHistoryNamespace(db, orgId),
    mastery: masteryNamespace(db, orgId),
    memberSpend: memberSpendNamespace(db, orgId),
    missions: missionsNamespace(db, orgId),
    exposures: exposuresNamespace(db, orgId),
  };
}

export type OrgScopedDb = ReturnType<typeof forOrg>;
