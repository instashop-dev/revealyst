// Loads a SeedPlan (plan.ts — the frozen contract with personas.ts/
// activity.ts) into a live Postgres DB through the SAME seams production
// code uses: the org-scoped repository (forOrg), the fixture loader, the
// real signup path (Better Auth's signUpEmail — so seeded users can
// actually sign in), the subscription/share-link/invite/benchmark-consent
// factories, and recomputeOrg. Raw table writes happen ONLY where no writer
// exists on those seams: auth users' emailVerified flip + org_members rows
// (mirrors the exact pattern ensureOrgOfOne itself uses, and
// tests/personal-presets-seed.test.ts's createAuthUser) and the benchmarks
// verified-status flip (README.md item 12). See README.md for the full
// invariant list this file must not violate.
//
// scripts/** sits outside the org-scope guard's static scan (CLAUDE.md), so
// the raw inserts/updates below are a deliberate, reviewed exception, not a
// gap in the guard.
import { and, eq } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import { benchmarkConsentForOrg } from "../../src/db/benchmark-consent";
import {
  createFixtureOrg,
  loadFixture,
  loadScoreDefinitions,
  type LoadedFixture,
} from "../../src/db/fixtures";
import { invitesForOrg } from "../../src/db/invites";
import {
  forOrg,
  membershipForUser,
  type OrgScopedDb,
} from "../../src/db/org-scope";
import { benchmarks, orgMembers, orgs, people, user } from "../../src/db/schema";
import { shareLinksForOrg } from "../../src/db/share-links";
import { applyPaddleSubscriptionEvent } from "../../src/db/subscriptions";
import { createAuth, type Auth, type AuthEnv } from "../../src/lib/auth";
import { periodFor } from "../../src/scoring/periods";
import { recomputeOrg } from "../../src/scoring/recompute";
import type {
  ConnectionStateSpec,
  ConnectorRunSpec,
  CustomIndexSpec,
  LoadSeedPlanResult,
  SeedOrgPlan,
  SeedPlan,
  ShareLinkSpec,
} from "./plan";

/** Lowercase-kebab, ASCII-only — used only to build plausible-looking fake
 * Paddle ids (`sub_seed_<slug>`); never a real Paddle identifier. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds the seed's own Better Auth instance. Deliberately drops any SES_*
 * credentials the caller's env might carry (e.g. a real `.dev.vars`/Worker
 * secret set): a seed run must never send a live verification/reset email to
 * a fixture address, no matter what environment it's pointed at. Email
 * verification is instead forced via a direct `emailVerified` update (see
 * `ensureAuthUser`) — sendEmail() harmlessly no-ops without SES keys (just
 * logs), matching src/lib/email.ts's local-dev behavior.
 */
function buildAuthEnv(env: Record<string, string> | undefined): AuthEnv {
  return {
    BETTER_AUTH_SECRET: env?.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env?.BETTER_AUTH_URL ?? "http://localhost:3000",
  };
}

/**
 * Creates one seed auth user through the real signup path (signUpEmail), so
 * seeded accounts have a working password hash and can actually sign in —
 * not a raw `user` insert, which couldn't fake the password hash Better
 * Auth owns anyway. This also fires `ensureOrgOfOne`
 * (src/lib/auth.ts databaseHooks.user.create.after): EVERY seeded user, not
 * only a `bootstrapUser`, gets its own org-of-one as a side effect — same as
 * any real signup later invited into a team. For a plan's `bootstrapUser`
 * this is exactly the org the caller wants (renamed/reused below); for
 * every other seeded user it leaves one small extra personal org behind.
 * Harmless for a demo DB and it mirrors real product behavior for
 * "signed up, then invited" — see load.ts's report to the founder for this
 * tradeoff spelled out.
 *
 * Email verification is required to sign in
 * (`requireEmailVerification: true`); force it here rather than round-trip
 * through the (no-op in this env) verification email.
 */
async function ensureAuthUser(
  db: Db,
  auth: Auth,
  spec: { name: string; email: string; password: string },
): Promise<string> {
  const result = await auth.api.signUpEmail({
    body: { name: spec.name, email: spec.email, password: spec.password },
  });
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.id, result.user.id));
  return result.user.id;
}

/** Org row id for an exact-name match, or undefined — the idempotency guard
 * (README §"Invariants" doesn't list this explicitly, but a long-lived dev
 * DB re-run must not pile up duplicate demo orgs every time the seed runs). */
