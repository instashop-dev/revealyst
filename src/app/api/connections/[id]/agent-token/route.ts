import { composeAgentToken, generateAgentSecret } from "@/lib/agent-token";
import { getApiContext } from "@/lib/api-context";
import { getAuth } from "@/lib/auth";
import { forOrg, membershipForUser } from "@/db/org-scope";

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

  return Response.json({
    token: composeAgentToken(membership.orgId, id, secret),
  });
}
