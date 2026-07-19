import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { initiativeParticipants, initiatives, people } from "../schema";

// Initiative reads/writes (TMD P2, ADR 0062). ORG-SCOPED. An initiative is a
// tracked management effort with an owner, named participants, a baseline/target
// and a review date. This namespace holds the DATA-layer surface:
//   - initiative reads/writes are org-scoped and count-only in shape (no
//     participant NAMES here — those are a separate manager-authorized read
//     added in the read layer, gated by a team-manager grant + the authz matrix,
//     ADR 0062);
//   - `participantsForOrg` returns internal person UUIDS only (never a
//     name/email) — the reducer/isolation-sweep surface, mirroring
//     missions.progressForOrg.

export type InitiativeStatus =
  | "draft"
  | "active"
  | "in_review"
  | "completed"
  | "stopped";
export type InitiativeOutcome =
  | "improved"
  | "unchanged"
  | "worsened"
  | "inconclusive";

export type InitiativeRow = {
  id: string;
  teamId: string | null;
  ownerUserId: string;
  title: string;
  templateSlug: string | null;
  capabilitySlug: string | null;
  scoreSlug: string | null;
  baseline: number | null;
  target: number;
  reviewDate: string;
  status: InitiativeStatus;
  outcome: InitiativeOutcome | null;
};

export type InitiativeInput = {
  teamId: string | null;
  ownerUserId: string;
  title: string;
  templateSlug: string | null;
  capabilitySlug: string | null;
  scoreSlug: string | null;
  baseline: number | null;
  target: number;
  reviewDate: string;
};

const SELECTION = {
  id: initiatives.id,
  teamId: initiatives.teamId,
  ownerUserId: initiatives.ownerUserId,
  title: initiatives.title,
  templateSlug: initiatives.templateSlug,
  capabilitySlug: initiatives.capabilitySlug,
  scoreSlug: initiatives.scoreSlug,
  baseline: initiatives.baseline,
  target: initiatives.target,
  reviewDate: initiatives.reviewDate,
  status: initiatives.status,
  outcome: initiatives.outcome,
} as const;

function mapRow(r: {
  id: string;
  teamId: string | null;
  ownerUserId: string;
  title: string;
  templateSlug: string | null;
  capabilitySlug: string | null;
  scoreSlug: string | null;
  baseline: number | null;
  target: number;
  reviewDate: string;
  status: string;
  outcome: string | null;
}): InitiativeRow {
  return {
    id: r.id,
    teamId: r.teamId,
    ownerUserId: r.ownerUserId,
    title: r.title,
    templateSlug: r.templateSlug,
    capabilitySlug: r.capabilitySlug,
    scoreSlug: r.scoreSlug,
    baseline: r.baseline,
    target: r.target,
    reviewDate: r.reviewDate,
    status: r.status as InitiativeStatus,
    outcome: (r.outcome as InitiativeOutcome | null) ?? null,
  };
}

