import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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
  auditLog,
  connectionCredentials,
  connections,
  connectorRuns,
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

      /**
       * Like markPolled/markSynced, a paused connection is never touched
       * (pause always sticks, ADR 0003; guard added by ADR 0013 — its one
       * caller is credential validate-on-save, whose "error" write would
       * otherwise make a paused connection a dispatch candidate again).
       * Explicit un-pausing goes through `update({ status })`.
       */
      async setStatus(
        id: string,
        status: (typeof connections.status.enumValues)[number],
        lastError?: string | null,
      ) {
        const [row] = await db
          .update(connections)
          .set({ status, lastError: lastError ?? null })
          .where(
            and(
              eq(connections.orgId, orgId),
              eq(connections.id, id),
              ne(connections.status, "paused"),
            ),
          )
          .returning();
        return row;
      },

      /**
       * Partial update for the ADR 0013 PATCH: touches ONLY the requested
       * fields. Deliberately NOT setStatus — setStatus always overwrites
       * lastError (nulls it unless passed), so pausing an errored connection
       * through it would erase the honest error message. Resume leaves
       * lastError alone too (the next successful poll clears it via
       * markPolled), and a never-synced connection resumes to "pending", not
       * "active" — status never claims a health the connection hasn't
       * demonstrated (invariant b). Empty patches are rejected upstream by
       * the frozen contract; throwing here keeps the writer a writer.
       * Returns undefined for an unknown id or a foreign org.
       */
      async update(
        id: string,
        patch: { displayName?: string; status?: "active" | "paused" },
      ) {
        const set: Partial<{
          displayName: string;
          status: "active" | "paused" | SQL;
        }> = {};
        if (patch.displayName !== undefined) set.displayName = patch.displayName;
        if (patch.status === "paused") set.status = "paused";
        if (patch.status === "active") {
          set.status = sql`CASE WHEN ${connections.lastSuccessAt} IS NULL THEN 'pending' ELSE 'active' END`;
        }
        if (Object.keys(set).length === 0) {
          throw new Error("connections.update requires at least one field");
        }
        const [row] = await db
          .update(connections)
          .set(set)
          .where(and(eq(connections.orgId, orgId), eq(connections.id, id)))
          .returning();
        return row;
      },

      /**
       * Deletes a connection (ADR 0013) and, explicitly first, its ingested
       * metric_records — the NO ACTION metric_records_org_connection_fk
       * blocks the connection delete while any record references it (the
       * subjects cascade does NOT satisfy it: the RI check fires against
       * rows the nested cascade hasn't removed). The remaining graph
       * (credentials, subjects + their records, raw payloads, connector
       * runs) goes via the frozen cascades, all inside one transaction.
       * Stale score results reconcile at the next recompute (ADR 0012).
       * Returns the deleted id, undefined for unknown/foreign.
       */
      async delete(id: string) {
        return db.transaction(async (tx) => {
          // Existence check first: the records delete below scans the org's
          // metric_records (no connection_id-leading index) — don't pay that
          // for an unknown/foreign id.
          const [owned] = await tx
            .select({ id: connections.id })
            .from(connections)
            .where(and(eq(connections.orgId, orgId), eq(connections.id, id)));
          if (!owned) return undefined;
          await tx
            .delete(metricRecords)
            .where(
              and(
                eq(metricRecords.orgId, orgId),
                eq(metricRecords.connectionId, id),
              ),
            );
          const [row] = await tx
            .delete(connections)
            .where(and(eq(connections.orgId, orgId), eq(connections.id, id)))
            .returning({ id: connections.id });
          return row;
        });
      },

      /**
       * Stamps poll bookkeeping after a run (ADR 0005, hardened in 0006).
       * Success reactivates an errored connection (transient vendor outages
       * self-heal via dispatch, which keeps polling errored connections); a
       * PERMANENT failure lands status "error" + the message the UI shows;
       * a TRANSIENT failure only stamps last_polled_at, so the dispatcher
       * stops enqueueing duplicates while the queue message backs off.
       * A paused connection is never touched: pausing mid-run must stick
       * (the run raced the pause; its bookkeeping loses).
       */
      async markPolled(
        id: string,
        outcome:
          | { ok: true }
          | { ok: false; error: string; transient?: boolean },
      ) {
        const now = new Date();
        const [row] = await db
          .update(connections)
          .set(
            outcome.ok
              ? {
                  lastPolledAt: now,
                  lastSuccessAt: now,
                  status: "active",
                  lastError: null,
                }
              : outcome.transient
                ? { lastPolledAt: now }
                : {
                    lastPolledAt: now,
                    status: "error",
                    lastError: outcome.error,
                  },
          )
          .where(
            and(
              eq(connections.orgId, orgId),
              eq(connections.id, id),
              ne(connections.status, "paused"),
            ),
          )
          .returning();
        return row;
      },

      /**
       * Stamps a successful ingest/poll (ADR 0002, additive): activates the
       * connection, sets last_polled_at/last_success_at, clears last_error.
       * Org-guarded like setStatus — returns undefined for a foreign org or
       * a paused connection (a pause always sticks, ADR 0003).
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
          .where(
            and(
              eq(connections.orgId, orgId),
              eq(connections.id, id),
              ne(connections.status, "paused"),
            ),
          )
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

    connectorRuns: {
      /**
       * Opens a run row (status "running") before any vendor I/O, so a
       * consumer killed mid-run leaves visible evidence. The composite
       * (org_id, connection_id) FK rejects cross-org connections.
       */
      async start(input: {
        connectionId: string;
        kind: (typeof connectorRuns.kind.enumValues)[number];
        windowStart?: string | null;
        windowEnd?: string | null;
        attempt?: number;
      }) {
        const [row] = await db
          .insert(connectorRuns)
          .values({
            orgId,
            connectionId: input.connectionId,
            kind: input.kind,
            windowStart: input.windowStart ?? null,
            windowEnd: input.windowEnd ?? null,
            attempt: input.attempt ?? 1,
          })
          .returning();
        return row;
      },

      async finish(
        id: string,
        result: {
          subjectsSeen: number;
          recordsUpserted: number;
          signalsUpserted: number;
          gaps: unknown[];
        },
      ) {
        const [row] = await db
          .update(connectorRuns)
          .set({
            status: "success",
            subjectsSeen: result.subjectsSeen,
            recordsUpserted: result.recordsUpserted,
            signalsUpserted: result.signalsUpserted,
            gaps: result.gaps,
            finishedAt: new Date(),
          })
          .where(and(eq(connectorRuns.orgId, orgId), eq(connectorRuns.id, id)))
          .returning();
        return row;
      },

      async fail(id: string, error: string) {
        const [row] = await db
          .update(connectorRuns)
          .set({ status: "error", error, finishedAt: new Date() })
          .where(and(eq(connectorRuns.orgId, orgId), eq(connectorRuns.id, id)))
          .returning();
        return row;
      },

      async list(filter?: { connectionId?: string; limit?: number }) {
        const where = filter?.connectionId
          ? and(
              eq(connectorRuns.orgId, orgId),
              eq(connectorRuns.connectionId, filter.connectionId),
            )
          : eq(connectorRuns.orgId, orgId);
        return db
          .select()
          .from(connectorRuns)
          .where(where)
          .orderBy(desc(connectorRuns.startedAt))
          .limit(filter?.limit ?? 100);
      },

      /** Latest run for a connection — the "last synced 2h ago" query. */
      async latest(connectionId: string) {
        const [row] = await db
          .select()
          .from(connectorRuns)
          .where(
            and(
              eq(connectorRuns.orgId, orgId),
              eq(connectorRuns.connectionId, connectionId),
            ),
          )
          .orderBy(desc(connectorRuns.startedAt))
          .limit(1);
        return row;
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
        // Batched multi-row upsert (ADR 0003): one round-trip per ~500
        // descriptors instead of one per row — backfill chunks feed this
        // whole-org member lists. Dedupe on the conflict key first: one
        // INSERT may not touch the same row twice ("cannot affect row a
        // second time"); the last descriptor wins, matching the old
        // sequential-loop semantics.
        const byConflictKey = new Map<string, SubjectDescriptor>();
        for (const d of descriptors) {
          byConflictKey.set(`${d.kind}:${d.externalId}`, d);
        }
        const rows = [];
        const deduped = [...byConflictKey.values()];
        const BATCH = 500;
        for (let i = 0; i < deduped.length; i += BATCH) {
          const slice = deduped.slice(i, i + BATCH);
          const inserted = await db
            .insert(subjects)
            .values(
              slice.map((d) => ({
                orgId,
                connectionId,
                kind: d.kind,
                externalId: d.externalId,
                email: d.email?.toLowerCase() ?? null,
                displayName: d.displayName ?? null,
                meta: d.meta ?? {},
              })),
            )
            .onConflictDoUpdate({
              target: [subjects.connectionId, subjects.kind, subjects.externalId],
              set: {
                email: sql`excluded.email`,
                displayName: sql`excluded.display_name`,
                meta: sql`excluded.meta`,
                lastSeenAt: new Date(),
              },
              // Belt-and-braces on top of the ownership check above.
              setWhere: eq(subjects.orgId, orgId),
            })
            .returning();
          rows.push(...inserted);
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
        // Batched multi-row upsert (ADR 0003): a backfill chunk carries
        // thousands of rows; per-row round-trips over Hyperdrive were the
        // unmodeled half of the queue wall-time budget. Dedupe on the PK
        // (one INSERT may not touch a row twice); last entry wins — the
        // sequential loop's restatement semantics.
        const byPk = new Map<string, MetricRecordUpsert>();
        for (const r of records) {
          byPk.set(
            `${r.subjectId}|${r.metricKey}|${r.day}|${r.dim ?? ""}`,
            r,
          );
        }
        const deduped = [...byPk.values()];
        const BATCH = 500;
        for (let i = 0; i < deduped.length; i += BATCH) {
          await db
            .insert(metricRecords)
            .values(
              deduped.slice(i, i + BATCH).map((r) => ({
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
              })),
            )
            .onConflictDoUpdate({
              target: [
                metricRecords.orgId,
                metricRecords.subjectId,
                metricRecords.metricKey,
                metricRecords.day,
                metricRecords.dim,
              ],
              set: {
                value: sql`excluded.value`,
                attribution: sql`excluded.attribution`,
                connectionId: sql`excluded.connection_id`,
                sourceConnector: sql`excluded.source_connector`,
                rawPayloadId: sql`excluded.raw_payload_id`,
                updatedAt: new Date(),
              },
            });
        }
      },

      /**
       * Makes a re-push authoritative for its window (ADR 0002, additive):
       * deletes this connection's records — and its subjects' signals —
       * inside the inclusive day window, so stale natural keys (e.g. a
       * model dim that disappeared from a corrected batch) cannot survive
       * a restatement. Other connections' rows are untouched.
       */
      async deleteWindowForConnection(
        connectionId: string,
        from: string,
        to: string,
      ) {
        await db
          .delete(metricRecords)
          .where(
            and(
              eq(metricRecords.orgId, orgId),
              eq(metricRecords.connectionId, connectionId),
              gte(metricRecords.day, from),
              lte(metricRecords.day, to),
            ),
          );
        const subjectRows = await db
          .select({ id: subjects.id })
          .from(subjects)
          .where(
            and(
              eq(subjects.orgId, orgId),
              eq(subjects.connectionId, connectionId),
            ),
          );
        const subjectIds = subjectRows.map((s) => s.id);
        if (subjectIds.length > 0) {
          await db
            .delete(subjectDaySignals)
            .where(
              and(
                eq(subjectDaySignals.orgId, orgId),
                inArray(subjectDaySignals.subjectId, subjectIds),
                gte(subjectDaySignals.day, from),
                lte(subjectDaySignals.day, to),
              ),
            );
        }
      },

      async upsertSignals(signals: SubjectDaySignalUpsert[]) {
        // Batched like upsertRecords (ADR 0003); PK is (subject, day).
        const byPk = new Map<string, SubjectDaySignalUpsert>();
        for (const s of signals) {
          byPk.set(`${s.subjectId}|${s.day}`, s);
        }
        const deduped = [...byPk.values()];
        const BATCH = 500;
        for (let i = 0; i < deduped.length; i += BATCH) {
          await db
            .insert(subjectDaySignals)
            .values(
              deduped.slice(i, i + BATCH).map((s) => ({
                orgId,
                subjectId: s.subjectId,
                day: s.day,
                hours: s.hours ?? null,
                peakConcurrency: s.peakConcurrency ?? null,
                sourceGranularity: s.sourceGranularity,
              })),
            )
            .onConflictDoUpdate({
              target: [
                subjectDaySignals.orgId,
                subjectDaySignals.subjectId,
                subjectDaySignals.day,
              ],
              set: {
                hours: sql`excluded.hours`,
                peakConcurrency: sql`excluded.peak_concurrency`,
                sourceGranularity: sql`excluded.source_granularity`,
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

    // Append-only accountability trail (ADR 0010): record + list only — no
    // update, no delete. metadata must stay small and non-sensitive (ids and
    // short labels; never credentials, tokens, or vendor payloads).
    auditLog: {
      async record(input: {
        /** Null only when the caller genuinely has no session user. */
        actorUserId: string | null;
        action: string;
        targetKind: string;
        targetId?: string | null;
        metadata?: Record<string, unknown>;
      }) {
        const [row] = await db
          .insert(auditLog)
          .values({
            orgId,
            actorUserId: input.actorUserId,
            action: input.action,
            targetKind: input.targetKind,
            targetId: input.targetId ?? null,
            metadata: input.metadata ?? {},
          })
          .returning();
        return row;
      },

      /**
       * Newest-first page. Cursor = the LAST entry of the previous page:
       * pass its (createdAt, id) as (before, beforeId) — exclusive compound
       * cursor, so pages never repeat the boundary row and never loop when
       * many rows share a timestamp (e.g. a batch action in one tx, where
       * now() ties exactly). `before` alone (no beforeId) is exclusive on
       * createdAt and can skip same-timestamp rows — always pass both when
       * walking pages.
       */
      async list(filter?: { limit?: number; before?: Date; beforeId?: string }) {
        const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
        const cursor = filter?.before
          ? filter.beforeId
            ? or(
                lt(auditLog.createdAt, filter.before),
                and(
                  eq(auditLog.createdAt, filter.before),
                  lt(auditLog.id, filter.beforeId),
                ),
              )
            : lt(auditLog.createdAt, filter.before)
          : undefined;
        return db
          .select()
          .from(auditLog)
          .where(
            cursor ? and(eq(auditLog.orgId, orgId), cursor) : eq(auditLog.orgId, orgId),
          )
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(limit);
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
