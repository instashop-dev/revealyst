import { orgContextForUser } from "@/db/org-context";
import { forOrg } from "@/db/org-scope";
import { getApiContext } from "@/lib/api-context";
import { getAuth } from "@/lib/auth";
import {
  consentDesktopPairing,
  desktopConnectPayloadSchema,
} from "@/lib/desktop-pairing";
import { APP_ORIGIN } from "@/lib/domains";

// POST /api/desktop/auth/consent (Desktop Agent T2.2, ADR 0047) — the
// session-authed approval behind the /desktop/connect page's form. Creates
// the org-scoped pairing row bound to the SESSION user (no parameter can
// name anyone else — self-owned minting is structural) and 303-redirects the
// browser to revealyst://desktop-auth/callback with the one-time code.
// Failures redirect back to the page with a plain-English error state.
// D-DA-2: Personal orgs only — enforced here AND on the page.

/** Same-origin check, mirrored from the agent-token route: this
 * session-cookie-authed POST mints a pairing code, so a forged cross-origin
 * form must be rejected. A missing Origin passes (non-browser callers);
 * same-origin is inherently CSRF-safe. */
function isSameOrigin(origin: string, requestUrl: string): boolean {
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

function backToConnect(req: Request, error: string): Response {
  return Response.redirect(
    new URL(`/desktop/connect?error=${error}`, req.url).toString(),
    303,
  );
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== APP_ORIGIN && !isSameOrigin(origin, req.url)) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }

  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) {
    return Response.redirect(new URL("/sign-in", req.url).toString(), 303);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return backToConnect(req, "invalid");
  }
  const parsed = desktopConnectPayloadSchema.safeParse(
    Object.fromEntries(form.entries()),
  );
  if (!parsed.success) {
    return backToConnect(req, "invalid");
  }

  const { db } = getApiContext();
  const orgContext = await orgContextForUser(db, session.user.id);
  if (!orgContext) {
    return backToConnect(req, "invalid");
  }

  const outcome = await consentDesktopPairing(forOrg(db, orgContext.org.id), {
    payload: parsed.data,
    userId: session.user.id,
    orgKind: orgContext.org.kind,
  });
  if (!outcome.ok) {
    return backToConnect(req, outcome.error);
  }
  // The browser follows this to the OS deep-link handler; the one-time code
  // travels only inside this redirect, never a server log or a stored value.
  return Response.redirect(outcome.redirectUrl, 303);
}
