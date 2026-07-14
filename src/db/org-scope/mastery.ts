import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "../client";
import { people, userCapabilityState } from "../schema";
import type { CapabilityComponentBreakdown } from "../../scoring/capability-state";

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
  };
}
