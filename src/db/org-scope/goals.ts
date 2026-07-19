import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { teamGoals } from "../schema";
import type { TeamGoalMetric } from "../../lib/team-goal";

// Team goal reads/writes (TMD P1, ADR 0061). ORG-SCOPED. A team goal is the
// manager-set objective that heads the Command Center: one ACTIVE goal per org
// (team_id NULL, the common case) or per team (team_id non-null) at a time.
// Older goals are archived, never deleted. This surface holds no per-person data
// beyond `ownerUserId` (the manager's own auth user id).

export type TeamGoalStatus = "active" | "met" | "archived";

export type TeamGoalRow = {
  id: string;
  teamId: string | null;
  metricSlug: TeamGoalMetric;
  baseline: number | null;
  target: number;
  reviewDate: string;
  ownerUserId: string;
  status: TeamGoalStatus;
};

export type TeamGoalInput = {
  teamId: string | null;
  metricSlug: TeamGoalMetric;
  /** NULL when the current value is unmeasured — never fabricate (invariant b). */
  baseline: number | null;
  target: number;
  /** ISO date string "YYYY-MM-DD". */
  reviewDate: string;
  ownerUserId: string;
};

const SELECTION = {
  id: teamGoals.id,
  teamId: teamGoals.teamId,
  metricSlug: teamGoals.metricSlug,
  baseline: teamGoals.baseline,
  target: teamGoals.target,
  reviewDate: teamGoals.reviewDate,
  ownerUserId: teamGoals.ownerUserId,
  status: teamGoals.status,
} as const;

function mapRow(r: {
  id: string;
  teamId: string | null;
  metricSlug: string;
  baseline: number | null;
  target: number;
  reviewDate: string;
  ownerUserId: string;
  status: string;
}): TeamGoalRow {
  return {
    id: r.id,
    teamId: r.teamId,
    metricSlug: r.metricSlug as TeamGoalMetric,
    baseline: r.baseline,
    target: r.target,
    reviewDate: r.reviewDate,
    ownerUserId: r.ownerUserId,
    status: r.status as TeamGoalStatus,
  };
}

/** Match a specific team's rows, or the org-wide rows when `teamId` is null.
 * `eq(col, null)` would emit `= NULL` (never true) — the org-wide case needs
 * `IS NULL`, so branch it. */
function teamScope(teamId: string | null) {
  return teamId === null ? isNull(teamGoals.teamId) : eq(teamGoals.teamId, teamId);
}

export function goalsNamespace(db: Db, orgId: string) {
  return {
    /**
     * The single ACTIVE goal for this org (`teamId` null = org-wide) or team, or
     * undefined. Org-scoped; the DB's two partial unique indexes guarantee at most
     * one active row per scope, so this never needs a tiebreak.
     */
    async getActive(teamId: string | null): Promise<TeamGoalRow | undefined> {
      const [row] = await db
        .select(SELECTION)
        .from(teamGoals)
        .where(
          and(
            eq(teamGoals.orgId, orgId),
            teamScope(teamId),
            eq(teamGoals.status, "active"),
          ),
        );
      return row ? mapRow(row) : undefined;
    },

    /**
     * EVERY goal for this org (any status) — the tenant-isolation sweep's guard
     * and the header/history read. Org-filtered, so a dropped filter surfaces
     * another org's rows (the sweep detects a leaked team uuid via `teamId`; the
     * row carries no person id).
     */
    async list(): Promise<TeamGoalRow[]> {
      const rows = await db
        .select(SELECTION)
        .from(teamGoals)
        .where(eq(teamGoals.orgId, orgId))
        .orderBy(desc(teamGoals.createdAt));
      return rows.map(mapRow);
    },

    /**
     * Set the active goal for a scope: archive any current active goal for this
     * (org, teamId), then insert the new one — as ONE transaction, so a
     * concurrent/redelivered call can't leave two active rows (the two partial
     * unique indexes are the DB backstop; the transaction makes the common path
     * clean). Returns the new active row.
     *
     * Concurrency note for the P1b setter: if two setActive calls for the SAME
     * scope race, the loser's INSERT hits the partial unique index and throws a
     * Postgres unique_violation (23505) rather than creating a second active row.
     * The caller (a manager double-submit) should catch that and re-read/return
     * the existing active goal, not surface a 500.
     */
    async setActive(input: TeamGoalInput): Promise<TeamGoalRow> {
      return db.transaction(async (tx) => {
        await tx
          .update(teamGoals)
          .set({ status: "archived", statusChangedAt: new Date() })
          .where(
            and(
              eq(teamGoals.orgId, orgId),
              teamScope(input.teamId),
              eq(teamGoals.status, "active"),
            ),
          );
        const [row] = await tx
          .insert(teamGoals)
          .values({
            orgId,
            teamId: input.teamId,
            metricSlug: input.metricSlug,
            baseline: input.baseline,
            target: input.target,
            reviewDate: input.reviewDate,
            ownerUserId: input.ownerUserId,
          })
          .returning(SELECTION);
        return mapRow(row);
      });
    },
  };
}