async function findOrgIdByName(db: Db, name: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.name, name))
    .limit(1);
  return row?.id;
}

/**
 * Applies a connection's post-create state (README's "5 healthy + 1 error +
 * 1 paused" narrative). Terminal states (error/paused) win outright; agent
 * connections stamp success via `synced`; a plain poll success uses
 * markPolled. Order matters because a spec could otherwise combine `status`
 * and `synced` in conflicting ways.
 */
async function applyConnectionState(
  scoped: OrgScopedDb,
  loaded: LoadedFixture,
  spec: ConnectionStateSpec,
): Promise<void> {
  const id = loaded.connections[spec.connection];
  if (!id) {
    throw new Error(
      `connectionStates references unknown connection '${spec.connection}'`,
    );
  }
  if (spec.status === "error") {
    await scoped.connections.setStatus(id, "error", spec.lastError ?? null);
  } else if (spec.status === "paused") {
    await scoped.connections.setStatus(id, "paused");
  } else if (spec.synced) {
    await scoped.connections.markSynced(id);
  } else if (spec.status === "active") {
    await scoped.connections.markPolled(id, { ok: true });
  }
}

async function applyConnectorRun(
  scoped: OrgScopedDb,
  loaded: LoadedFixture,
  spec: ConnectorRunSpec,
): Promise<void> {
  const connectionId = loaded.connections[spec.connection];
  if (!connectionId) {
    throw new Error(
      `connectorRuns references unknown connection '${spec.connection}'`,
    );
  }
  const run = await scoped.connectorRuns.start({
    connectionId,
    kind: spec.kind,
    windowStart: spec.windowStart,
    windowEnd: spec.windowEnd,
  });
  if (spec.outcome === "success") {
    await scoped.connectorRuns.finish(run.id, {
      subjectsSeen: spec.subjectsSeen ?? 0,
      recordsUpserted: spec.recordsUpserted ?? 0,
      signalsUpserted: spec.signalsUpserted ?? 0,
      gaps: spec.gaps ?? [],
    });
  } else {
    await scoped.connectorRuns.fail(run.id, spec.error ?? "seed: unspecified error");
  }
}

/**
 * Publishes (and optionally archives) a custom index. NOTE:
 * `publishCustomDefinition` itself carries no entitlement check — that gate
 * lives one layer up, at src/lib/custom-index-impl.ts's
 * `assertCustomIndexEntitledForOrg`, which only the /api/indexes route
 * calls. Publishing here therefore never fails for a not-yet-subscribed
 * org. The entitlement that DOES matter for a demo is recomputeOrg's
 * `customIndexesEntitled` re-derivation from the org's live subscription
 * (src/scoring/recompute.ts) — so as long as `subscription` is loaded
 * before `recompute` runs (true by construction below, matching
 * SeedOrgPlan's field order), an active-plan org's custom index actually
 * gets scored.
 */
async function applyCustomIndex(
  scoped: OrgScopedDb,
  spec: CustomIndexSpec,
): Promise<void> {
  await scoped.scores.publishCustomDefinition({
    slug: spec.slug,
    name: spec.name,
    subjectLevel: spec.subjectLevel,
    components: spec.components,
  });
  if (spec.archived) {
    await scoped.scores.archiveCustomDefinition(spec.slug);
  }
}

/**
 * shareLinksForOrg.create doesn't require the person to be authUserId-linked
 * — it stores `createdByUserId` only for attribution (nullable FK) — but a
 * real share link is always self-served, so pass it through whenever the
 * person IS linked to a seed user. Falls back to no creator otherwise.
 */
async function applyShareLink(
  db: Db,
  orgId: string,
  loaded: LoadedFixture,
  userIdByPersonKey: Map<string, string>,
  spec: ShareLinkSpec,
): Promise<void> {
  const personId = loaded.people[spec.person];
  if (!personId) {
    throw new Error(`shareLinks references unknown person '${spec.person}'`);
  }
  await shareLinksForOrg(db, orgId).create({
    personId,
    scoreSlug: spec.scoreSlug,
    publicLabel: spec.publicLabel,
    createdByUserId: userIdByPersonKey.get(spec.person),
  });
}

type OrgSummary = LoadSeedPlanResult["orgs"][number];

/**
 * Loads one org from the plan. Returns undefined (and logs a warning) when
 * an org of this exact name already exists — the whole org is skipped so a
 * re-run against a long-lived dev DB never piles up duplicate demo data
 * (plan.ts's frozen contract has no room for a "skip" signal beyond this).
 */
