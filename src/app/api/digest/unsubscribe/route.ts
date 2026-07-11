import { getApiContext } from "@/lib/api-context";
import {
  peekDigestUnsubscribe,
  resolveDigestUnsubscribe,
} from "@/db/digest-preferences";

export const dynamic = "force-dynamic";

// Unauthenticated one-click unsubscribe (F2.2, ADR 0024). Mirrors the
// share-links capability pattern: NO session (getApiContext, not handleApi) —
// the recipient clicking Unsubscribe from an email has no cookie. The token is
// the sole capability; the org + user are read from the matched preference row,
// never from the request, so a token can only ever unsubscribe the exact
// (org, user) it was minted for.
//
// GET is READ-ONLY (RFC 8058 discipline): mail-security gateways (Outlook
// SafeLinks, Proofpoint) and inbox prefetchers GET every link in an email on
// arrival — a mutating GET would silently mass-unsubscribe every recipient
// behind such a gateway. GET only verifies the token and renders a
// confirmation page whose <form method="post"> button performs the actual
// unsubscribe. POST is the sole mutator, serving BOTH that form and the
// List-Unsubscribe-Post one-click header. Both POST paths are idempotent (an
// already-unsubscribed row still succeeds).

function page(
  title: string,
  body: string,
  status: number,
  extraHtml = "",
): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:48px 16px;color:#1f2937">
<div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center">
<div style="font-weight:700;font-size:20px;color:#5b21b6;margin-bottom:16px">Revealyst</div>
<h1 style="font-size:18px;margin:0 0 8px">${title}</h1>
<p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0">${body}</p>
${extraHtml}
</div></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function tokenFrom(req: Request): string | null {
  return new URL(req.url).searchParams.get("token");
}

/** READ-ONLY: verify the token and offer a POST confirm button. Never mutates. */
export async function GET(req: Request): Promise<Response> {
  const token = tokenFrom(req);
  if (!token) {
    return page("Invalid link", "This unsubscribe link is missing its token.", 400);
  }
  const { db } = getApiContext();
  const known = await peekDigestUnsubscribe(db, token);
  if (!known) {
    return page(
      "Link expired",
      "This unsubscribe link is no longer valid — it may have already been used or replaced by a newer digest. You can manage the weekly digest anytime in your workspace settings.",
      404,
    );
  }
  // The form posts back to this same URL (token in the query), so the POST
  // handler below is the single mutation path for both this button and the
  // one-click header.
  const confirmForm = `<form method="post" action="/api/digest/unsubscribe?token=${encodeURIComponent(
    token,
  )}" style="margin:20px 0 0">
<button type="submit" style="background:#5b21b6;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer">Unsubscribe</button>
</form>`;
  return page(
    "Unsubscribe from the weekly digest?",
    "Confirm below and you won't receive any more weekly digest emails for this workspace. You can turn the digest back on anytime in your workspace settings.",
    200,
    confirmForm,
  );
}

/** The sole mutator: the RFC 8058 one-click POST and the GET page's form. */
export async function POST(req: Request): Promise<Response> {
  const token = tokenFrom(req);
  if (!token) {
    return new Response("missing token", { status: 400 });
  }
  const { db } = getApiContext();
  const result = await resolveDigestUnsubscribe(db, token);
  if (!result) {
    return page(
      "Link expired",
      "This unsubscribe link is no longer valid — it may have already been used or replaced by a newer digest. You can manage the weekly digest anytime in your workspace settings.",
      404,
    );
  }
  return page(
    "You're unsubscribed",
    "You won't receive any more weekly digest emails for this workspace. You can turn the digest back on anytime in your workspace settings.",
    200,
  );
}
