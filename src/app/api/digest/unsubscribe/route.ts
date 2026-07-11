import { getApiContext } from "@/lib/api-context";
import { resolveDigestUnsubscribe } from "@/db/digest-preferences";

export const dynamic = "force-dynamic";

// Unauthenticated one-click unsubscribe (F2.2, ADR 0024). Mirrors the
// share-links capability pattern: NO session (getApiContext, not handleApi) —
// the recipient clicking Unsubscribe from an email has no cookie. The token is
// the sole capability; the org + user are read from the matched preference row
// (resolveDigestUnsubscribe), never from the request, so a token can only ever
// unsubscribe the exact (org, user) it was minted for.
//
//   GET  — a human clicking the link in the email: flip off, show a page.
//   POST — RFC 8058 List-Unsubscribe-Post one-click: flip off, return 200.
// Both are idempotent (an already-unsubscribed row still succeeds).

function page(title: string, body: string, status: number): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:48px 16px;color:#1f2937">
<div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center">
<div style="font-weight:700;font-size:20px;color:#5b21b6;margin-bottom:16px">Revealyst</div>
<h1 style="font-size:18px;margin:0 0 8px">${title}</h1>
<p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0">${body}</p>
</div></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function unsubscribe(req: Request): Promise<boolean | null> {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return null;
  const { db } = getApiContext();
  return resolveDigestUnsubscribe(db, token);
}

export async function GET(req: Request): Promise<Response> {
  const result = await unsubscribe(req);
  if (result === null) {
    return page("Invalid link", "This unsubscribe link is missing its token.", 400);
  }
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

export async function POST(req: Request): Promise<Response> {
  const result = await unsubscribe(req);
  if (result === null) {
    return new Response("missing token", { status: 400 });
  }
  if (!result) {
    return new Response("unknown token", { status: 404 });
  }
  return new Response(null, { status: 200 });
}
