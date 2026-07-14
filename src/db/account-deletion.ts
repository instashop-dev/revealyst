import { APIError } from "better-auth/api";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import {
  account,
  connectionCredentials,
  connections,
  connectorRuns,
  identities,
  metricRecords,
  orgMembers,
  orgs,
  people,
  pollHeartbeats,
  rawPayloads,
  recInteractionState,
  recommendationCatalog,
  roleAssignments,
  scoreDefinitions,
  scoreResults,
  shareLinks,
  subjectDaySignals,
  subjects,
  teamMembers,
  teams,
  userCapabilityState,
} from "./schema";
import { subscriptionsForOrg } from "./subscriptions";

// Account deletion teardown (ADR 0015). Lives in the schema zone beside
// org-scope.ts — it does raw multi-table deletes, which the org-scope guard
// (scripts/check-org-scope.mjs) only permits inside src/db/**. Kept OUT of the
// frozen forOrg public API to limit frozen-surface churn; invoked from Better
// Auth's user.deleteUser.beforeDelete hook (src/lib/auth.ts).
//
// The FK graph makes a naive `DELETE FROM orgs` impossible: people, teams,
// connections, score_definitions, score_results, poll_heartbeats and
// org_members all reference orgs.id with NO ACTION and would block it. So we
// delete every org-scoped table explicitly, children before parents, each
// statement pinned to the single org_id (tenant isolation preserved), then the
// org row — whose delete cascades invites, benchmark_consent, subscriptions and
// audit_log.
//
// PURGE_TABLES is exported so a test can assert it stays in lockstep with the
// schema's actual org-scoped table set (mirrors tests/tenant-isolation.test.ts's
// completeness tripwire) — a table added to schema.ts later without a matching
// entry here would otherwise either dangle an FK on delete or silently survive
// account deletion.
export const PURGE_TABLES = [
  metricRecords,
  subjectDaySignals,
  identities,
  // W5-D: person-scoped, FK'd to people (not orgs) — must be deleted BEFORE
  // people below (its composite FK would otherwise block the people delete).
  recInteractionState,
  // W6-B: person-scoped role assignment, FK'd to people — likewise deleted
  // BEFORE people (its composite FK would otherwise block the people delete).
  // The global `roles` reference table is NOT org-scoped (no org_id column),
  // so it is invisible to the purge-completeness tripwire and needs no entry —
  // exactly how metric_catalog is handled (never purged, survives deletion).
  roleAssignments,
  // W7-2 (ADR 0036): per-person capability mastery, FK'd to people — deleted
  // BEFORE people (its composite FK would otherwise block the people delete).
  // The four capability-graph reference tables (domains/capabilities/
  // capability_signals/capability_dependencies) are NOT org-scoped (no org_id),
  // so like `roles`/`metric_catalog` they are invisible to the tripwire and need
  // no entry — never purged, survive deletion.
  userCapabilityState,
  shareLinks,
  subjects,
  rawPayloads,
  connectionCredentials,
  connectorRuns,
  teamMembers,
  scoreResults,
  connections,
  teams,
  people,
  scoreDefinitions,
  // W6-C (ADR 0033): org-AUTHORED catalog rows (org_id set) are purged here,
  // scoped to this org — a NO ACTION FK to orgs would otherwise block the org
  // delete. Global presets (org_id NULL) are reference data: the `WHERE org_id
  // = orgId` never matches them, so they survive, exactly like score_definitions
  // presets and metric_catalog.
  recommendationCatalog,
  pollHeartbeats,
  orgMembers,
] as const;

/**
 * Org-scoped tables intentionally NOT in PURGE_TABLES, and why. Verified
 * against schema.ts's FK definitions — re-check there before adding an entry
 * here; `missingFromPurgeTables` (below) is what makes this list load-bearing
 * rather than just documentation.
 */
export const PURGE_EXEMPT_TABLES = new Set([
  "orgs", // the row itself; deleted last, outside PURGE_TABLES
  // These five have `onDelete: "cascade"` FKs straight to orgs.id, so the
  // final `orgs` delete removes them without an explicit statement:
  "invites",
  "benchmark_consent",
  "subscriptions",
  "audit_log",
  "budgets",
  "digest_preferences",
  // W5-I (ADR 0029): cascade-deleted with the org (org_id → orgs, cascade),
  // like budgets/digest_preferences — the final `orgs` delete removes it.
  "budget_alert_state",
  // W6-G (ADR 0032): cascade-deleted via its composite tenant FK to
  // `connections` (org_id, connection_id → connections cascade). PURGE_TABLES
  // deletes `connections` explicitly (scoped to the org), which cascades the
  // reminder-state rows away — no separate statement needed.
  "renewal_reminder_state",
  // W6-F (ADR 0031): one send-state/settings row per org, cascade-deleted with
  // the org (org_id → orgs, cascade) — the final `orgs` delete removes it.
  "exec_report_state",
]);

