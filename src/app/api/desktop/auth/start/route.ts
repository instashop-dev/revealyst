import {
  desktopPairingStartSchema,
  startDesktopPairing,
} from "@/lib/desktop-pairing";

// POST /api/desktop/auth/start (Desktop Agent T2.2, ADR 0047) — the desktop
// agent begins PKCE pairing. Unauthenticated by design (the human
// authenticates in the browser at the consent step) and STATELESS: nothing
// is written — an org-scoped pairing row cannot exist before a user
// consents, so this route only validates the payload shape, mints the
// random 128-bit pairing handle, and returns the browser URL the agent
// opens. Because it holds no state, an unauthenticated caller cannot use it
// to write anything at all. Non-frozen route: schema colocated in
// src/lib/desktop-pairing.ts (the /v1/* receiver convention), not apiRoutes.

// Pairing payloads are tiny; the cap exists because every unauthenticated
// JSON route carries one (the agent-ingest / /v1/* sibling guard).
const MAX_BODY_BYTES = 64_000;

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = desktopPairingStartSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const started = startDesktopPairing(parsed.data, new URL(req.url).origin);
  return Response.json(started);
}
