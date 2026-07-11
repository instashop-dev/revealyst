import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { digestPreferences } from "./schema";

// Weekly-digest unsubscribe tokens (F2.2, ADR 0024). Mirrors src/db/share-links.ts:
// the plaintext token exists only inside the email's one-click unsubscribe URL;
// we persist only its SHA-256 hash. Resolution runs PRE-scope — the recipient
// clicking Unsubscribe has no session — and the org is derived FROM THE TOKEN
// ROW, never the request. The org-scoped read/write surface (opt-in toggle,
// send-time claim) lives in forOrg (src/db/org-scope.ts, `digestPreferences`).

/** 32 random bytes, base64url — the plaintext exists only in the email URL. */
export function generateUnsubscribeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

export async function hashUnsubscribeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Buffer.from(digest).toString("hex");
}

/**
 * Resolves a one-click unsubscribe token to its preference row and turns the
 * digest OFF for that person. Global read+write (no session), gated solely by
 * the unguessable token: the org and user are read from the matched row, never
 * from the request, so a token holder can only ever unsubscribe the exact
 * (org, user) the token was minted for. Idempotent — a token that resolves to
 * an already-disabled row still returns `true` (the desired end state holds),
 * and an unknown/rotated token returns `false`. The row is left in place (its
 * `digest_enabled = false` is the durable "unsubscribed" state the sender
 * honors) rather than deleted, so the person's choice survives a later send.
 */
export async function resolveDigestUnsubscribe(
  db: Db,
  token: string,
): Promise<boolean> {
  const tokenHash = await hashUnsubscribeToken(token);
  const [row] = await db
    .update(digestPreferences)
    .set({ digestEnabled: false, updatedAt: new Date() })
    .where(eq(digestPreferences.unsubscribeTokenHash, tokenHash))
    .returning({ id: digestPreferences.id });
  return row !== undefined;
}
