import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { orgMembers, user } from "./auth-schema";
import { invites, orgs } from "./schema";

// Invite lifecycle (ADR 0004). Lives in the schema zone beside
// org-scope.ts: creation/list/revoke are org-scoped (admin surface);
// acceptance runs PRE-scope — the accepting user is not a member yet.

const INVITE_TTL_DAYS = 14;

export type InviteRole = "admin" | "member";

export class InviteError extends Error {
  constructor(
    public reason:
      | "invalid"
      | "expired"
      | "revoked"
      | "already_used"
      | "duplicate_pending",
  ) {
    super(`invite ${reason}`);
  }
}

/** Postgres unique-violation, across postgres.js and PGlite drivers.
 * Walks the cause chain: drizzle wraps driver errors (PGlite surfaces
 * the 23505 code on `.cause`, postgres.js on the error itself). */
function isUniqueViolation(error: unknown): boolean {
  for (
    let current = error;
    typeof current === "object" && current !== null;
    current = (current as { cause?: unknown }).cause
  ) {
    if ((current as { code?: string }).code === "23505") {
      return true;
    }
  }
  return false;
}

/** 32 random bytes, base64url — the plaintext exists only in transit. */
export function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Buffer.from(digest).toString("hex");
}

export function invitesForOrg(db: Db, orgId: string) {
  return {
    /**
     * Creates a pending invite and returns the plaintext token exactly
     * once. One live invite per (org, email) — enforced by the partial
     * unique index; a second attempt surfaces as a unique violation.
     */
    async create(email: string, role: InviteRole, invitedByUserId: string) {
      const token = generateInviteToken();
      const tokenHash = await hashInviteToken(token);
      const expiresAt = new Date(
        Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      try {
        const [row] = await db
          .insert(invites)
          .values({
            orgId,
            email: email.toLowerCase(),
            role,
            tokenHash,
            invitedByUserId,
            expiresAt,
          })
          .returning();
        return { invite: row, token };
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new InviteError("duplicate_pending");
        }
        throw error;
      }
    },

    /** Pending invites only — settled (accepted/revoked) rows are history. */
    async listPending() {
      return db
        .select({
          id: invites.id,
          email: invites.email,
          role: invites.role,
          expiresAt: invites.expiresAt,
          createdAt: invites.createdAt,
        })
        .from(invites)
        .where(
          and(
            eq(invites.orgId, orgId),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
          ),
        )
        .orderBy(desc(invites.createdAt));
    },

    /** Revocation is a tombstone, not a delete — the row stays auditable. */
    async revoke(inviteId: string) {
      const [row] = await db
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invites.id, inviteId),
            eq(invites.orgId, orgId),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
          ),
        )
        .returning({ id: invites.id });
      return row !== undefined;
    },
  };
}

/**
 * Redeems an invite token for the signed-in user: creates the org_members
 * row with the invite's role and settles the invite. Token possession
 * suffices (ADR 0004 — email is an addressing hint). Idempotent for the
 * user who already redeemed it.
 */
export async function acceptInvite(
  db: Db,
  token: string,
  userId: string,
): Promise<{ orgId: string; role: InviteRole }> {
  const tokenHash = await hashInviteToken(token);
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash));
  if (!invite) {
    throw new InviteError("invalid");
  }
  if (invite.revokedAt) {
    throw new InviteError("revoked");
  }
  if (invite.acceptedAt) {
    if (invite.acceptedByUserId === userId) {
      return { orgId: invite.orgId, role: invite.role }; // already redeemed by this user
    }
    throw new InviteError("already_used");
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new InviteError("expired");
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(orgMembers)
      .values({ orgId: invite.orgId, userId, role: invite.role })
      .onConflictDoNothing();
    await tx
      .update(invites)
      .set({ acceptedAt: new Date(), acceptedByUserId: userId })
      .where(eq(invites.id, invite.id));
  });
  return { orgId: invite.orgId, role: invite.role };
}

/**
 * Read-only invite preview for the accept page: what the visitor is
 * joining and whether the token is still redeemable. Never returns the
 * token or hash.
 */
export async function previewInvite(db: Db, token: string) {
  const tokenHash = await hashInviteToken(token);
  const [row] = await db
    .select({
      orgName: orgs.name,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      revokedAt: invites.revokedAt,
    })
    .from(invites)
    .innerJoin(orgs, eq(invites.orgId, orgs.id))
    .where(eq(invites.tokenHash, tokenHash));
  if (!row) {
    return { status: "invalid" as const };
  }
  const status = row.revokedAt
    ? ("revoked" as const)
    : row.acceptedAt
      ? ("used" as const)
      : row.expiresAt.getTime() < Date.now()
        ? ("expired" as const)
        : ("valid" as const);
  return { status, orgName: row.orgName, email: row.email, role: row.role };
}

/** Org members with their account identity — the admin Members surface.
 * These are AUTH USERS (dashboard accounts), not §7-protected tracked
 * people; their emails are visible to their own org. */
export async function orgMembersList(db: Db, orgId: string) {
  return db
    .select({
      userId: orgMembers.userId,
      name: user.name,
      email: user.email,
      role: orgMembers.role,
      createdAt: orgMembers.createdAt,
    })
    .from(orgMembers)
    .innerJoin(user, eq(orgMembers.userId, user.id))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(orgMembers.createdAt);
}
