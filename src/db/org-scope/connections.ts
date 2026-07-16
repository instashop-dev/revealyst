import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import {
  currentKekVersion,
  decryptCredential,
  encryptCredential,
  rewrapCredential,
  type CredentialEnv,
} from "../../lib/credentials";
import type { Db } from "../client";
import { connectionCredentials, connections, metricRecords } from "../schema";

export type CreateConnectionInput = {
  vendor: string;
  displayName: string;
  authKind: (typeof connections.authKind.enumValues)[number];
  config?: Record<string, unknown>;
};

export function connectionsNamespace(db: Db, orgId: string) {
  return {
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
      patch: {
        displayName?: string;
        status?: "active" | "paused";
        renewalDate?: string | null;
      },
    ) {
      const set: Partial<{
        displayName: string;
        status: "active" | "paused" | SQL;
        renewalDate: string | null;
      }> = {};
      if (patch.displayName !== undefined) set.displayName = patch.displayName;
      if (patch.status === "paused") set.status = "paused";
      if (patch.status === "active") {
        set.status = sql`CASE WHEN ${connections.lastSuccessAt} IS NULL THEN 'pending' ELSE 'active' END`;
      }
      // W6-G: the USER-ENTERED renewal date; null clears it, undefined leaves
      // it untouched (a rename/pause never wipes it).
      if (patch.renewalDate !== undefined) set.renewalDate = patch.renewalDate;
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
     * Records a desktop-agent heartbeat (Desktop Agent plan T2.4, ADR 0048).
     * A heartbeat is a lightweight liveness ping — NOT a data sync — so it is
     * deliberately kept OFF the poll timestamps (`last_polled_at` /
     * `last_success_at`, owned by markPolled/markSynced): conflating the two
     * would make "last heartbeat" and "last successful sync" indistinguishable
     * in the UI. Instead it merges three COUNT-ONLY fields into the existing
     * `config` jsonb — `lastHeartbeatAt` (ISO), the refreshed `agentVersion`
     * (the agent may have self-updated since pairing), and `queueDepth` (a
     * diagnostic count, never content). The jsonb `||` shallow-merge preserves
     * the pairing-time keys (platform, installationId, pairedByUserId). No
     * schema change (no migration/new column) — the config column already
     * exists. Org-guarded and never touches a paused connection (a revoked
     * device's heartbeat is already rejected 403/401 at the verifier; this
     * `ne(paused)` guard is belt-and-braces, matching markPolled/markSynced).
     * Returns undefined for a foreign org, unknown id, or paused connection.
     */
    async recordDeviceHeartbeat(
      id: string,
      input: { agentVersion: string; queueDepth: number; now?: Date },
    ) {
      // Only the three heartbeat fields are patched. A JSON string parameter
      // cast to jsonb — no bare JS Date crosses the sql boundary (that 500s on
      // postgres.js/Hyperdrive); the timestamp rides as an ISO string INSIDE
      // the JSON, so it stays a plain text→jsonb cast.
      const patch = JSON.stringify({
        agentVersion: input.agentVersion,
        queueDepth: input.queueDepth,
        lastHeartbeatAt: (input.now ?? new Date()).toISOString(),
      });
      const [row] = await db
        .update(connections)
        .set({ config: sql`${connections.config} || ${patch}::jsonb` })
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
     * Deletes a stored credential (Desktop Agent plan T2.4, ADR 0048) — the
     * device-revoke path. Revoking a desktop device pauses its connection AND
     * destroys its `device_token` credential so the token can never
     * re-authenticate (a clean-slate revocation: re-enrolling requires a fresh
     * pairing, not an un-pause). Org-guarded on the credential's own `org_id`
     * so one org's scope can never delete another's row. Idempotent — deleting
     * an already-gone credential is a no-op (matches nothing). Nothing is
     * returned (write-only, like storeCredential).
     */
    async deleteCredential(
      connectionId: string,
      kind: (typeof connectionCredentials.kind.enumValues)[number],
    ) {
      await db
        .delete(connectionCredentials)
        .where(
          and(
            eq(connectionCredentials.orgId, orgId),
            eq(connectionCredentials.connectionId, connectionId),
            eq(connectionCredentials.kind, kind),
          ),
        );
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
  };
}
