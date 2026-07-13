import { and, eq, gte, isNull, like, lte, notInArray, or, sql } from "drizzle-orm";
import {
  CUSTOM_INDEX_SUBJECT_LEVELS,
  CUSTOM_SLUG_PREFIX,
  CustomIndexCapError,
  CustomIndexNotFoundError,
  isCustomSlug,
  MAX_ACTIVE_CUSTOM_DEFINITIONS,
  type CustomIndexSubjectLevel,
} from "../../lib/custom-index";
import type { Db } from "../client";
import { orgs, scoreDefinitions, scoreResults } from "../schema";

/** What the W1-F engine emits — upserted on the score_results unique key. */
export type ScoreResultUpsert = {
  definitionId: string;
  subjectLevel: (typeof scoreResults.subjectLevel.enumValues)[number];
  personId?: string | null;
  teamId?: string | null;
  periodStart: string;
  periodEnd: string;
  periodGrain: (typeof scoreResults.periodGrain.enumValues)[number];
  value: number;
  attribution: (typeof scoreResults.attribution.enumValues)[number];
  components: unknown;
};

export function scoresNamespace(db: Db, orgId: string) {
  return {
    /** Definitions visible to this org: global presets (org_id NULL —
     * the documented reference-data exception) ∪ this org's own rows. */
    async definitions() {
      return db
        .select()
        .from(scoreDefinitions)
        .where(
          or(
            isNull(scoreDefinitions.orgId),
            eq(scoreDefinitions.orgId, orgId),
          ),
        )
        .orderBy(scoreDefinitions.slug, scoreDefinitions.version);
    },

    // ── Custom Index Builder (W4-U, ADR 0021) ──────────────────────────
    // Org-authored custom definitions live in the SAME score_definitions
    // table as presets, distinguished ONLY by (org_id set + `custom-` slug
    // prefix). These methods are strictly org-scoped (every WHERE pins
    // org_id) and NEVER touch a global preset (org_id NULL) — the prefix
    // filter is belt-and-suspenders on top of the org_id filter.

    /** Every version of every custom index this org owns (all statuses),
     * ordered slug then version — the builder groups this into per-slug
     * views. Presets (org_id NULL) and the personal-org preset clones
     * (non-custom slugs) are excluded by the prefix filter. */
    async customDefinitions() {
      return db
        .select()
        .from(scoreDefinitions)
        .where(
          and(
            eq(scoreDefinitions.orgId, orgId),
            like(scoreDefinitions.slug, `${CUSTOM_SLUG_PREFIX}%`),
          ),
        )
        .orderBy(scoreDefinitions.slug, scoreDefinitions.version);
    },

    /**
     * Publishes a custom index as a new immutable version row (§8.5): if the
     * slug already has an active version it is retired and the new version
     * supersedes it (history stays reproducible — old score_results keep
     * pointing at the old definition id). If the slug is NEW or currently
     * archived, publishing (re)introduces it to the ACTIVE set, so the
     * per-org cap of {@link MAX_ACTIVE_CUSTOM_DEFINITIONS} is enforced first.
     * Transactional so a concurrent/redelivered publish can't over-cap or
     * leave two active versions of one slug.
     */
    async publishCustomDefinition(input: {
      slug: string;
      name: string;
      subjectLevel: CustomIndexSubjectLevel;
      components: unknown;
    }) {
      if (!isCustomSlug(input.slug)) {
        // Defense in depth — the API layer validates this, but the repo
        // must never write a non-custom (potentially preset-shadowing) row.
        throw new Error(
          `refusing to publish non-custom slug "${input.slug}" as a custom index`,
        );
      }
      if (
        !(CUSTOM_INDEX_SUBJECT_LEVELS as readonly string[]).includes(
          input.subjectLevel,
        )
      ) {
        // §8.5 guardrail 1, runtime-enforced at the repo too: the TS type
        // alone would let a non-zod caller insert a person-level custom row
        // that the nightly recompute would then score — an admin-built
        // people-scoring surface. Mirror the slug guard above.
        throw new Error(
          `refusing to publish custom index at subject level "${input.subjectLevel}" — custom indexes are team/org only`,
        );
      }
      return db.transaction(async (tx) => {
        // Serialize all publishes/unarchives for this org on the org row so
        // the cap count and the version number are read under a lock — two
        // concurrent creates of distinct slugs can't both pass a stale
        // count and over-cap, and two publishes of the SAME slug can't
        // compute the same nextVersion and collide on the unique key.
        await tx.execute(
          sql`select id from ${orgs} where ${orgs.id} = ${orgId} for update`,
        );
        const existing = await tx
          .select()
          .from(scoreDefinitions)
          .where(
            and(
              eq(scoreDefinitions.orgId, orgId),
              eq(scoreDefinitions.slug, input.slug),
            ),
          );
        const hasActiveVersion = existing.some((r) => r.status === "active");
        if (!hasActiveVersion) {
          // Publishing adds this slug to the active set — enforce the cap on
          // DISTINCT active custom slugs (a new version of an already-active
          // slug is net-zero and skips this check).
          const activeCustom = await tx
            .select({ slug: scoreDefinitions.slug })
            .from(scoreDefinitions)
            .where(
              and(
                eq(scoreDefinitions.orgId, orgId),
                like(scoreDefinitions.slug, `${CUSTOM_SLUG_PREFIX}%`),
                eq(scoreDefinitions.status, "active"),
              ),
            );
          const activeSlugs = new Set(activeCustom.map((r) => r.slug));
          if (activeSlugs.size >= MAX_ACTIVE_CUSTOM_DEFINITIONS) {
            throw new CustomIndexCapError();
          }
        }
        const nextVersion =
          existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;
        if (hasActiveVersion) {
          await tx
            .update(scoreDefinitions)
            .set({ status: "retired" })
            .where(
              and(
                eq(scoreDefinitions.orgId, orgId),
                eq(scoreDefinitions.slug, input.slug),
                eq(scoreDefinitions.status, "active"),
              ),
            );
        }
        const [row] = await tx
          .insert(scoreDefinitions)
          .values({
            orgId,
            slug: input.slug,
            version: nextVersion,
            name: input.name,
            subjectLevel: input.subjectLevel,
            components: input.components,
            status: "active",
          })
          .returning();
        return row;
      });
    },

    /**
     * Archives a custom index: retires its currently-active version so it
     * stops recomputing and frees a cap slot. Rows are never deleted
     * (versioned history is immutable) — archive is a status flip. Returns
     * true if a version was retired, false if the slug had no active version
     * (already archived → idempotent no-op).
     */
    async archiveCustomDefinition(slug: string) {
      if (!isCustomSlug(slug)) {
        throw new CustomIndexNotFoundError();
      }
      const retired = await db
        .update(scoreDefinitions)
        .set({ status: "retired" })
        .where(
          and(
            eq(scoreDefinitions.orgId, orgId),
            eq(scoreDefinitions.slug, slug),
            eq(scoreDefinitions.status, "active"),
          ),
        )
        .returning({ id: scoreDefinitions.id });
      return retired.length > 0;
    },

    /**
     * Unarchives a custom index: reactivates its HIGHEST version (the head),
     * bringing the slug back into the active set — so the cap is re-checked.
     * Idempotent when the slug is already active. Throws
     * {@link CustomIndexNotFoundError} for a slug this org doesn't own.
     */
    async unarchiveCustomDefinition(slug: string) {
      if (!isCustomSlug(slug)) {
        throw new CustomIndexNotFoundError();
      }
      return db.transaction(async (tx) => {
        // Same per-org serialization as publish (see there): the cap
        // re-check below must be under the org-row lock.
        await tx.execute(
          sql`select id from ${orgs} where ${orgs.id} = ${orgId} for update`,
        );
        const existing = await tx
          .select()
          .from(scoreDefinitions)
          .where(
            and(
              eq(scoreDefinitions.orgId, orgId),
              eq(scoreDefinitions.slug, slug),
            ),
          );
        if (existing.length === 0) {
          throw new CustomIndexNotFoundError();
        }
        if (existing.some((r) => r.status === "active")) {
          return true; // already active — no-op
        }
        const activeCustom = await tx
          .select({ slug: scoreDefinitions.slug })
          .from(scoreDefinitions)
          .where(
            and(
              eq(scoreDefinitions.orgId, orgId),
              like(scoreDefinitions.slug, `${CUSTOM_SLUG_PREFIX}%`),
              eq(scoreDefinitions.status, "active"),
            ),
          );
        if (
          new Set(activeCustom.map((r) => r.slug)).size >=
          MAX_ACTIVE_CUSTOM_DEFINITIONS
        ) {
          throw new CustomIndexCapError();
        }
        const head = existing.reduce((best, r) =>
          r.version > best.version ? r : best,
        );
        await tx
          .update(scoreDefinitions)
          .set({ status: "active" })
          .where(
            and(
              eq(scoreDefinitions.orgId, orgId),
              eq(scoreDefinitions.id, head.id),
            ),
          );
        return true;
      });
    },

    /**
     * Recompute upsert (nightly + on-demand post-backfill): the
     * NULLS NOT DISTINCT unique key makes re-runs overwrite, and org_id
     * inside the key keeps the conflict path tenant-safe. `attribution`
     * must already be the LOWEST of the inputs — the engine's frozen
     * propagation rule.
     */
    async upsertResults(rows: ScoreResultUpsert[]) {
      for (const r of rows) {
        await db
          .insert(scoreResults)
          .values({
            orgId,
            definitionId: r.definitionId,
            subjectLevel: r.subjectLevel,
            personId: r.personId ?? null,
            teamId: r.teamId ?? null,
            periodStart: r.periodStart,
            periodEnd: r.periodEnd,
            periodGrain: r.periodGrain,
            value: r.value,
            attribution: r.attribution,
            components: r.components,
          })
          .onConflictDoUpdate({
            target: [
              scoreResults.orgId,
              scoreResults.definitionId,
              scoreResults.subjectLevel,
              scoreResults.personId,
              scoreResults.teamId,
              scoreResults.periodStart,
              scoreResults.periodEnd,
            ],
            set: {
              periodGrain: r.periodGrain,
              value: r.value,
              attribution: r.attribution,
              components: r.components,
              computedAt: new Date(),
            },
          });
      }
    },

    /**
     * Reconciles person-level score_results for one (definition, period)
     * down to exactly the people this recompute run actually scored.
     * `upsertResults` only inserts/updates — a person who no longer
     * qualifies (their subject stopped being exclusive on relink, e.g.
     * W2-K's shared-account detection, or their signal dropped to zero)
     * would otherwise keep last run's row forever, silently disconnected
     * from current attribution. Called once per definition+period after
     * that round's upserts are known, so it is safe to re-run (idempotent)
     * and scoped tightly (never touches other definitions/periods/teams).
     */
    async deleteStalePersonResults(
      definitionId: string,
      period: { periodStart: string; periodEnd: string },
      keepPersonIds: string[],
    ) {
      const scope = [
        eq(scoreResults.orgId, orgId),
        eq(scoreResults.definitionId, definitionId),
        eq(scoreResults.subjectLevel, "person"),
        eq(scoreResults.periodStart, period.periodStart),
        eq(scoreResults.periodEnd, period.periodEnd),
      ];
      const removed = await db
        .delete(scoreResults)
        .where(
          and(
            ...scope,
            keepPersonIds.length > 0
              ? notInArray(scoreResults.personId, keepPersonIds)
              // No-one qualified this round — every existing row is stale.
              : undefined,
          ),
        )
        .returning({ id: scoreResults.id });
      return removed.length;
    },

    /**
     * Team/org siblings of `deleteStalePersonResults` (ADR 0012): after a
     * restatement-to-empty (poller delete of a whole window, purged
     * connection), evaluate returns null and `upsertResults` never touches
     * the old row — a team/org score computed from data that no longer
     * exists would otherwise render forever. Same idempotent, tightly
     * scoped delete, keyed by teamId / the single org-level row.
     */
    async deleteStaleTeamResults(
      definitionId: string,
      period: { periodStart: string; periodEnd: string },
      keepTeamIds: string[],
    ) {
      const removed = await db
        .delete(scoreResults)
        .where(
          and(
            eq(scoreResults.orgId, orgId),
            eq(scoreResults.definitionId, definitionId),
            eq(scoreResults.subjectLevel, "team"),
            eq(scoreResults.periodStart, period.periodStart),
            eq(scoreResults.periodEnd, period.periodEnd),
            keepTeamIds.length > 0
              ? notInArray(scoreResults.teamId, keepTeamIds)
              // No team qualified this round — every existing row is stale.
              : undefined,
          ),
        )
        .returning({ id: scoreResults.id });
      return removed.length;
    },

    async deleteStaleOrgResults(
      definitionId: string,
      period: { periodStart: string; periodEnd: string },
    ) {
      const removed = await db
        .delete(scoreResults)
        .where(
          and(
            eq(scoreResults.orgId, orgId),
            eq(scoreResults.definitionId, definitionId),
            eq(scoreResults.subjectLevel, "org"),
            eq(scoreResults.periodStart, period.periodStart),
            eq(scoreResults.periodEnd, period.periodEnd),
          ),
        )
        .returning({ id: scoreResults.id });
      return removed.length;
    },

    async results(filter: {
      definitionId?: string;
      subjectLevel?: (typeof scoreResults.subjectLevel.enumValues)[number];
      from?: string;
      to?: string;
    }) {
      const conditions = [eq(scoreResults.orgId, orgId)];
      if (filter.definitionId) {
        conditions.push(eq(scoreResults.definitionId, filter.definitionId));
      }
      if (filter.subjectLevel) {
        conditions.push(eq(scoreResults.subjectLevel, filter.subjectLevel));
      }
      if (filter.from) {
        conditions.push(gte(scoreResults.periodStart, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(scoreResults.periodEnd, filter.to));
      }
      return db
        .select()
        .from(scoreResults)
        .where(and(...conditions))
        .orderBy(scoreResults.periodStart);
    },
  };
}
