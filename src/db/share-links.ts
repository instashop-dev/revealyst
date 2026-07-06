import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { shareLinks } from "./schema";

// Opt-in public score-card links (ADR 0008). Lives in the schema zone beside
// org-scope.ts: create/list/revoke are org-scoped (the owner's surface);
// resolution runs PRE-scope — the public viewer has no session. The plaintext
// token exists only in the share URL; we store its SHA-256 hash (like invites).

/** 32 random bytes, base64url — the plaintext exists only in the share URL. */
export function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Buffer.from(digest).toString("hex");
}

export type CreateShareLinkInput = {
  personId: string;
  scoreSlug: string;
  publicLabel: string;
  createdByUserId?: string | null;
};

export function shareLinksForOrg(db: Db, orgId: string) {
  return {
    /**
     * Mints an opt-in public link and returns the plaintext token once. The
     * composite (org_id, person_id) FK rejects a cross-org person.
     */
    async create(input: CreateShareLinkInput) {
      const token = generateShareToken();
      const tokenHash = await hashShareToken(token);
      const [row] = await db
        .insert(shareLinks)
        .values({
          orgId,
          personId: input.personId,
          scoreSlug: input.scoreSlug,
          publicLabel: input.publicLabel,
          tokenHash,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      return { link: row, token };
    },

    /** Active (non-revoked) links for this org. */
    async list() {
      return db
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.orgId, orgId), isNull(shareLinks.revokedAt)))
        .orderBy(desc(shareLinks.createdAt));
    },

    /** Revocation is a tombstone — the row stays auditable, the URL 404s. */
    async revoke(id: string) {
      const [row] = await db
        .update(shareLinks)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(shareLinks.id, id),
            eq(shareLinks.orgId, orgId),
            isNull(shareLinks.revokedAt),
          ),
        )
        .returning({ id: shareLinks.id });
      return row !== undefined;
    },
  };
}

/**
 * Resolves a public share token to the minimal projection its holder is
 * entitled to (ADR 0008): the org + person + featured slug + the user-chosen
 * public label — NEVER email, other people, or org data. Global read (no
 * session), gated by the unguessable token AND revoked_at IS NULL. The caller
 * then reads that person's featured score via forOrg(orgId) — the token is the
 * capability that authorizes exactly that read.
 */
export async function resolveShareToken(db: Db, token: string) {
  const tokenHash = await hashShareToken(token);
  const [row] = await db
    .select({
      orgId: shareLinks.orgId,
      personId: shareLinks.personId,
      scoreSlug: shareLinks.scoreSlug,
      publicLabel: shareLinks.publicLabel,
      revokedAt: shareLinks.revokedAt,
    })
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, tokenHash));
  if (!row || row.revokedAt) {
    return null;
  }
  return {
    orgId: row.orgId,
    personId: row.personId,
    scoreSlug: row.scoreSlug,
    publicLabel: row.publicLabel,
  };
}
