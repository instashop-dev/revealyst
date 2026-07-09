import { errorText, postJson } from "./client-fetch";
import type { KeyVendor } from "./vendor-connect-meta";

export type ConnectResult =
  | { ok: true; connectionId: string }
  | { ok: false; error: string };

/**
 * The one connect flow for key-based vendors, shared by the onboarding
 * wizard and the connections-page dialog: create the row (or reuse a prior
 * attempt's — the credential PUT upserts, so retries never orphan a
 * duplicate), store + validate the key (a bad key comes back as ok:false
 * with the honest reason; the row is left in its errored state), then nudge
 * a best-effort immediate poll. Network-level fetch rejections propagate —
 * callers surface their own "you're offline" copy.
 */
export async function connectApiKeyVendor(opts: {
  vendor: KeyVendor;
  displayName: string;
  apiKey: string;
  existingConnectionId: string | null;
  /** Fires as soon as a row exists, even if the key is then rejected —
   * lets the caller refresh lists so the row is never invisible. */
  onCreated?: (connectionId: string) => void;
}): Promise<ConnectResult> {
  let connectionId = opts.existingConnectionId;
  if (!connectionId) {
    const created = await postJson("/api/connections", {
      vendor: opts.vendor.vendor,
      displayName: opts.displayName,
      authKind: opts.vendor.authKind,
      config: {},
    });
    if (!created.ok) {
      return {
        ok: false,
        error: errorText(
          created.payload,
          `Could not connect (${created.status})`,
        ),
      };
    }
    connectionId =
      (created.payload as { connection?: { id?: string } })?.connection?.id ??
      null;
    if (!connectionId) {
      return { ok: false, error: "Unexpected response creating the connection" };
    }
    opts.onCreated?.(connectionId);
  }

  const cred = await postJson(`/api/connections/${connectionId}/credential`, {
    kind: "api_key",
    value: opts.apiKey,
  });
  if (!cred.ok) {
    return { ok: false, error: errorText(cred.payload, "That key was rejected") };
  }

  // Fire-and-forget: this module only runs in the browser (imported solely
  // by "use client" components — onboarding-wizard.tsx,
  // add-connection-dialog.tsx), so there is no Workers cross-request-I/O
  // cancellation risk in awaiting it, but the caller doesn't need the poll's
  // result to proceed — the sync itself is a best-effort nudge.
  postJson(`/api/connections/${connectionId}/poll`).catch(() => {});
  return { ok: true, connectionId };
}