async function loadOrgPlan(
  db: Db,
  auth: Auth,
  orgPlan: SeedOrgPlan,
  anchorDay: string,
): Promise<OrgSummary | undefined> {
  if (await findOrgIdByName(db, orgPlan.name)) {
    console.warn(`seed: org "${orgPlan.name}" already exists — skipping`);
    return undefined;
  }

  const users = orgPlan.users ?? [];
  const userIdByKey = new Map<string, string>();

  let orgId: string;
  if (orgPlan.bootstrapUser) {
    const spec = users.find((u) => u.key === orgPlan.bootstrapUser);
    if (!spec) {
      throw new Error(
        `org "${orgPlan.name}": bootstrapUser '${orgPlan.bootstrapUser}' has no matching users[] entry`,
      );
    }
    const userId = await ensureAuthUser(db, auth, spec);
    userIdByKey.set(spec.key, userId);
    // ensureOrgOfOne (the signup after-hook) already created this user's
    // org-of-one + admin membership + cloned person-level preset defs
    // (ADR 0014) — find it and rename/reconfigure it into the plan's org
    // rather than creating a second one. "person-level preset clones come
    // free" (README) falls out of this for free too.
    const membership = await membershipForUser(db, userId);
    if (!membership) {
      throw new Error(
        `org "${orgPlan.name}": ensureOrgOfOne did not bootstrap an org for '${spec.key}'`,
      );
    }
    orgId = membership.orgId;
    await forOrg(db, orgId).org.update({
      name: orgPlan.name,
      ...(orgPlan.visibilityMode ? { visibilityMode: orgPlan.visibilityMode } : {}),
    });
  } else {
    const org = await createFixtureOrg(db, orgPlan.name, orgPlan.kind);
    orgId = org.id;
    if (orgPlan.visibilityMode) {
      await forOrg(db, orgId).org.update({ visibilityMode: orgPlan.visibilityMode });
    }
  }

  // Remaining users[] (everyone but bootstrapUser, already handled above):
  // real signup accounts, then a raw org_members insert into THIS org —
  // mirrors the exact insert ensureOrgOfOne itself uses for its admin row
  // (src/db/org-scope.ts).
  for (const spec of users) {
    if (spec.key === orgPlan.bootstrapUser) continue;
    const userId = await ensureAuthUser(db, auth, spec);
    userIdByKey.set(spec.key, userId);
    await db
      .insert(orgMembers)
      .values({ orgId, userId, role: spec.orgRole })
      .onConflictDoNothing();
  }

  // Platform-staff flag is independent of org role — applies to any seed
  // user regardless of how they joined this org (incl. bootstrapUser).
  for (const spec of users) {
    if (!spec.platformAdmin) continue;
    const userId = userIdByKey.get(spec.key);
    if (!userId) continue;
    await db.update(user).set({ role: "admin" }).where(eq(user.id, userId));
  }

  const loaded = await loadFixture(db, orgId, orgPlan.graph);

  // person → authUserId links, done right after loadFixture and before
  // anything (share links) that treats a person as self-serving.
  const userIdByPersonKey = new Map<string, string>();
  for (const spec of users) {
    if (!spec.person) continue;
    const userId = userIdByKey.get(spec.key);
    const personId = loaded.people[spec.person];
    if (!userId || !personId) continue;
    userIdByPersonKey.set(spec.person, userId);
    await db
      .update(people)
      .set({ authUserId: userId })
      .where(and(eq(people.orgId, orgId), eq(people.id, personId)));
  }

  // Extra org-scoped score definitions (the W2-H placeholder seam): a TEAM
  // org gets person-level preset clones here so the segments panel and
  // per-person scores render — a personal bootstrapUser org already got its
  // clones from ensureOrgOfOne (ADR 0014). Must land BEFORE the recompute
  // loop below: recomputeOrg only evaluates definitions it can see.
  if (orgPlan.scoreDefinitions?.length) {
    await loadScoreDefinitions(db, orgId, {
      definitions: orgPlan.scoreDefinitions,
    });
  }

  const scoped = forOrg(db, orgId);

  for (const spec of orgPlan.connectionStates ?? []) {
    await applyConnectionState(scoped, loaded, spec);
  }
  for (const spec of orgPlan.connectorRuns ?? []) {
    await applyConnectorRun(scoped, loaded, spec);
  }

  if (orgPlan.budget) {
    await scoped.budgets.set(orgPlan.budget);
  }

  if (orgPlan.subscription) {
    // applyPaddleSubscriptionEvent fits perfectly — the same controlled
    // write entry point the real Paddle webhook uses. Ids are fake but
    // plausibly-shaped; nothing here ever calls the real Paddle API with
    // them. Period spans the plan's anchor month (README: budget alerts +
    // Efficiency read month-to-date spend against it).
    const period = periodFor("month", anchorDay);
    const slug = slugify(orgPlan.name);
    await applyPaddleSubscriptionEvent(db, {
      orgId,
      paddleSubscriptionId: `sub_seed_${slug}`,
      paddleCustomerId: `cus_seed_${slug}`,
      occurredAt: new Date(),
      status: orgPlan.subscription.status,
      priceId: "pri_seed_team_monthly",
      quantity: orgPlan.subscription.quantity,
      currentPeriodStart: new Date(`${period.periodStart}T00:00:00.000Z`),
      currentPeriodEnd: new Date(`${period.periodEnd}T23:59:59.000Z`),
      canceledAt: orgPlan.subscription.status === "canceled" ? new Date() : null,
    });
  }

  for (const spec of orgPlan.customIndexes ?? []) {
    await applyCustomIndex(scoped, spec);
  }

  for (const spec of orgPlan.shareLinks ?? []) {
    await applyShareLink(db, orgId, loaded, userIdByPersonKey, spec);
  }

  if (orgPlan.invites?.length) {
    // "the org's first admin user" (plan.ts) — first users[] entry (in
    // spec order) whose orgRole is admin and who actually got created.
    const adminSpec = users.find(
      (u) => u.orgRole === "admin" && userIdByKey.has(u.key),
    );
    const invitedByUserId = adminSpec ? userIdByKey.get(adminSpec.key) : undefined;
    if (!invitedByUserId) {
      throw new Error(
        `org "${orgPlan.name}": invites require at least one admin user in users[]`,
      );
    }
    for (const spec of orgPlan.invites) {
      await invitesForOrg(db, orgId).create(spec.email, spec.role, invitedByUserId);
    }
  }

  for (const spec of orgPlan.benchmarkConsent ?? []) {
    const userId = userIdByKey.get(spec.user);
    if (!userId) {
      throw new Error(`benchmarkConsent references unknown user '${spec.user}'`);
    }
    await benchmarkConsentForOrg(db, orgId).set(userId, spec.granted);
  }

  for (const spec of orgPlan.auditEvents ?? []) {
    const actorUserId = userIdByKey.get(spec.actor) ?? null;
    await scoped.auditLog.record({
      actorUserId,
      action: spec.action,
      targetKind: spec.targetKind,
      targetId: spec.targetId,
      metadata: spec.metadata,
    });
  }

  let scoreResults = 0;
  for (const r of orgPlan.recompute) {
    const summary = await recomputeOrg(db, orgId, {
      period: periodFor(r.grain, r.anchorDay),
    });
    scoreResults += summary.resultsWritten;
  }

  return {
    name: orgPlan.name,
    orgId,
    people: orgPlan.graph.people.length,
    subjects: orgPlan.graph.subjects.length,
    records: orgPlan.graph.records.length,
    signals: orgPlan.graph.signals.length,
    scoreResults,
  };
}

/**
 * Loads a full SeedPlan into `db` through the production seams (see the
 * file header). `env` supplies Better Auth config (BETTER_AUTH_SECRET/URL)
 * for the auth instance this creates internally — see `buildAuthEnv` for
 * why SES credentials are never forwarded even if present.
 */
export async function loadSeedPlan(
  db: Db,
  plan: SeedPlan,
  env?: Record<string, string>,
): Promise<LoadSeedPlanResult> {
  const auth = createAuth(db, buildAuthEnv(env));
  const orgResults: OrgSummary[] = [];
  for (const orgPlan of plan.orgs) {
    const summary = await loadOrgPlan(db, auth, orgPlan, plan.anchorDay);
    if (summary) {
      orgResults.push(summary);
    }
  }

  if (plan.verifyBenchmarkRow) {
    // Idempotent: setting an already-verified row to 'verified' is a no-op
    // update, so a re-run's early org-skip elsewhere doesn't need to gate
    // this too.
    await db
      .update(benchmarks)
      .set({ status: "verified" })
      .where(
        and(
          eq(benchmarks.scoreSlug, "fluency"),
          eq(benchmarks.componentKey, "effectiveness"),
        ),
      );
  }

  return { orgs: orgResults };
}
