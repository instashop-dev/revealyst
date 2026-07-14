import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../client";
import {
  missionProgress,
  missionSteps,
  missions,
  people,
} from "../schema";

// Missions (W7-5, ADR 0037). `missions`/`mission_steps` are GLOBAL reference
// data (no org_id) — every org sees the same catalog, not part of the isolation
// sweep. `mission_progress` is ORG-SCOPED, self-view-only: read by the signed-in
// person for their own rows (progressForUser joins people.auth_user_id); the
// reducer reads the whole org (progressForOrg) and marks completion. The `start`
// write is the person's opt-in; `markComplete` is the reducer's measured-crossing
// stamp. Anti-gamification: nothing here tracks streaks/points/xp.

export type MissionRow = { slug: string; title: string; summary: string; sort: number };
export type MissionStepRow = {
  missionSlug: string;
  stepOrder: number;
  capabilitySlug: string;
  targetMastery: number;
  label: string;
};
export type MissionProgressRow = {
  personId: string;
  missionSlug: string;
  startedAt: Date;
  completedAt: Date | null;
};

export function missionsNamespace(db: Db, orgId: string) {
  return {
    /** The global mission catalog + steps (active missions, ordered). Reference
     * data — not org-filtered. Folds into the caller's batched Promise.all. */
    async catalog(): Promise<{ missions: MissionRow[]; steps: MissionStepRow[] }> {
      const [missionRows, stepRows] = await Promise.all([
        db
          .select({
            slug: missions.slug,
            title: missions.title,
            summary: missions.summary,
            sort: missions.sort,
          })
          .from(missions)
          .where(eq(missions.isActive, true))
          .orderBy(asc(missions.sort), asc(missions.slug)),
        db
          .select({
            missionSlug: missionSteps.missionSlug,
            stepOrder: missionSteps.stepOrder,
            capabilitySlug: missionSteps.capabilitySlug,
            targetMastery: missionSteps.targetMastery,
            label: missionSteps.label,
          })
          .from(missionSteps)
          .orderBy(asc(missionSteps.missionSlug), asc(missionSteps.stepOrder)),
      ]);
      return { missions: missionRows, steps: stepRows };
    },

    /** The SIGNED-IN user's own mission progress (self-view) — joins
     * people.auth_user_id, so only the caller's rows come back. One round trip. */
    async progressForUser(authUserId: string): Promise<MissionProgressRow[]> {
      return db
        .select({
          personId: missionProgress.personId,
          missionSlug: missionProgress.missionSlug,
          startedAt: missionProgress.startedAt,
          completedAt: missionProgress.completedAt,
        })
        .from(missionProgress)
        .innerJoin(
          people,
          and(
            eq(people.orgId, missionProgress.orgId),
            eq(people.id, missionProgress.personId),
          ),
        )
        .where(
          and(
            eq(missionProgress.orgId, orgId),
            eq(people.authUserId, authUserId),
          ),
        );
    },

    /** Every mission-progress row in this org — the reducer's read for
     * completion detection. Org-filtered (the isolation sweep's surface). */
    async progressForOrg(): Promise<MissionProgressRow[]> {
      return db
        .select({
          personId: missionProgress.personId,
          missionSlug: missionProgress.missionSlug,
          startedAt: missionProgress.startedAt,
          completedAt: missionProgress.completedAt,
        })
        .from(missionProgress)
        .where(eq(missionProgress.orgId, orgId));
    },

    /** Opt-in: the person starts a mission (idempotent — a re-start is a no-op,
     * never resets a completed row). The composite tenant FK rejects a personId
     * from another org. */
    async start(personId: string, missionSlug: string): Promise<void> {
      await db
        .insert(missionProgress)
        .values({ orgId, personId, missionSlug })
        .onConflictDoNothing({
          target: [
            missionProgress.orgId,
            missionProgress.personId,
            missionProgress.missionSlug,
          ],
        });
    },

    /** The reducer's measured-crossing stamp: set completed_at ONCE (only when
     * still null), so the "you finished" moment fires exactly once. */
    async markComplete(
      personId: string,
      missionSlug: string,
      at: Date,
    ): Promise<void> {
      await db
        .update(missionProgress)
        .set({ completedAt: at })
        .where(
          and(
            eq(missionProgress.orgId, orgId),
            eq(missionProgress.personId, personId),
            eq(missionProgress.missionSlug, missionSlug),
            isNull(missionProgress.completedAt),
          ),
        );
    },
  };
}
