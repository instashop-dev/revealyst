import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { teamSettings } from "../schema";

// Per-team admin settings (TCI Phase 2-E, ADR 0045). ORG-SCOPED. One row per
// team, created lazily by set() — an ABSENT row is the fully-default state
// (get() NEVER inserts a row on read; reading is side-effect-free). The
// composite tenant FK (org_id, team_id) → teams rejects a team from another org,
// so cross-org access is unrepresentable at the DB level.

/**
 * The per-team settings this table stores, with their defaults. The defaults
 * object is what get() returns when a team has no row — so absence == every
 * value here. Extend this (and the table) when a new per-team toggle ships.
 */
export const TEAM_SETTINGS_DEFAULTS = {
  // D-TCI-2: managers may see a managed member's per-person spend by name. OFF by
  // default; capability mastery reads are not gated by this flag, spend reads are.
  managersSeeIndividualCost: false,
} as const;

export type TeamSettings = {
  managersSeeIndividualCost: boolean;
};

export function teamSettingsNamespace(db: Db, orgId: string) {
  return {
    /**
     * This team's settings, or the DEFAULTS object when the team has no row. An
     * absent row IS the default state — get() never inserts a row (a team gains a
     * row only when an admin calls set()), so reading is side-effect-free. Both the
     * org_id and team_id filters are applied, so a dropped org filter would
     * deterministically surface another org's row (the tenant-isolation guard).
     */
    async get(teamId: string): Promise<TeamSettings> {
      const [row] = await db
        .select({
          managersSeeIndividualCost: teamSettings.managersSeeIndividualCost,
        })
        .from(teamSettings)
        .where(
          and(eq(teamSettings.orgId, orgId), eq(teamSettings.teamId, teamId)),
        );
      if (!row) return { ...TEAM_SETTINGS_DEFAULTS };
      return { managersSeeIndividualCost: row.managersSeeIndividualCost };
    },

    /**
     * Admin-driven upsert of a team's settings. Creates the row on first set or
     * patches an existing one, on the (org_id, team_id) PK conflict target — one
     * settings row per team by construction, so a repeat set() overwrites rather
     * than duplicating. Only the fields present in `patch` change; omitted fields
     * keep their stored value (or the column default on first insert). The
     * composite tenant FK rejects a teamId from another org. Returns the effective
     * settings after the write.
     */
    async set(
      teamId: string,
      patch: Partial<TeamSettings>,
    ): Promise<TeamSettings> {
      const [row] = await db
        .insert(teamSettings)
        .values({
          orgId,
          teamId,
          ...(patch.managersSeeIndividualCost !== undefined
            ? { managersSeeIndividualCost: patch.managersSeeIndividualCost }
            : {}),
        })
        .onConflictDoUpdate({
          target: [teamSettings.orgId, teamSettings.teamId],
          set: {
            ...(patch.managersSeeIndividualCost !== undefined
              ? { managersSeeIndividualCost: patch.managersSeeIndividualCost }
              : {}),
            updatedAt: new Date(),
          },
        })
        .returning({
          managersSeeIndividualCost: teamSettings.managersSeeIndividualCost,
        });
      return { managersSeeIndividualCost: row.managersSeeIndividualCost };
    },
  };
}