/**
 * Gate an account deletion and, if allowed, purge the user's personal
 * org-of-one. Called from `deleteUser.beforeDelete` — throwing here aborts the
 * whole deletion (nothing is removed). Thrown as a Better Auth `APIError` so
 * the message reaches the client (a plain `Error` is swallowed into a
 * bodyless 500 by better-call's router).
 *
 * The user's OWN workspace is their bootstrap org (orgs.bootstrap_user_id). Any
 * other org they merely belong to (invited) is left alone; that membership row
 * cascades away when Better Auth deletes the user.
 */
export async function assertDeletableAndPurgeOrg(
  db: Db,
  userId: string,
): Promise<void> {
  const [bootstrapOrg] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.bootstrapUserId, userId))
    .limit(1);

  // No bootstrap org (user only holds invited memberships): nothing to purge.
  if (!bootstrapOrg) {
    return;
  }
  const orgId = bootstrapOrg.id;

  // Gate 1 — a shared workspace must not be silently torn down. `kind` is not a
  // proxy (a personal-kind org can have many members); count members instead.
  // A capped existence probe (not the full orgMembersList join+sort) is enough
  // to answer "more than one?".
  const memberRows = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, orgId))
    .limit(2);
  if (memberRows.length > 1) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Remove other members or transfer ownership of your workspace before deleting your account.",
    });
  }

  // Gate 2 — never orphan a live OR resumable Paddle subscription. `plan ===
  // "team"` alone is not enough: a `paused` subscription resolves to
  // plan "personal" (it grants no current access) but is resumable via
  // Paddle's customer portal (ADR 0011), so it must block deletion too — only
  // a subscription actually `canceled` is safe to let the org's row cascade.
  const subscriptionRows = await subscriptionsForOrg(db, orgId).list();
  if (subscriptionRows.some((row) => row.status !== "canceled")) {
    throw new APIError("BAD_REQUEST", {
      message: "Cancel your subscription before deleting your account.",
    });
  }

  // Purge in FK-safe order, every statement scoped to this org.
  await db.transaction(async (tx) => {
    for (const table of PURGE_TABLES) {
      await tx.delete(table).where(eq(table.orgId, orgId));
    }
    // Cascades invites, benchmark_consent, subscriptions, audit_log.
    await tx.delete(orgs).where(eq(orgs.id, orgId));
  });
}

/**
 * Does this user have a password credential (as opposed to being OAuth-only,
 * e.g. GitHub)? Better Auth's `changePassword` and password-gated `deleteUser`
 * both 400 (CREDENTIAL_ACCOUNT_NOT_FOUND) for a user with no such row — the
 * account UI uses this to hide/adapt those flows instead of rendering a form
 * that can never succeed.
 */
export async function hasCredentialAccount(
  db: Db,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ providerId: account.providerId, password: account.password })
    .from(account)
    .where(eq(account.userId, userId));
  return rows.some((r) => r.providerId === "credential" && r.password);
}

/**
 * Every org-scoped table in schema.ts (excluding PURGE_EXEMPT_TABLES) must
 * appear in PURGE_TABLES — the completeness tripwire this list needs, mirrored
 * from tests/tenant-isolation.test.ts. Exported so the test can call it
 * directly against the live `schema` module rather than duplicating the
 * enumeration logic.
 */
export function missingFromPurgeTables(
  schemaModule: Record<string, unknown>,
): string[] {
  const covered = new Set(PURGE_TABLES.map((t) => getTableName(t)));
  const missing: string[] = [];
  for (const table of Object.values(schemaModule)) {
    if (!(table instanceof PgTable)) continue;
    const name = getTableName(table);
    if (PURGE_EXEMPT_TABLES.has(name)) continue;
    if (!("orgId" in getTableColumns(table))) continue;
    if (!covered.has(name)) missing.push(name);
  }
  return missing;
}
