import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import type { RecInteractionStateValue } from "../../lib/rec-interactions";
import { people, recInteractionState } from "../schema";

// Recommendation interaction state (W5-D, ADR 0028) — the Outcomes-loop
// forerunner (§8.3). One row per (org, person, rec): how a person acted on a
// coaching recommendation. SELF-VIEW ONLY by construction — every method is
// org-scoped, and the manager-facing surfaces never call this namespace. The
// API route additionally proves the acting user OWNS the personId (people
// .authUserId === session user) before writing, so a manager cannot set (or
// by omission read) another person's state.
export function recInteractionsNamespace(db: Db, orgId: string) {
  return {
    /** Every interaction row this person has, within this org. The isolation
     * sweep's read surface; also reusable by a per-person read. */
    async list(personId: string) {
      return db
        .select()
        .from(recInteractionState)
        .where(
          and(
            eq(recInteractionState.orgId, orgId),
            eq(recInteractionState.personId, personId),
          ),
        );
    },

    /**
     * The interaction rows for the person LINKED to `authUserId` in this org
     * (people.auth_user_id) — the companion self-view fold-in. Resolving the
     * person by auth user inside the query keeps this a single round-trip that
     * folds into the dashboard's existing flat Promise.all (G10), and makes it
     * structurally self-view: it can only ever return the caller's OWN states.
     * Empty when no person is linked to the user yet.
     */
    async statesForUser(authUserId: string) {
      return db
        .select({
          recId: recInteractionState.recId,
          state: recInteractionState.state,
          snoozeUntil: recInteractionState.snoozeUntil,
        })
        .from(recInteractionState)
        .innerJoin(
          people,
          and(
            eq(people.orgId, recInteractionState.orgId),
            eq(people.id, recInteractionState.personId),
          ),
        )
        .where(
          and(
            eq(recInteractionState.orgId, orgId),
            eq(people.authUserId, authUserId),
          ),
        );
    },

    /**
     * The distinct rec_ids DISMISSED by anyone in this org. Used ONLY by the
     * weekly digest's personal lane (org-of-one, so this is exactly the single
     * owner's dismissals) to honour "a dismissed rec never re-mails". Returns
     * anonymous rec-id STRINGS — never a person id or count — so it carries no
     * identity even in a multi-person org, and it is never reachable from a
     * manager-facing surface.
     */
    async dismissedRecIdsForOrg(): Promise<string[]> {
      const rows = await db
        .selectDistinct({ recId: recInteractionState.recId })
        .from(recInteractionState)
        .where(
          and(
            eq(recInteractionState.orgId, orgId),
            eq(recInteractionState.state, "dismissed"),
          ),
        );
      return rows.map((r) => r.recId);
    },

    /**
     * Upsert this person's state for one recommendation on the
     * (org_id, person_id, rec_id) key — a second `set` overwrites rather than
     * failing, so a person holds at most one state per rec. `snoozeUntil` is
     * stored only for a snooze (null'd out on dismiss/tried so a stale expiry
     * can't leak across a state change). The composite tenant FK rejects a
     * personId from another org. Returns the stored row.
     */
    async set(input: {
      personId: string;
      recId: string;
      state: RecInteractionStateValue;
      snoozeUntil?: Date | null;
    }) {
      const snoozeUntil =
        input.state === "snoozed" ? (input.snoozeUntil ?? null) : null;
      const [row] = await db
        .insert(recInteractionState)
        .values({
          orgId,
          personId: input.personId,
          recId: input.recId,
          state: input.state,
          actedAt: new Date(),
          snoozeUntil,
        })
        .onConflictDoUpdate({
          target: [
            recInteractionState.orgId,
            recInteractionState.personId,
            recInteractionState.recId,
          ],
          set: {
            state: input.state,
            actedAt: new Date(),
            snoozeUntil,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    },

    /**
     * Delete this person's state row for one recommendation (ADR 0043) — the
     * `cleared` API action behind the coaching card's undo toast. After it the
     * person's state is literal ABSENCE (as if never interacted), which is the
     * only honest restore for a snooze/dismiss taken on a never-touched rec —
     * re-writing `tried` would fabricate feedback the person never gave and
     * bias the fatigue ranking. Idempotent: deleting an absent row is a no-op.
     * Org-scoped like every sibling; the route proves self-view ownership
     * before calling, exactly as it does for `set`.
     */
    async clear(input: { personId: string; recId: string }) {
      await db
        .delete(recInteractionState)
        .where(
          and(
            eq(recInteractionState.orgId, orgId),
            eq(recInteractionState.personId, input.personId),
            eq(recInteractionState.recId, input.recId),
          ),
        );
    },
  };
}
