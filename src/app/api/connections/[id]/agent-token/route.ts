import { composeAgentToken, generateAgentSecret } from "@/lib/agent-token";
import { getApiContext } from "@/lib/api-context";
import { getAuth } from "@/lib/auth";
import { APP_ORIGIN } from "@/lib/domains";
import { forOrg, membershipForUser } from "@/db/org-scope";

/** Same-origin? Compares the Origin header's host to the request's own host —
 * a cross-site forgery never matches, while localhost dev and CI preview
 * versions (where both hosts agree) pass. Malformed origins return false. */
function isSameOrigin(origin: string, requestUrl: string): boolean {
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

// POST /api/connections/:id/agent-token (ADR 0002) — session-authed device
// pairing. Generates a fresh secret, stores it as the connection's
// device_token credential (encrypted envelope; upsert = re-issuing rotates
// the previous token), and returns the composed token ONCE. It is never
// readable again.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // CSRF (plan §7.3 / A7): this session-cookie-authed route rotates the
  // connection's device token, so a forged cross-origin POST could brick a
  // victim's agent (the old token stops working the instant a new one mints).
  // Better Auth's SameSite/trustedOrigins CSRF cover applies to /api/auth/*,
  // not this custom route — so reject a PRESENT, mismatched Origin explicitly.
  // A missing Origin passes through (server-side/native callers; the agent
  // itself never hits this route). Same-origin is always safe (CSRF is
  // inherently cross-origin), which keeps dev/preview hosts working.
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== APP_ORIGIN && !isSameOrigin(origin, req.url)) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }

  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { db, env } = getApiContext();
  const membership = await membershipForUser(db, session.user.id);
  if (!membership) {
    return Response.json({ error: "no org membership" }, { status: 403 });
  }

  const scoped = forOrg(db, membership.orgId);
  const connection = await scoped.connections.get(id);
  if (!connection) {
    return Response.json({ error: "connection not found" }, { status: 404 });
  }
  if (connection.authKind !== "device_token") {
    return Response.json(
      { error: "connection does not use device-token auth" },
      { status: 400 },
    );
  }

  const secret = generateAgentSecret();
  await scoped.connections.storeCredential(id, "device_token", secret, env);
  // Audit the (re-)issue — never the secret itself (ADR 0010). BEST-EFFORT,
  // unlike the other audited routes: the rotation already invalidated the
  // old token, and the new one is readable ONLY from this response — a
  // transient audit-insert failure must not turn into a 500 that destroys
  // the one-time token and bricks the agent. The failure still lands in
  // Workers Logs (observability) via console.error.
  await scoped.auditLog
    .record({
      actorUserId: session.user.id,
      action: "connection.issue_agent_token",
      targetKind: "connection",
      targetId: id,
    })
    .catch((error) => {
      console.error(
        `[audit] connection.issue_agent_token write failed for ${id}:`,
        error,
      );
    });

  return Response.json({
    token: composeAgentToken(membership.orgId, id, secret),
  });
}
