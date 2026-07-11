import { AwsClient } from "aws4fetch";

// Transactional email over Amazon SES v2, signed with AWS SigV4 via aws4fetch
// (no SMTP on the Workers runtime; SES is called as a plain signed HTTPS
// request). Wired into Better Auth's password-reset and email-verification
// callbacks (src/lib/auth.ts). Credentials arrive as Worker secrets, never
// module-cached — the client is built per call from the request env.

export type EmailEnv = {
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  SES_REGION?: string;
  /** A verified SES sending identity, e.g. "Revealyst <noreply@revealyst.com>". */
  EMAIL_FROM?: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /** Extra RFC-5322 headers to attach (SES v2 `Content.Simple.Headers`).
   * Additive — transactional callers omit it. The digest sender (F2.2) uses it
   * for `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058 one-click), which
   * meaningfully improves bulk-mail deliverability and inbox trust. */
  headers?: { name: string; value: string }[];
};

const DEFAULT_FROM = "Revealyst <noreply@revealyst.com>";

/**
 * Can `sendEmail` actually deliver with this env? The SAME predicate
 * `sendEmail` no-ops on, exported so a sender with pre-send side effects can
 * check it FIRST: the weekly digest compare-and-sets its once-per-week claim
 * BEFORE sending, so if SES were unconfigured (e.g. a Monday secret-sync
 * failure) the claim would burn the week on a send that silently no-opped.
 * Checking this up front lets the digest skip WITHOUT claiming, so the week
 * can still send once secrets are back.
 */
export function isEmailConfigured(env: EmailEnv): boolean {
  return Boolean(
    env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY && env.SES_REGION,
  );
}

/**
 * Send one transactional email. When SES is not configured (local dev, or
 * before secrets are synced) this no-ops. Outside production it also logs the
 * message body — including any link — so a developer can copy a
 * verification/reset URL out of the logs instead of the flow hard-failing;
 * in production the body (which carries a live single-use token) is never
 * logged, only the recipient/subject.
 *
 * A non-2xx SES response throws — but note that better-auth invokes this
 * callback via `runInBackgroundOrAwait` (see src/lib/auth.ts), which catches
 * and only logs a thrown error rather than propagating it to the API caller.
 * The throw is still worth keeping (it's what gets logged), just don't rely
 * on it reaching the client.
 */
export async function sendEmail(env: EmailEnv, msg: EmailMessage): Promise<void> {
  // Inline (not isEmailConfigured) so TS narrows the fields below; keep the
  // two checks in lockstep.
  if (!env.SES_ACCESS_KEY_ID || !env.SES_SECRET_ACCESS_KEY || !env.SES_REGION) {
    const detail =
      process.env.NODE_ENV === "production" ? "" : `\n${msg.html}`;
    console.warn(
      `[email] SES not configured; skipping "${msg.subject}" to ${msg.to}${detail}`,
    );
    return;
  }

  const client = new AwsClient({
    accessKeyId: env.SES_ACCESS_KEY_ID,
    secretAccessKey: env.SES_SECRET_ACCESS_KEY,
    region: env.SES_REGION,
    service: "ses",
  });

  const res = await client.fetch(
    `https://email.${env.SES_REGION}.amazonaws.com/v2/email/outbound-emails`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: env.EMAIL_FROM || DEFAULT_FROM,
        Destination: { ToAddresses: [msg.to] },
        Content: {
          Simple: {
            Subject: { Data: msg.subject, Charset: "UTF-8" },
            Body: { Html: { Data: msg.html, Charset: "UTF-8" } },
            ...(msg.headers && msg.headers.length > 0
              ? {
                  Headers: msg.headers.map((h) => ({
                    Name: h.name,
                    Value: h.value,
                  })),
                }
              : {}),
          },
        },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`SES send failed: ${res.status} ${await res.text()}`);
  }
}
