import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "../client";
import { people, teamMembers, userCapabilityState } from "../schema";
import type { CapabilityComponentBreakdown } from "../../scoring/capability-state";
import { masteryBasisPoints } from "../../lib/capability-depth";

// Per-person capability mastery reads/writes (W7-2, ADR 0036). ORG-SCOPED.
//
// SELF-VIEW enforcement lives at the CALL SITE: `forPerson` is filtered by
// (org, person) and is only ever called with the SIGNED-IN person's own id (the
// page resolves the person from the session, never from a request param), and
// there is NO team/other-person read surface on this namespace — a manager
// cannot reach another person's mastery here (P6's rollup reads the table
// separately, aggregate + count-only). This mirrors `rec_interaction_state`'s
// three-layer self-view posture. The write surface (`replaceForPerson`) is the
// nightly reducer's only entry point.
//
// P3-A MANAGER READ EXCEPTION (ADR 0045, founder-signed privacy reversal
// D-TCI-1): `forManagedPerson` is the ONE narrow, separately-documented method
// that returns ANOTHER person's mastery — and ONLY when that person is a member
// of a team the caller manages. It is not a general other-person read: it
// fails closed (returns null) unless the person is in one of the caller's
// managed teams, so the membership check IS the authorization. The self-view
// `forPerson`/`forUser` methods above are unchanged. See the method doc for the
// preconditions the CALLER must have verified before calling.

export type UserCapabilityStateRow = {
  capabilitySlug: string;
  mastery: number;
  confidence: number;
  confidenceTier: string;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  staleness: number;
  nextCapability: string | null;
  components: CapabilityComponentBreakdown;
};

export type UserCapabilityStateUpsert = {
  personId: string;
  capabilitySlug: string;
  mastery: number;
  confidence: number;
  confidenceTier: "measured" | "modeled" | "directional" | "not_measured";
  evidenceCount: number;
  lastEvidenceAt: string | null;
  staleness: number;
  nextCapability: string | null;
  components: CapabilityComponentBreakdown;
};

