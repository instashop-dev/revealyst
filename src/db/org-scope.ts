import { and, eq, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import {
  countTrackedUsers,
  type BillingPeriod,
} from "../contracts/tracked-user";
import {
  currentKekVersion,
  decryptCredential,
  encryptCredential,
  rewrapCredential,
  type CredentialEnv,
} from "../lib/credentials";
import {
  generatePseudonym,
  generateSuffixedPseudonym,
} from "../lib/pseudonym";
import type { Db } from "./client";
import {
  connectionCredentials,
  connections,
  identities,
  metricRecords,
  orgMembers,
  orgs,
  people,
  pollHeartbeats,
  rawPayloads,
  scoreDefinitions,
  scoreResults,
  subjectDaySignals,
  subjects,
  teamMembers,
  teams,
} from "./schema";

/**
 * Resolves a user's org membership — the one query that runs *before* an
 * org scope exists (it's how the scope is established). Lives here so the
 * tenancy seam stays in a single reviewed module.
 */
export async function membershipForUser(db: Db, userId: string) {
  const [membership] = await db
    .select({
      orgId: orgMembers.orgId,
      orgName: orgs.name,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(eq(orgMembers.userId, userId))
    .orderBy(orgMembers.createdAt)
    .limit(1);
  return membership;
}

/**
 * Creates a user's org of one + admin membership if they have none, and
 * returns their membership. Transactional (no org without membership) and
 * idempotent (re-running returns the existing membership) — Better Auth's
 * `after` hooks run post-commit, so a hook failure must be recoverable on
 * the next request rather than leaving the user permanently org-less.
 * Concurrent first requests serialize on the orgs.bootstrap_user_id unique
 * constraint: the losing insert no-ops and adopts the winner's org, so two
 * orgs for one signup are unrepresentable (the W0-C race fix).
 */
export async function ensureOrgOfOne(
  db: Db,
  user: { id: string; name?: string | null; email: string },
) {
  const existing = await membershipForUser(db, user.id);
  if (existing) {
    return existing;
  }
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(orgs)
      .values({
        name: user.name || user.email,
        kind: "personal",
        bootstrapUserId: user.id,
      })
      .onConflictDoNothing({ target: orgs.bootstrapUserId })
      .returning({ id: orgs.id });
    const orgId =
      inserted?.id ??
      (
        await tx
          .select({ id: orgs.id })
          .from(orgs)
          .where(eq(orgs.bootstrapUserId, user.id))
      )[0]?.id;
    if (orgId) {
      await tx
        .insert(orgMembers)
        .values({ orgId, userId: user.id, role: "admin" })
        .onConflictDoNothing();
    }
  });
  const membership = await membershipForUser(db, user.id);
  if (!membership) {
    throw new Error(`org bootstrap failed for user ${user.id}`);
  }
  return membership;
}

/**
 * Org-scoped repository layer — the tenancy rule's enforcement point.
 *
 * Every query in application code goes through `forOrg(db, orgId)`; raw
 * table access outside this module is a review-blocker (CLAUDE.md). W0-C
 * freezes the full contract (RLS or this layer, decided there); this is
 * the walking-skeleton version proving the shape: the org filter is
 * applied inside the layer, so call sites cannot forget it.
 */
/** Postgres unique-violation, across postgres.js and PGlite drivers. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export type CreatePersonInput = {
  pseudonym?: string;
  displayName?: string | null;
  email?: string | null;
  authUserId?: string | null;
};

export type CreateConnectionInput = {
  vendor: string;
  displayName: string;
  authKind: (typeof connections.authKind.enumValues)[number];
  config?: Record<string, unknown>;
};

/** What Connector.discover() emits — upserted on (connection, kind, external_id). */
export type SubjectDescriptor = {
  kind: (typeof subjects.kind.enumValues)[number];
  externalId: string;
  email?: string | null;
  displayName?: string | null;
  meta?: Record<string, unknown>;
};

/** What Connector.normalize() emits — upserted on the metric_records PK. */
export type MetricRecordUpsert = {
  subjectId: string;
  metricKey: string;
  day: string; // YYYY-MM-DD, UTC calendar day
  dim?: string;
  connectionId: string;
  value: number;
  attribution: (typeof metricRecords.attribution.enumValues)[number];
  sourceConnector: string;
  rawPayloadId?: string | null;
};

export type SubjectDaySignalUpsert = {
  subjectId: string;
  day: string;
  hours?: number[] | null;
  peakConcurrency?: number | null;
  sourceGranularity: (typeof subjectDaySignals.sourceGranularity.enumValues)[number];
};

export type RawPayloadInsert = {
  connectionId: string;
  vendor: string;
  kind: string;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  payload: unknown;
};

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

export function forOrg(db: Db, orgId: string) {
  return {
    orgId,

    people: {
      /**
       * Creates a tracked person. Pseudonyms are auto-generated and retried
       * on per-org collision (suffixed on the final attempt, so creation
       * cannot fail on pseudonym exhaustion). An explicitly supplied
       * pseudonym is never retried — its collision is the caller's error.
       */
      async create(input: CreatePersonInput = {}) {
        const values = {
          orgId,
          displayName: input.displayName ?? null,
          email: input.email?.toLowerCase() ?? null,
          authUserId: input.authUserId ?? null,
        };
        if (input.pseudonym) {
          const [row] = await db
            .insert(people)
            .values({ ...values, pseudonym: input.pseudonym })
            .returning();
          return row;
        }
        const MAX_ATTEMPTS = 4;
        for (let attempt = 1; ; attempt++) {
          const pseudonym =
            attempt < MAX_ATTEMPTS
              ? generatePseudonym()
              : generateSuffixedPseudonym();
          try {
            const [row] = await db
              .insert(people)
              .values({ ...values, pseudonym })
              .returning();
            return row;
          } catch (error) {
            if (!isUniqueViolation(error) || attempt >= MAX_ATTEMPTS + 2) {
              throw error;
            }
          }
        }
      },

      async list() {
        return db
          .select()
          .from(people)
          .where(eq(people.orgId, orgId))
          .orderBy(people.createdAt);
      },

      async get(id: string) {
        const [row] = await db
          .select()
          .from(people)
          .where(and(eq(people.orgId, orgId), eq(people.id, id)));
        return row;
      },
    },

    teams: {
      async create(name: string) {
        const [row] = await db
          .insert(teams)
          .values({ orgId, name })
          .returning();
        return row;
      },

      async list() {
        return db
          .select()
          .from(teams)
          .where(eq(teams.orgId, orgId))
          .orderBy(teams.createdAt);
      },

      /**
       * Adds a tracked person to a team. The composite (org_id, …) FKs
       * reject any cross-org combination at the DB level.
       */
      async addMember(teamId: string, personId: string) {
        await db
          .insert(teamMembers)
          .values({ orgId, teamId, personId })
          .onConflictDoNothing();
      },

      async removeMember(teamId: string, personId: string) {
        await db
          .delete(teamMembers)
          .where(
            and(
              eq(teamMembers.orgId, orgId),
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.personId, personId),
            ),
          );
      },

      async members(teamId: string) {
        return db
          .select({
            personId: people.id,
            pseudonym: people.pseudonym,
            displayName: people.displayName,
          })
          .from(teamMembers)
          .innerJoin(
            people,
            and(
              eq(teamMembers.personId, people.id),
              eq(teamMembers.orgId, people.orgId),
            ),
          )
          .where(
            and(eq(teamMembers.orgId, orgId), eq(teamMembers.teamId, teamId)),
          );
      },
    },

    connections: {
      async create(input: CreateConnectionInput) {
        const [row] = await db
          .insert(connections)
          .values({
            orgId,
            vendor: input.vendor,
            displayName: input.displayName,
            authKind: input.authKind,
            config: input.config ?? {},
          })
          .returning();
        return row;
      },

      async list() {
        return db
          .select()
          .from(connections)
          .where(eq(connections.orgId, orgId))
          .orderBy(connections.createdAt);
      },

      async get(id: string) {
        const [row] = await db
          .select()
          .from(connections)
          .where(and(eq(connections.orgId, orgId), eq(connections.id, id)));
        return row;
      },

      async setStatus(
        id: string,
        status: (typeof connections.status.enumValues)[number],
        lastError?: string | null,
      ) {
        const [row] = await db
          .update(connections)
          .set({ status, lastError: lastError ?? null })
          .where(and(eq(connections.orgId, orgId), eq(connections.id, id)))
          .returning();
        return row;
      },

      /**
       * Stamps a successful ingest/poll (ADR 0002, additive): activates the
       * connection, sets last_polled_at/last_success_at, clears last_error.
       * Org-guarded like setStatus — returns undefined for a foreign org.
       */
      async markSynced(id: string) {
        const now = new Date();
        const [row] = await db
          .update(connections)
          .set({
            status: "active",
            lastPolledAt: now,
            lastSuccessAt: now,
            lastError: null,
          })
          .where(and(eq(connections.orgId, orgId), eq(connections.id, id)))
          .returning();
        return row;
      },

      /**
       * Encrypts and stores a credential (upsert per connection+kind).
       * Write-only from the caller's perspective: plaintext goes in, only
       * envelope fields are persisted, nothing is returned.
       */
      async storeCredential(
        connectionId: string,
        kind: (typeof connectionCredentials.kind.enumValues)[number],
        plaintext: string,
        env: CredentialEnv,
        expiresAt?: Date | null,
      ) {
        // Ownership check before the upsert: without it, a conflicting
        // (connection_id, kind) row would let another org's scope
        // overwrite this row's ciphertext (the insert path is FK-guarded,
        // the update path is not).
        const [owned] = await db
          .select({ id: connections.id })
          .from(connections)
          .where(
            and(eq(connections.orgId, orgId), eq(connections.id, connectionId)),
          );
        if (!owned) {
          throw new Error(`connection ${connectionId} not found in org`);
        }
        const encrypted = await encryptCredential(
          env,
          { orgId, connectionId, kind },
          plaintext,
        );
        await db
          .insert(connectionCredentials)
          .values({
            orgId,
            connectionId,
            kind,
            ...encrypted,
            expiresAt: expiresAt ?? null,
          })
          .onConflictDoUpdate({
            target: [
              connectionCredentials.connectionId,
              connectionCredentials.kind,
            ],
            set: {
              ...encrypted,
              expiresAt: expiresAt ?? null,
              rotatedAt: new Date(),
            },
            // Belt-and-braces on top of the ownership check above.
            setWhere: eq(connectionCredentials.orgId, orgId),
          });
      },

      /**
       * Decrypts a credential for the duration of `fn` only — the poller /
       * validate-on-save path. Plaintext never lands on an API response or
       * a returned object; it exists inside the callback scope and is
       * dropped when it resolves.
       */
      async withCredential<T>(
        connectionId: string,
        kind: (typeof connectionCredentials.kind.enumValues)[number],
        env: CredentialEnv,
        fn: (plaintext: string) => Promise<T>,
      ): Promise<T> {
        const [row] = await db
          .select()
          .from(connectionCredentials)
          .where(
            and(
              eq(connectionCredentials.orgId, orgId),
              eq(connectionCredentials.connectionId, connectionId),
              eq(connectionCredentials.kind, kind),
            ),
          );
        if (!row) {
          throw new Error(
            `no ${kind} credential stored for connection ${connectionId}`,
          );
        }
        if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
          throw new Error(
            `${kind} credential for connection ${connectionId} expired at ${row.expiresAt.toISOString()}`,
          );
        }
        const plaintext = await decryptCredential(
          env,
          { orgId, connectionId, kind },
          row,
        );
        // Stamp last_used_at only after fn succeeds — a vendor rejection
        // must not read as "credential last worked at T".
        const result = await fn(plaintext);
        await db
          .update(connectionCredentials)
          .set({ lastUsedAt: new Date() })
          .where(
            and(
              eq(connectionCredentials.id, row.id),
              eq(connectionCredentials.orgId, orgId),
            ),
          );
        return result;
      },

      /**
       * KEK-rotation sweep: rewraps every credential row in this org still
       * wrapped under a non-current KEK (DEK rewrap only — data ciphertext
       * untouched). Returns the number of rows rewrapped. Run per org from
       * the rotation job while CREDENTIAL_KEK_PREVIOUS is still configured.
       */
      async rewrapCredentials(env: CredentialEnv) {
        const target = currentKekVersion(env);
        const rows = await db
          .select()
          .from(connectionCredentials)
          .where(eq(connectionCredentials.orgId, orgId));
        let rewrapped = 0;
        for (const row of rows) {
          if (row.kekVersion === target) {
            continue;
          }
          const updated = await rewrapCredential(
            env,
            { orgId, connectionId: row.connectionId, kind: row.kind },
            row,
          );
          await db
            .update(connectionCredentials)
            .set({
              wrappedDekB64: updated.wrappedDekB64,
              dekIvB64: updated.dekIvB64,
              kekVersion: updated.kekVersion,
              rotatedAt: new Date(),
            })
            .where(
              and(
                eq(connectionCredentials.id, row.id),
                eq(connectionCredentials.orgId, orgId),
              ),
            );
          rewrapped++;
        }
        return rewrapped;
      },
    },

    subjects: {
      /**
       * Idempotent discover() sink: upserts on (connection, kind,
       * external_id), refreshing mutable fields and last_seen_at. The
       * composite (org_id, connection_id) FK rejects cross-org INSERTs, but
       * the ON CONFLICT update path never re-checks the FK — hence the
       * ownership pre-check and the org-guarded setWhere below (same
       * pattern as storeCredential).
       */
      async upsertMany(connectionId: string, descriptors: SubjectDescriptor[]) {
        const [owned] = await db
          .select({ id: connections.id })
          .from(connections)
          .where(
            and(eq(connections.orgId, orgId), eq(connections.id, connectionId)),
          );
        if (!owned) {
          throw new Error(`connection ${connectionId} not found in org`);
        }
        const rows = [];
        for (const d of descriptors) {
          const [row] = await db
            .insert(subjects)
            .values({
              orgId,
              connectionId,
              kind: d.kind,
              externalId: d.externalId,
              email: d.email?.toLowerCase() ?? null,
              displayName: d.displayName ?? null,
              meta: d.meta ?? {},
            })
            .onConflictDoUpdate({
              target: [subjects.connectionId, subjects.kind, subjects.externalId],
              set: {
                email: d.email?.toLowerCase() ?? null,
                displayName: d.displayName ?? null,
                meta: d.meta ?? {},
                lastSeenAt: new Date(),
              },
              // Belt-and-braces on top of the ownership check above.
              setWhere: eq(subjects.orgId, orgId),
            })
            .returning();
          rows.push(row);
        }
        return rows;
      },

      async list(filter?: { connectionId?: string }) {
        const where = filter?.connectionId
          ? and(
              eq(subjects.orgId, orgId),
              eq(subjects.connectionId, filter.connectionId),
            )
          : eq(subjects.orgId, orgId);
        return db
          .select()
          .from(subjects)
          .where(where)
          .orderBy(subjects.firstSeenAt);
      },

      async get(id: string) {
        const [row] = await db
          .select()
          .from(subjects)
          .where(and(eq(subjects.orgId, orgId), eq(subjects.id, id)));
        return row;
      },
    },

    identities: {
      /**
       * Resolves a subject to a person. Many-to-many: a shared account is
       * one subject with N identity rows (§6.2). Cross-org links are
       * rejected by the composite FKs on both sides.
       */
      async link(
        subjectId: string,
        personId: string,
        method: (typeof identities.method.enumValues)[number],
        createdByUserId?: string,
      ) {
        await db
          .insert(identities)
          .values({
            orgId,
            subjectId,
            personId,
            method,
            createdByUserId: createdByUserId ?? null,
          })
          .onConflictDoNothing();
      },

      async unlink(subjectId: string, personId: string) {
        await db
          .delete(identities)
          .where(
            and(
              eq(identities.orgId, orgId),
              eq(identities.subjectId, subjectId),
              eq(identities.personId, personId),
            ),
          );
      },

      async forSubject(subjectId: string) {
        return db
          .select()
          .from(identities)
          .where(
            and(
              eq(identities.orgId, orgId),
              eq(identities.subjectId, subjectId),
            ),
          );
      },

      async forPerson(personId: string) {
        return db
          .select()
          .from(identities)
          .where(
            and(eq(identities.orgId, orgId), eq(identities.personId, personId)),
          );
      },
    },

    metrics: {
      /**
       * The frozen ingestion contract: idempotent upsert on the natural PK
       * (org, subject, metric, day, dim). Every vendor restates recent
       * days, so re-polls always overwrite. org_id is part of the PK, so a
       * cross-org conflict is a different key by construction — no extra
       * update-path guard needed (unlike subjects/credentials, whose
       * conflict keys omit org_id); the insert path is composite-FK-bound.
       */
      async upsertRecords(records: MetricRecordUpsert[]) {
        for (const r of records) {
          await db
            .insert(metricRecords)
            .values({
              orgId,
              subjectId: r.subjectId,
              metricKey: r.metricKey,
              day: r.day,
              dim: r.dim ?? "",
              connectionId: r.connectionId,
              value: r.value,
              attribution: r.attribution,
              sourceConnector: r.sourceConnector,
              rawPayloadId: r.rawPayloadId ?? null,
            })
            .onConflictDoUpdate({
              target: [
                metricRecords.orgId,
                metricRecords.subjectId,
                metricRecords.metricKey,
                metricRecords.day,
                metricRecords.dim,
              ],
              set: {
                value: r.value,
                attribution: r.attribution,
                connectionId: r.connectionId,
                sourceConnector: r.sourceConnector,
                rawPayloadId: r.rawPayloadId ?? null,
                updatedAt: new Date(),
              },
            });
        }
      },

      async upsertSignals(signals: SubjectDaySignalUpsert[]) {
        for (const s of signals) {
          await db
            .insert(subjectDaySignals)
            .values({
              orgId,
              subjectId: s.subjectId,
              day: s.day,
              hours: s.hours ?? null,
              peakConcurrency: s.peakConcurrency ?? null,
              sourceGranularity: s.sourceGranularity,
            })
            .onConflictDoUpdate({
              target: [
                subjectDaySignals.orgId,
                subjectDaySignals.subjectId,
                subjectDaySignals.day,
              ],
              set: {
                hours: s.hours ?? null,
                peakConcurrency: s.peakConcurrency ?? null,
                sourceGranularity: s.sourceGranularity,
                updatedAt: new Date(),
              },
            });
        }
      },

      async records(filter: {
        metricKey: string;
        from: string;
        to: string;
        dim?: string;
      }) {
        const conditions = [
          eq(metricRecords.orgId, orgId),
          eq(metricRecords.metricKey, filter.metricKey),
          gte(metricRecords.day, filter.from),
          lte(metricRecords.day, filter.to),
        ];
        if (filter.dim !== undefined) {
          conditions.push(eq(metricRecords.dim, filter.dim));
        }
        return db
          .select()
          .from(metricRecords)
          .where(and(...conditions))
          .orderBy(metricRecords.day);
      },

      async signals(filter: { subjectId: string; from: string; to: string }) {
        return db
          .select()
          .from(subjectDaySignals)
          .where(
            and(
              eq(subjectDaySignals.orgId, orgId),
              eq(subjectDaySignals.subjectId, filter.subjectId),
              gte(subjectDaySignals.day, filter.from),
              lte(subjectDaySignals.day, filter.to),
            ),
          )
          .orderBy(subjectDaySignals.day);
      },
    },

    raw: {
      /** Lands a fetched vendor payload; returns the row (its id becomes
       * metric_records.raw_payload_id). */
      async insert(input: RawPayloadInsert) {
        const [row] = await db
          .insert(rawPayloads)
          .values({
            orgId,
            connectionId: input.connectionId,
            vendor: input.vendor,
            kind: input.kind,
            windowStart: input.windowStart ?? null,
            windowEnd: input.windowEnd ?? null,
            payload: input.payload,
          })
          .returning();
        return row;
      },

      async get(id: string) {
        const [row] = await db
          .select()
          .from(rawPayloads)
          .where(and(eq(rawPayloads.orgId, orgId), eq(rawPayloads.id, id)));
        return row;
      },
    },

    scores: {
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
    },

    billing: {
      /**
       * The tracked_user billing primitive (frozen; see
       * src/contracts/tracked-user.ts for the definition). Semantics live
       * in the pure countTrackedUsers — this method only supplies the
       * org-scoped inputs, so DB and pure paths cannot diverge.
       */
      async trackedUsers(period: BillingPeriod) {
        const activeSubjectDays = await db
          .selectDistinct({
            subjectId: metricRecords.subjectId,
            day: metricRecords.day,
          })
          .from(metricRecords)
          .where(
            and(
              eq(metricRecords.orgId, orgId),
              gte(metricRecords.day, period.start),
              lte(metricRecords.day, period.end),
            ),
          );
        const identityRows = await db
          .select({
            subjectId: identities.subjectId,
            personId: identities.personId,
          })
          .from(identities)
          .where(eq(identities.orgId, orgId));
        return countTrackedUsers({
          identities: identityRows,
          activeSubjectDays,
          period,
        });
      },
    },

    heartbeats: {
      async record(source = "noop-poller") {
        const [row] = await db
          .insert(pollHeartbeats)
          .values({ orgId, source })
          .returning();
        return row;
      },

      async list(where?: SQL) {
        return db
          .select()
          .from(pollHeartbeats)
          .where(
            where
              ? and(eq(pollHeartbeats.orgId, orgId), where)
              : eq(pollHeartbeats.orgId, orgId),
          )
          .orderBy(pollHeartbeats.observedAt);
      },
    },
  };
}

export type OrgScopedDb = ReturnType<typeof forOrg>;
