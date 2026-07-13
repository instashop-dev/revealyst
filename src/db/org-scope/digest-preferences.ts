import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  generateUnsubscribeToken,
  hashUnsubscribeToken,
} from "../digest-preferences";
import { digestPreferences } from "../schema";

// Weekly-digest preferences (F2.2, ADR 0024). One row per (org, user):
// whether this admin/owner receives the weekly digest email, plus the
// send-time idempotency + unsubscribe-token state. The LANE default for an
// ABSENT row (personal owner on, team admin off) lives in the sender
// (src/poller/digest.ts) — this repo only stores explicit rows. Public
// unsubscribe resolution is a capability-token write (resolveDigestUnsubscribe
// in src/db/digest-preferences.ts), not an ambient org-scoped read.
export function digestPreferencesNamespace(db: Db, orgId: string) {
  return {
    /** Every preference row for this org (admin surface + isolation sweep). */
    async list() {
      return db
        .select()
        .from(digestPreferences)
        .where(eq(digestPreferences.orgId, orgId));
    },

    /** This user's preference row for this org, or undefined if none. */
    async getForUser(userId: string) {
      const [row] = await db
        .select()
        .from(digestPreferences)
        .where(
          and(
            eq(digestPreferences.orgId, orgId),
            eq(digestPreferences.userId, userId),
          ),
        );
      return row;
    },

    /**
     * Opt this user in or out (the Settings toggle). Upserts on the
     * (org_id, user_id) constraint so a second call flips the flag rather
     * than failing — one row per person per org by construction. Returns the
     * stored row. The unsubscribe token is minted lazily at send time, not
     * here, so opting in never leaks a live token into the DB before it's
     * ever emailed.
     */
    async setEnabled(userId: string, enabled: boolean) {
      const [row] = await db
        .insert(digestPreferences)
        .values({ orgId, userId, digestEnabled: enabled })
        .onConflictDoUpdate({
          target: [digestPreferences.orgId, digestPreferences.userId],
          set: { digestEnabled: enabled, updatedAt: new Date() },
        })
        .returning();
      return row;
    },

    /**
     * Send-time idempotency + token rotation, as one atomic compare-and-set
     * (the metering pattern): claims `week` for this user by writing it and a
     * freshly-minted unsubscribe-token hash — but ONLY when the row is
     * enabled AND `last_sent_week` is not already `week`. Returns the new
     * plaintext token (for this email's one-click link) when the claim won,
     * or `null` when it lost — i.e. an at-least-once redelivery for the same
     * week, or a row that's disabled/absent. Because the claim precedes the
     * actual `sendEmail`, a crash mid-send under-delivers (safe) rather than
     * double-sending. The token is rotated on every real send, so only the
     * most recent email's unsubscribe link stays live.
     */
    async claimWeekAndRotateToken(userId: string, week: string) {
      const token = generateUnsubscribeToken();
      const tokenHash = await hashUnsubscribeToken(token);
      const [row] = await db
        .update(digestPreferences)
        .set({
          lastSentWeek: week,
          unsubscribeTokenHash: tokenHash,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(digestPreferences.orgId, orgId),
            eq(digestPreferences.userId, userId),
            eq(digestPreferences.digestEnabled, true),
            sql`${digestPreferences.lastSentWeek} is distinct from ${week}`,
          ),
        )
        .returning({ id: digestPreferences.id });
      return row ? { token } : null;
    },
  };
}