export function masteryNamespace(db: Db, orgId: string) {
  return {
    /**
     * One person's capability profile, ordered by mastery (strongest first —
     * "discovery, never deficiency"). Self-view read: the caller passes the
     * signed-in person's own id. One round trip.
     */
    async forPerson(personId: string): Promise<UserCapabilityStateRow[]> {
      const rows = await db
        .select({
          capabilitySlug: userCapabilityState.capabilitySlug,
          mastery: userCapabilityState.mastery,
          confidence: userCapabilityState.confidence,
          confidenceTier: userCapabilityState.confidenceTier,
          evidenceCount: userCapabilityState.evidenceCount,
          lastEvidenceAt: userCapabilityState.lastEvidenceAt,
          staleness: userCapabilityState.staleness,
          nextCapability: userCapabilityState.nextCapability,
          components: userCapabilityState.components,
        })
        .from(userCapabilityState)
        .where(
          and(
            eq(userCapabilityState.orgId, orgId),
            eq(userCapabilityState.personId, personId),
          ),
        );
      return rows
        .map((r) => ({
          ...r,
          components: r.components as CapabilityComponentBreakdown,
        }))
        .sort((a, b) => b.mastery - a.mastery || a.capabilitySlug.localeCompare(b.capabilitySlug));
    },

    /**
     * The SIGNED-IN user's own capability profile — joins `people.auth_user_id`
     * to the state table so the self-view page can fold this into its initial
     * flat Promise.all (depth 1), before the tracked `personId` is resolved from
     * the score summary. Self-view by construction: only rows for the person
     * whose `auth_user_id` matches the caller are returned. One round trip.
     */
    async forUser(authUserId: string): Promise<UserCapabilityStateRow[]> {
      const rows = await db
        .select({
          capabilitySlug: userCapabilityState.capabilitySlug,
          mastery: userCapabilityState.mastery,
          confidence: userCapabilityState.confidence,
          confidenceTier: userCapabilityState.confidenceTier,
          evidenceCount: userCapabilityState.evidenceCount,
          lastEvidenceAt: userCapabilityState.lastEvidenceAt,
          staleness: userCapabilityState.staleness,
          nextCapability: userCapabilityState.nextCapability,
          components: userCapabilityState.components,
        })
        .from(userCapabilityState)
        .innerJoin(
          people,
          and(
            eq(people.orgId, userCapabilityState.orgId),
            eq(people.id, userCapabilityState.personId),
          ),
        )
        .where(
          and(
            eq(userCapabilityState.orgId, orgId),
            eq(people.authUserId, authUserId),
          ),
        );
      return rows
        .map((r) => ({
          ...r,
          components: r.components as CapabilityComponentBreakdown,
        }))
        .sort((a, b) => b.mastery - a.mastery || a.capabilitySlug.localeCompare(b.capabilitySlug));
    },

    /**
     * MANAGER READ (ADR 0045, capability half): one person's capability profile
     * for a manager reading a member of a team they manage. Returns the person's
     * identity + their capability rows (same shape + strongest-first order as the
     * self-view `forPerson`), or `null` when the caller is NOT authorized to read
     * this person — i.e. the person is not a member of any team in `managedTeamIds`
     * (also `null` when `managedTeamIds` is empty). The membership join IS the
     * authorization: an unauthorized person is indistinguishable from a missing
     * one (null), so the surface never confirms a person exists.
     *
     * PRECONDITIONS THE CALLER MUST HAVE VERIFIED (this method does NOT re-check
     * them — it only enforces the person-∈-managed-team half):
     *  1. Org visibility mode is `managed` or `full`. In `private` the per-person
     *     manager surface is UNAVAILABLE (ADR 0045 — absent, not pseudonymized);
     *     the caller must short-circuit before reaching here.
     *  2. `managedTeamIds` are the SIGNED-IN caller's OWN managed teams, resolved
     *     from `teamManagers.managedTeamIds(callerUserId)` — never a caller-
     *     supplied list. Passing another user's managed teams would defeat the
     *     grant model (admins get no ambient read; they self-assign a grant).
     *
     * This returns ONLY mastery/profile data — never recommendations, coaching,
     * rec-interaction, exposure, or mission state (those stay self-view-only
     * FOREVER, V4 NOT-list). Two round trips (authorize, then read), acceptable
     * for a cold drill-in that is never on a hot path.
     */
    async forManagedPerson(
      personId: string,
      managedTeamIds: readonly string[],
    ): Promise<{
      person: { id: string; displayName: string | null; pseudonym: string };
      capabilities: UserCapabilityStateRow[];
    } | null> {
      if (managedTeamIds.length === 0) return null;
      const [member] = await db
        .select({
          id: people.id,
          displayName: people.displayName,
          pseudonym: people.pseudonym,
        })
        .from(teamMembers)
        .innerJoin(
          people,
          and(
            eq(people.orgId, teamMembers.orgId),
            eq(people.id, teamMembers.personId),
          ),
        )
        .where(
          and(
            eq(teamMembers.orgId, orgId),
            eq(teamMembers.personId, personId),
            inArray(teamMembers.teamId, [...managedTeamIds]),
          ),
        )
        .limit(1);
      if (!member) return null;
      const rows = await db
        .select({
          capabilitySlug: userCapabilityState.capabilitySlug,
          mastery: userCapabilityState.mastery,
          confidence: userCapabilityState.confidence,
          confidenceTier: userCapabilityState.confidenceTier,
          evidenceCount: userCapabilityState.evidenceCount,
          lastEvidenceAt: userCapabilityState.lastEvidenceAt,
          staleness: userCapabilityState.staleness,
          nextCapability: userCapabilityState.nextCapability,
          components: userCapabilityState.components,
        })
        .from(userCapabilityState)
        .where(
          and(
            eq(userCapabilityState.orgId, orgId),
            eq(userCapabilityState.personId, personId),
          ),
        );
      return {
        person: member,
        capabilities: rows
          .map((r) => ({
            ...r,
            components: r.components as CapabilityComponentBreakdown,
          }))
          .sort(
            (a, b) =>
              b.mastery - a.mastery ||
              a.capabilitySlug.localeCompare(b.capabilitySlug),
          ),
      };
    },

    /** The set of person ids that currently have ≥1 state row (ONE query). The
     * reducer uses it to reconcile only people who could have stale rows,
     * keeping writes bounded to people-with-changes rather than all people. */
    async personIdsWithState(): Promise<Set<string>> {
      const rows = await db
        .selectDistinct({ personId: userCapabilityState.personId })
        .from(userCapabilityState)
        .where(eq(userCapabilityState.orgId, orgId));
      return new Set(rows.map((r) => r.personId));
    },

    /**
     * The reducer write: replace one person's whole capability state with the
     * freshly-computed set. Upserts each current row on the PK and deletes any
     * prior row for a capability the person no longer has evidence for (the
     * reconcile-down that keeps "no evidence → no row" true across runs). One
     * transaction; idempotent (same input → same rows).
     */
    async replaceForPerson(
      personId: string,
      rows: readonly UserCapabilityStateUpsert[],
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const keptSlugs = rows.map((r) => r.capabilitySlug);
        // Delete rows for capabilities no longer present (all when kept empty).
        await tx.delete(userCapabilityState).where(
          keptSlugs.length > 0
            ? and(
                eq(userCapabilityState.orgId, orgId),
                eq(userCapabilityState.personId, personId),
                notInArray(userCapabilityState.capabilitySlug, keptSlugs),
              )
            : and(
                eq(userCapabilityState.orgId, orgId),
                eq(userCapabilityState.personId, personId),
              ),
        );
        for (const r of rows) {
          await tx
            .insert(userCapabilityState)
            .values({
              orgId,
              personId,
              capabilitySlug: r.capabilitySlug,
              mastery: r.mastery,
              confidence: r.confidence,
              confidenceTier: r.confidenceTier,
              evidenceCount: r.evidenceCount,
              lastEvidenceAt: r.lastEvidenceAt,
              staleness: r.staleness,
              nextCapability: r.nextCapability,
              components: r.components,
            })
            .onConflictDoUpdate({
              target: [
                userCapabilityState.orgId,
                userCapabilityState.personId,
                userCapabilityState.capabilitySlug,
              ],
              set: {
                mastery: r.mastery,
                confidence: r.confidence,
                confidenceTier: r.confidenceTier,
                evidenceCount: r.evidenceCount,
                lastEvidenceAt: r.lastEvidenceAt,
                staleness: r.staleness,
                nextCapability: r.nextCapability,
                components: r.components,
                updatedAt: new Date(),
              },
            });
        }
      });
    },

    /**
     * Aggregate coverage for the team rollup (P6): how many people sit at or
     * above `masteredThreshold` for each capability, org-wide. COUNT-ONLY — no
     * person id ever leaves this method. `MIN_PEOPLE` suppression is applied by
     * the caller (P6), not here.
     */
    async coverageCounts(
      masteredThreshold: number,
    ): Promise<Map<string, { mastered: number; withState: number }>> {
      const rows = await db
        .select({
          capabilitySlug: userCapabilityState.capabilitySlug,
          mastery: userCapabilityState.mastery,
        })
        .from(userCapabilityState)
        .where(eq(userCapabilityState.orgId, orgId));
      const out = new Map<string, { mastered: number; withState: number }>();
      for (const r of rows) {
        const entry = out.get(r.capabilitySlug) ?? { mastered: 0, withState: 0 };
        entry.withState += 1;
        if (r.mastery >= masteredThreshold) entry.mastered += 1;
        out.set(r.capabilitySlug, entry);
      }
      return out;
    },

    /**
     * Per-capability DEPTH + SPREAD sufficient statistics (TMD P3 tail, T3.3).
     * COUNT-ONLY — no person id or per-person value ever leaves this method; the
     * outputs are aggregate SUMS over the same rows `coverageCounts` reads.
     * `sumBp` / `sumSqBp` are the sum of `masteryBasisPoints(mastery)` and its
     * square; `deriveDepthSpread` reconstructs the team mean + population stddev
     * from them. `withState` mirrors `coverageCounts`'s so a caller can
     * cross-check the two agree. One query, independent of person count (the
     * rollup writer's + dashboard's shared depth source, a sibling of
     * `coverageCounts`).
     */
    async masteryStats(): Promise<
      Map<string, { withState: number; sumBp: number; sumSqBp: number }>
    > {
      const rows = await db
        .select({
          capabilitySlug: userCapabilityState.capabilitySlug,
          mastery: userCapabilityState.mastery,
        })
        .from(userCapabilityState)
        .where(eq(userCapabilityState.orgId, orgId));
      const out = new Map<
        string,
        { withState: number; sumBp: number; sumSqBp: number }
      >();
      for (const r of rows) {
        const entry = out.get(r.capabilitySlug) ?? {
          withState: 0,
          sumBp: 0,
          sumSqBp: 0,
        };
        const bp = masteryBasisPoints(r.mastery);
        entry.withState += 1;
        entry.sumBp += bp;
        entry.sumSqBp += bp * bp;
        out.set(r.capabilitySlug, entry);
      }
      return out;
    },

    /**
     * Per-capability confidence-tier composition for the history rollup (ADR
     * 0046). COUNT-ONLY — no person id ever leaves this method. One query,
     * independent of person count (the rollup writer's tier-summary source, a
     * sibling of `coverageCounts`). `withState` mirrors `coverageCounts`'s so a
     * caller can cross-check the two agree.
     */
    async coverageTierCounts(): Promise<
      Map<string, { measured: number; withState: number }>
    > {
      const rows = await db
        .select({
          capabilitySlug: userCapabilityState.capabilitySlug,
          confidenceTier: userCapabilityState.confidenceTier,
        })
        .from(userCapabilityState)
        .where(eq(userCapabilityState.orgId, orgId));
      const out = new Map<string, { measured: number; withState: number }>();
      for (const r of rows) {
        const entry = out.get(r.capabilitySlug) ?? { measured: 0, withState: 0 };
        entry.withState += 1;
        if (r.confidenceTier === "measured") entry.measured += 1;
        out.set(r.capabilitySlug, entry);
      }
      return out;
    },
  };
}
