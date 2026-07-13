import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { budgets } from "../schema";

// Spend Governance (ADR 0020, W4-V). One budget per org — get reads it,
// set upserts it on the org_uq constraint, clear removes it. There is no
// spend ledger here: observed spend is derived from metric_records at read
// time (see src/lib/spend-governance.ts), so this repo only stores config.
export function budgetsNamespace(db: Db, orgId: string) {
  return {
    /** The org's single budget row, or undefined if none is set. */
    async get() {
      const [row] = await db
        .select()
        .from(budgets)
        .where(eq(budgets.orgId, orgId));
      return row;
    },

    /**
     * Sets (creates or replaces) the org's budget. Upserts on the
     * budgets_org_uq (org_id) constraint so a second set() overwrites the
     * limit/thresholds rather than failing — one budget per org by
     * construction. Returns the stored row. `monthlyLimitCents` must be
     * positive (the CHECK rejects otherwise; validated at the API edge too).
     */
    async set(input: { monthlyLimitCents: number; alertThresholds?: number[] }) {
      const [row] = await db
        .insert(budgets)
        .values({
          orgId,
          monthlyLimitCents: input.monthlyLimitCents,
          ...(input.alertThresholds !== undefined
            ? { alertThresholds: input.alertThresholds }
            : {}),
        })
        .onConflictDoUpdate({
          target: budgets.orgId,
          set: {
            monthlyLimitCents: input.monthlyLimitCents,
            ...(input.alertThresholds !== undefined
              ? { alertThresholds: input.alertThresholds }
              : {}),
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    },

    /** Removes the org's budget (governance turned off). Idempotent. */
    async clear() {
      await db.delete(budgets).where(eq(budgets.orgId, orgId));
    },
  };
}
