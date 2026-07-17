// Loads a SeedPlan (plan.ts — the frozen contract with personas.ts/
// activity.ts) into a live Postgres DB through the SAME seams production
// code uses: the org-scoped repository (forOrg), the fixture loader, the
// real signup path (Better Auth's signUpEmail — so seeded users can
// actually sign in), the subscription/share-link/invite/benchmark-consent
// factories, and recomputeOrg. Raw table writes happen ONLY where no writer
// exists on those seams: auth users' emailVerified flip + org_members rows
// (mirrors the exact pattern ensureOrgOfOne itself uses, and
// tests/personal-presets-seed.test.ts's createAuthUser), the benchmarks
// verified-status flip (README.md item 12), BACKDATED mission_progress
// opt-ins (missions.start can't set started_at — a frozen-seam param would
// need an ADR — and a wall-clock start would postdate the reducer's
// asOfDay-derived completion stamp), and BACKDATED people.created_at
// (peopleCreatedOn — no seam sets created_at, and a seed-run stamp
// postdates every data window, zeroing maturity's knownPeopleAsOf
// activation denominator). See README.md for the full invariant list this
// file must not violate.
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
import { switchActiveOrg } from "../../src/db/org-context";
import {
  forOrg,
  membershipForUser,
  type OrgScopedDb,
} from "../../src/db/org-scope";
import {
  benchmarks,
  missionProgress,
  orgMembers,
  orgs,
  people,
  user,
} from "../../src/db/schema";
import { shareLinksForOrg } from "../../src/db/share-links";
import { applyPaddleSubscriptionEvent } from "../../src/db/subscriptions";
import { createAuth, type Auth, type AuthEnv } from "../../src/lib/auth";
import { periodFor } from "../../src/scoring/periods";
import { recomputeOrg } from "../../src/scoring/recompute";
import { recomputeCapabilityHistory } from "../../src/scoring/recompute-capability-history";
import { recomputeCapabilityState } from "../../src/scoring/recompute-capability-state";
import { recomputeTeamInsights } from "../../src/scoring/recompute-team-insights";
import type {
  ConnectionStateSpec,
  ConnectorRunSpec,
  CustomIndexSpec,
  LoadSeedPlanResult,
  MissionStartSpec,
  RecExposureSpec,
  RecInteractionSpec,
  RenewalSpec,
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

function resolvePersonId(
  loaded: LoadedFixture,
  personKey: string,
  specName: string,
): string {
  const personId = loaded.people[personKey];
  if (!personId) {
    throw new Error(`${specName} references unknown person '${personKey}'`);
  }
  return personId;
}

/**
 * Renewal chip + suppressed reminder emails: writes the user-entered
 * connections.renewal_date, then pre-claims the given T-thresholds in
 * renewal_reminder_state exactly as the reminder cron would after sending —
 * so a live cron run against a long-lived demo DB never emails a fixture
 * address for a threshold the seed narrative says already fired.
 */
async function applyRenewal(
  scoped: OrgScopedDb,
  loaded: LoadedFixture,
  spec: RenewalSpec,
): Promise<void> {
  const connectionId = loaded.connections[spec.connection];
  if (!connectionId) {
    throw new Error(`renewals references unknown connection '${spec.connection}'`);
  }
  await scoped.connections.update(connectionId, { renewalDate: spec.renewalDate });
  for (const threshold of spec.claimThresholds ?? []) {
    await scoped.renewalReminderState.claim(connectionId, spec.renewalDate, threshold);
  }
}

async function applyRecInteraction(
  scoped: OrgScopedDb,
  loaded: LoadedFixture,
  spec: RecInteractionSpec,
): Promise<void> {
  const personId = resolvePersonId(loaded, spec.person, "recInteractions");
  await scoped.recInteractions.set({
    personId,
    recId: spec.recId,
    state: spec.state,
    snoozeUntil: spec.snoozeUntilDay
      ? new Date(`${spec.snoozeUntilDay}T00:00:00.000Z`)
      : null,
  });
}

/**
 * Backdated mission opt-in. This is one of the loader's documented RAW
 * writes (file header): the production seam (missions.start) stamps
 * started_at = now(), but a seeded start must PREDATE the derivedRecompute
 * pass that completes it (the reducer stamps completed_at from that pass's
 * asOfDay), or the demo would show a mission completed before it started.
 * Mirrors missions.start exactly otherwise — same conflict target, same
 * "a re-start never resets a completed row" semantics.
 */
async function applyMissionStart(
  db: Db,
  orgId: string,
  loaded: LoadedFixture,
  spec: MissionStartSpec,
): Promise<void> {
  const personId = resolvePersonId(loaded, spec.person, "missionStarts");
  await db
    .insert(missionProgress)
    .values({
      orgId,
      personId,
      missionSlug: spec.missionSlug,
      startedAt: new Date(`${spec.startedOnDay}T09:00:00.000Z`),
    })
    .onConflictDoNothing({
      target: [
        missionProgress.orgId,
        missionProgress.personId,
        missionProgress.missionSlug,
      ],
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
    console.warn(
      `seed: org "${orgPlan.name}" already exists — skipping. If this org ` +
        `is half-seeded from an interrupted run, delete it (or restart the ` +
        `in-memory dev db) before re-seeding, or it will keep being skipped ` +
        `with incomplete data.`,
    );
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
    // A plan-time spec can't honestly supply a real subject/connection UUID
    // (those don't exist until loadFixture runs above) — but production
    // audits of an org-targeted or self-targeted user action always target a
    // real id we DO already have here, so fill it in rather than leaving a
    // fixture key or a fabricated value (CLAUDE.md fix #4).
    const targetId =
      spec.targetId ??
      (spec.targetKind === "org"
        ? orgId
        : spec.targetKind === "user"
          ? (actorUserId ?? undefined)
          : undefined);
    await scoped.auditLog.record({
      actorUserId,
      action: spec.action,
      targetKind: spec.targetKind,
      targetId,
      metadata: spec.metadata,
    });
  }

  // ── Post-W5 org-scoped surfaces (roles/teams/emails/recs/missions) ──
  // All are plain seam writes; mission starts MUST land before the derived
  // chain below, or the reducer has nothing to complete. Each group's rows
  // are independent of one another, so every group runs as one Promise.all
  // wave — the prod-safe seed pays ~600ms per Neon round trip, and Acme
  // alone has ~40 of these rows. Only the budget-threshold claims stay
  // sequential (claimThreshold is a monotonic compare-and-set).
  const anchorMonth = anchorDay.slice(0, 7);

  // Backdated people.created_at (another documented raw write — no seam
  // sets created_at, and the fixture loader's seed-run stamp postdates every
  // data window, which zeroes maturity's knownPeopleAsOf activation
  // denominator and makes the LEVEL structurally unplaceable on seed data).
  await Promise.all(
    (orgPlan.peopleCreatedOn ?? []).map((spec) =>
      db
        .update(people)
        .set({ createdAt: new Date(`${spec.day}T00:00:00.000Z`) })
        .where(
          and(
            eq(people.orgId, orgId),
            eq(people.id, resolvePersonId(loaded, spec.person, "peopleCreatedOn")),
          ),
        ),
    ),
  );

  if (orgPlan.roleAssignments?.length) {
    // Production role assignment is an admin action — attribute it to the
    // org's first admin user (the same convention invites use).
    const adminSpec = users.find(
      (u) => u.orgRole === "admin" && userIdByKey.has(u.key),
    );
    const assignedByUserId = adminSpec ? userIdByKey.get(adminSpec.key) : null;
    await Promise.all(
      orgPlan.roleAssignments.map((spec) =>
        scoped.roles.assign({
          personId: resolvePersonId(loaded, spec.person, "roleAssignments"),
          roleSlug: spec.roleSlug,
          assignedByUserId,
        }),
      ),
    );
  }

  await Promise.all(
    (orgPlan.teamManagers ?? []).map((spec) => {
      const teamId = loaded.teams[spec.team];
      const userId = userIdByKey.get(spec.user);
      if (!teamId) throw new Error(`teamManagers references unknown team '${spec.team}'`);
      if (!userId) throw new Error(`teamManagers references unknown user '${spec.user}'`);
      return scoped.teamManagers.assign(teamId, userId);
    }),
  );

  await Promise.all(
    (orgPlan.teamSettings ?? []).map((spec) => {
      const teamId = loaded.teams[spec.team];
      if (!teamId) throw new Error(`teamSettings references unknown team '${spec.team}'`);
      return scoped.teamSettings.set(teamId, {
        managersSeeIndividualCost: spec.managersSeeIndividualCost,
      });
    }),
  );

  if (orgPlan.execReport) {
    await scoped.execReportState.setEnabled(orgPlan.execReport.enabled);
    if (orgPlan.execReport.enabled && orgPlan.execReport.claimCurrentMonth) {
      // Claim the anchor month as if the memo already went out, so a live
      // monthly cron never emails this org's fixture addresses.
      await scoped.execReportState.claimMonth(anchorMonth);
    }
  }

  await Promise.all(
    (orgPlan.renewals ?? []).map((spec) => applyRenewal(scoped, loaded, spec)),
  );

  for (const threshold of orgPlan.budgetClaimedThresholds ?? []) {
    await scoped.budgetAlertState.claimThreshold(anchorMonth, threshold);
  }

  await Promise.all(
    (orgPlan.digestPreferences ?? []).map((spec) => {
      const userId = userIdByKey.get(spec.user);
      if (!userId) {
        throw new Error(`digestPreferences references unknown user '${spec.user}'`);
      }
      return scoped.digestPreferences.setEnabled(userId, spec.enabled);
    }),
  );

  await Promise.all(
    (orgPlan.recInteractions ?? []).map((spec) =>
      applyRecInteraction(scoped, loaded, spec),
    ),
  );

  if (orgPlan.recExposures?.length) {
    // One batched write, mirroring the digest sender's off-hot-path log().
    await scoped.exposures.log(
      orgPlan.recExposures.map((spec: RecExposureSpec) => ({
        personId: resolvePersonId(loaded, spec.person, "recExposures"),
        recId: spec.recId,
        surface: spec.surface,
        shownAt: spec.day,
        experimentKey: null,
        variant: null,
      })),
    );
  }

  await Promise.all(
    (orgPlan.missionStarts ?? []).map((spec) =>
      applyMissionStart(db, orgId, loaded, spec),
    ),
  );

  let scoreResults = 0;
  for (const r of orgPlan.recompute) {
    const summary = await recomputeOrg(db, orgId, {
      period: periodFor(r.grain, r.anchorDay),
    });
    scoreResults += summary.resultsWritten;
  }

  // The derived chain the poller's score-recompute step runs after
  // recomputeOrg (src/poller/process.ts) — replayed here per pass so
  // user_capability_state / team_capability_history / team_insights are
  // DERIVED from the seeded evidence by the real engines, never fabricated.
  // Mission completion also flows through the reducer's measured-crossing
  // stamp inside recomputeCapabilityState.
  for (const pass of orgPlan.derivedRecompute ?? []) {
    const cap = await recomputeCapabilityState(db, orgId, { asOfDay: pass.asOfDay });
    await recomputeCapabilityHistory(db, orgId, { asOfDay: pass.asOfDay });
    if (pass.teamInsights) {
      await recomputeTeamInsights(db, orgId, { asOfDay: pass.asOfDay });
    }
    console.log(
      `seed: derived pass ${pass.asOfDay} for "${orgPlan.name}" — ` +
        `${cap.rowsWritten} capability rows / ${cap.peopleWithState} people, ` +
        `${cap.missionsCompleted} missions completed`,
    );
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

  // ── Cross-org memberships + active workspaces (workspace-switcher demo) ──
  // Applied AFTER the org loop so both sides exist. Org names resolve ONLY
  // against orgs THIS RUN created (never findOrgIdByName): on a long-lived
  // DB a real org can share a demo base name exactly (the adversarially
  // reproduced teardown collision), and a name-wide lookup would grant a
  // committed-password demo account membership in the REAL org. Warn-and-
  // skip (never throw) on a missing user/org: a re-run skips every existing
  // org above, so these plan-level extras must stay best-effort.
  const createdOrgIdByName = new Map(orgResults.map((o) => [o.name, o.orgId]));
  const resolveMembershipTarget = async (
    spec: { email: string; orgName: string },
    label: string,
  ): Promise<{ userId: string; orgId: string } | undefined> => {
    const [u] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, spec.email))
      .limit(1);
    const targetOrgId = createdOrgIdByName.get(spec.orgName);
    if (!u || !targetOrgId) {
      console.warn(
        `seed: ${label} skipped — ${!u ? `no user '${spec.email}'` : `org "${spec.orgName}" was not created by this run`}`,
      );
      return undefined;
    }
    return { userId: u.id, orgId: targetOrgId };
  };

  for (const spec of plan.crossOrgMemberships ?? []) {
    const target = await resolveMembershipTarget(spec, "crossOrgMemberships");
    if (!target) continue;
    // Same documented raw org_members exception the per-org loader uses
    // (mirrors ensureOrgOfOne's own insert); idempotent on re-run. The join
    // date is backdated a minute so the activeWorkspaces switch below
    // STRICTLY outranks it — under the tests' frozen clock, a same-instant
    // created_at ties with switchActiveOrg's last_active_at stamp and the
    // active org falls to the org-id tiebreak (nondeterministic per run).
    await db
      .insert(orgMembers)
      .values({
        orgId: target.orgId,
        userId: target.userId,
        role: spec.role,
        createdAt: new Date(Date.now() - 60_000),
      })
      .onConflictDoNothing();
  }

  for (const spec of plan.activeWorkspaces ?? []) {
    const target = await resolveMembershipTarget(spec, "activeWorkspaces");
    if (!target) continue;
    // The production switcher seam (ADR 0051) — stamps last_active_at so the
    // resolver picks this org over the later-created cross-org membership.
    const switched = await switchActiveOrg(db, target.userId, target.orgId);
    if (!switched) {
      console.warn(
        `seed: activeWorkspaces — '${spec.email}' is not a member of "${spec.orgName}"`,
      );
    }
  }

  if (plan.verifyBenchmark) {
    // Idempotent: setting an already-verified row to 'verified' is a no-op
    // update, so a re-run's early org-skip elsewhere doesn't need to gate
    // this too.
    await db
      .update(benchmarks)
      .set({ status: "verified" })
      .where(
        and(
          eq(benchmarks.scoreSlug, plan.verifyBenchmark.scoreSlug),
          eq(benchmarks.componentKey, plan.verifyBenchmark.componentKey),
        ),
      );
  }

  return { orgs: orgResults };
}