export function initiativesNamespace(db: Db, orgId: string) {
  return {
    /** Create an initiative. Org-scoped; the composite tenant FK rejects a
     * cross-org team. Returns the new row (participants are added separately). */
    async create(input: InitiativeInput): Promise<InitiativeRow> {
      const [row] = await db
        .insert(initiatives)
        .values({ orgId, ...input })
        .returning(SELECTION);
      return mapRow(row);
    },

    /** EVERY initiative for this org (any status) — the tenant-isolation sweep's
     * guard and the count-only card read. Org-filtered, so a dropped filter
     * surfaces another org's rows (the sweep detects a leaked team uuid via
     * `teamId`; the row carries no participant names). */
    async list(): Promise<InitiativeRow[]> {
      const rows = await db
        .select(SELECTION)
        .from(initiatives)
        .where(eq(initiatives.orgId, orgId));
      return rows.map(mapRow);
    },

    /** One initiative by id (org-scoped) — undefined when absent/other-org. */
    async get(id: string): Promise<InitiativeRow | undefined> {
      const [row] = await db
        .select(SELECTION)
        .from(initiatives)
        .where(and(eq(initiatives.orgId, orgId), eq(initiatives.id, id)));
      return row ? mapRow(row) : undefined;
    },

    /** Add named participants to an initiative (idempotent per person). Org-
     * scoped; the composite tenant FK rejects a cross-org person or a cross-org
     * initiative. */
    async addParticipants(
      initiativeId: string,
      personIds: readonly string[],
    ): Promise<void> {
      if (personIds.length === 0) return;
      await db
        .insert(initiativeParticipants)
        .values(personIds.map((personId) => ({ orgId, initiativeId, personId })))
        .onConflictDoNothing();
    },

    /** EVERY participant row for this org — reducer/isolation-sweep surface,
     * INTERNAL person UUIDS only (never a name/email). Mirrors
     * missions.progressForOrg: a dropped org filter surfaces another org's
     * personId (the leak universe). */
    async participantsForOrg(): Promise<
      { initiativeId: string; personId: string }[]
    > {
      return db
        .select({
          initiativeId: initiativeParticipants.initiativeId,
          personId: initiativeParticipants.personId,
        })
        .from(initiativeParticipants)
        .where(eq(initiativeParticipants.orgId, orgId));
    },

    /** COUNT-ONLY participant count per initiative for this org (the card's "N
     * of M" — never a name). */
    async participantCounts(): Promise<Map<string, number>> {
      const rows = await db
        .select({
          initiativeId: initiativeParticipants.initiativeId,
          count: sql<number>`count(*)::int`,
        })
        .from(initiativeParticipants)
        .where(eq(initiativeParticipants.orgId, orgId))
        .groupBy(initiativeParticipants.initiativeId);
      return new Map(rows.map((r) => [r.initiativeId, r.count]));
    },

    /** Set an initiative's status (org-scoped), stamping statusChangedAt. When
     * `fromStatuses` is given it is a COMPARE-AND-SET: the update applies only
     * when the current status is one of them, and the boolean says whether it
     * won. This makes the P3 lifecycle transitions ATOMIC — two concurrent
     * reviewers (e.g. complete + stop from two devices) can't both write, so an
     * initiative can never land `stopped` WITH an outcome set (the read-then-act
     * guard in the impl is a friendly-error fast path; this is the real guard). */
    async setStatus(
      id: string,
      status: InitiativeStatus,
      opts?: { fromStatuses?: readonly InitiativeStatus[] },
    ): Promise<boolean> {
      const conds = [eq(initiatives.orgId, orgId), eq(initiatives.id, id)];
      if (opts?.fromStatuses) {
        conds.push(inArray(initiatives.status, [...opts.fromStatuses]));
      }
      const rows = await db
        .update(initiatives)
        .set({ status, statusChangedAt: new Date() })
        .where(and(...conds))
        .returning({ id: initiatives.id });
      return rows.length > 0;
    },

    /** Record the manager-set outcome at review time (org-scoped). Never a
     * causal claim — the review presents measured before/after (P3). A
     * COMPARE-AND-SET over the open statuses: applies (and returns true) only
     * when the initiative is still `active`/`in_review`, so it can't be
     * double-reviewed under concurrency. Sets status `completed`. */
    async setOutcome(id: string, outcome: InitiativeOutcome): Promise<boolean> {
      const rows = await db
        .update(initiatives)
        .set({ outcome, status: "completed", statusChangedAt: new Date() })
        .where(
          and(
            eq(initiatives.orgId, orgId),
            eq(initiatives.id, id),
            inArray(initiatives.status, ["active", "in_review"]),
          ),
        )
        .returning({ id: initiatives.id });
      return rows.length > 0;
    },

    /** NAMED participant roster for one initiative (org-scoped join to people).
     * This is a NAMED read — the caller MUST enforce the manager authorization
     * (owner-only + managed/full mode) BEFORE calling it; it is registered in
     * MANAGER_AUTHORIZED_IDENTITY_SURFACES as
     * `initiativeRoster.participants[].displayName` (P2c, ADR 0062). Returns the
     * pseudonym as a fallback label when a person has no real name. */
    async participantsWithNames(
      initiativeId: string,
    ): Promise<{ personId: string; displayName: string | null; pseudonym: string }[]> {
      return db
        .select({
          personId: people.id,
          displayName: people.displayName,
          pseudonym: people.pseudonym,
        })
        .from(initiativeParticipants)
        .innerJoin(
          people,
          and(
            eq(initiativeParticipants.orgId, people.orgId),
            eq(initiativeParticipants.personId, people.id),
          ),
        )
        .where(
          and(
            eq(initiativeParticipants.orgId, orgId),
            eq(initiativeParticipants.initiativeId, initiativeId),
          ),
        );
    },

    /** Remove one participant (org-scoped) — the owner may prune the roster. */
    async removeParticipant(
      initiativeId: string,
      personId: string,
    ): Promise<void> {
      await db
        .delete(initiativeParticipants)
        .where(
          and(
            eq(initiativeParticipants.orgId, orgId),
            eq(initiativeParticipants.initiativeId, initiativeId),
            eq(initiativeParticipants.personId, personId),
          ),
        );
    },

    /** Batch participant counts filtered to a set of initiative ids (unused in
     * P2a; kept alongside participantCounts for the P2b card). */
    async participantCountsFor(
      initiativeIds: readonly string[],
    ): Promise<Map<string, number>> {
      if (initiativeIds.length === 0) return new Map();
      const rows = await db
        .select({
          initiativeId: initiativeParticipants.initiativeId,
          count: sql<number>`count(*)::int`,
        })
        .from(initiativeParticipants)
        .where(
          and(
            eq(initiativeParticipants.orgId, orgId),
            inArray(
              initiativeParticipants.initiativeId,
              initiativeIds as string[],
            ),
          ),
        )
        .groupBy(initiativeParticipants.initiativeId);
      return new Map(rows.map((r) => [r.initiativeId, r.count]));
    },
  };
}
