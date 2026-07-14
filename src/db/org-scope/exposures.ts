import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { people, recommendationExposure } from "../schema";

// Recommendation exposure log reads/writes (W7-7, ADR 0038). ORG-SCOPED and
// SELF-VIEW: there is NO manager/admin READ route anywhere in the app that
// surfaces another person's exposures — `forUser` joins people.auth_user_id so
// only the caller's rows return, and `list()` is an org-wide read used ONLY
// server-side (the isolation sweep + future founder analysis), never wired to a
// manager surface. `log()` is the idempotent write (ON CONFLICT DO NOTHING on
// the per-day dedupe key), called off the hot path (the digest sender). This
// reverses the deliberate "don't log rec-shown-to-X" stance under ADR 0038 —
// with the privacy constraints named there (self-view, purge-registered, the
// audited-impersonation caveat).

export type ExposureInsert = {
  personId: string;
  recId: string;
  surface: "dashboard" | "digest";
  shownAt: string;
  experimentKey: string | null;
  variant: string | null;
};

export type ExposureRow = {
  personId: string;
  recId: string;
  surface: string;
  shownAt: string;
  experimentKey: string | null;
  variant: string | null;
};

export function exposuresNamespace(db: Db, orgId: string) {
  return {
    /**
     * Idempotently log exposures. ON CONFLICT DO NOTHING on the
     * (org, person, rec, surface, day) key, so at-least-once digest redelivery
     * writes EXACTLY ONE row per surfaced rec per day (the plan's CAS rule). The
     * composite tenant FK rejects a personId from another org.
     */
    async log(rows: readonly ExposureInsert[]): Promise<void> {
      if (rows.length === 0) return;
      await db
        .insert(recommendationExposure)
        .values(rows.map((r) => ({ orgId, ...r })))
        .onConflictDoNothing({
          target: [
            recommendationExposure.orgId,
            recommendationExposure.personId,
            recommendationExposure.recId,
            recommendationExposure.surface,
            recommendationExposure.shownAt,
          ],
        });
    },

    /** The SIGNED-IN user's OWN exposures (self-view) — joins people.auth_user_id
     * so only the caller's rows return. */
    async forUser(authUserId: string): Promise<ExposureRow[]> {
      return db
        .select({
          personId: recommendationExposure.personId,
          recId: recommendationExposure.recId,
          surface: recommendationExposure.surface,
          shownAt: recommendationExposure.shownAt,
          experimentKey: recommendationExposure.experimentKey,
          variant: recommendationExposure.variant,
        })
        .from(recommendationExposure)
        .innerJoin(
          people,
          and(
            eq(people.orgId, recommendationExposure.orgId),
            eq(people.id, recommendationExposure.personId),
          ),
        )
        .where(
          and(
            eq(recommendationExposure.orgId, orgId),
            eq(people.authUserId, authUserId),
          ),
        );
    },

    /** Org-wide exposures — SERVER-SIDE ONLY (isolation sweep + future founder
     * analysis). Never wired to a manager route. Org-filtered, so a dropped
     * filter deterministically surfaces another org's rows (the sweep). */
    async list(): Promise<ExposureRow[]> {
      return db
        .select({
          personId: recommendationExposure.personId,
          recId: recommendationExposure.recId,
          surface: recommendationExposure.surface,
          shownAt: recommendationExposure.shownAt,
          experimentKey: recommendationExposure.experimentKey,
          variant: recommendationExposure.variant,
        })
        .from(recommendationExposure)
        .where(eq(recommendationExposure.orgId, orgId));
    },
  };
}
