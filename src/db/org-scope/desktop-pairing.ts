import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import { desktopPairingCodes } from "../schema";

export type CreateDesktopPairingInput = {
  pairingId: string;
  codeChallenge: string;
  /** SHA-256 (base64url) of the one-time code — never the code itself. */
  codeHash: string;
  consentedUserId: string;
  deviceDisplayName: string;
  platform: (typeof desktopPairingCodes.platform.enumValues)[number];
  architecture: (typeof desktopPairingCodes.architecture.enumValues)[number];
  agentVersion: string;
  installationId: string;
  expiresAt: Date;
};

// Desktop-agent PKCE pairing codes (T2.2, ADR 0047). Rows are created at
// CONSENT time only (the signed-in approval on /desktop/connect) — the
// unauthenticated start route is stateless, so this namespace never writes
// without a session-derived orgId. The exchange route's pre-auth lookup by
// pairing handle lives in src/db/system.ts (the sanctioned bounded cross-org
// read); every write comes back through here.
export function desktopPairingNamespace(db: Db, orgId: string) {
  return {
    /** Insert the consent-time row. Throws a unique violation if the pairing
     * handle was already consumed (consent-form replay) — callers translate
     * via isUniqueViolation. */
    async create(input: CreateDesktopPairingInput) {
      const [row] = await db
        .insert(desktopPairingCodes)
        .values({ orgId, ...input })
        .returning();
      return row;
    },

    /** Org-scoped read by pairing handle (the tenant-isolation sweep's
     * surface). Returns undefined for a foreign org's handle. */
    async get(pairingId: string) {
      const [row] = await db
        .select()
        .from(desktopPairingCodes)
        .where(
          and(
            eq(desktopPairingCodes.orgId, orgId),
            eq(desktopPairingCodes.pairingId, pairingId),
          ),
        );
      return row;
    },

    /**
     * Single-use claim — the compare-and-set the exchange route runs after
     * verifying code hash + PKCE verifier + expiry (claim-then-mint, same
     * pattern as budget_alert_state.claimThreshold). Stamps used_at ONLY
     * while it is still null; exactly one of two racing exchanges gets
     * `true` back and proceeds to mint the device token. A crash after the
     * claim under-delivers (the user restarts pairing), never double-mints.
     */
    async claimUse(id: string): Promise<boolean> {
      const [row] = await db
        .update(desktopPairingCodes)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(desktopPairingCodes.orgId, orgId),
            eq(desktopPairingCodes.id, id),
            isNull(desktopPairingCodes.usedAt),
          ),
        )
        .returning({ id: desktopPairingCodes.id });
      return row !== undefined;
    },

    /** Stamp the device connection minted by the winning exchange. The
     * composite tenant FK rejects a connection from another org. */
    async setConnection(id: string, connectionId: string) {
      const [row] = await db
        .update(desktopPairingCodes)
        .set({ connectionId })
        .where(
          and(
            eq(desktopPairingCodes.orgId, orgId),
            eq(desktopPairingCodes.id, id),
          ),
        )
        .returning({ id: desktopPairingCodes.id });
      return row;
    },
  };
}
