// HTTP push of a locally-built batch to POST /api/agent/ingest. The only
// network call the agent makes; the payload is the privacy-tested
// AgentIngestRequest and nothing else.

import type { AgentIngestRequest } from "./types";

export type PushResult =
  | { ok: true; subjects: number; records: number; signals: number }
  | { ok: false; status: number | null; error: string };

export async function pushBatch(
  apiBaseUrl: string,
  token: string,
  batch: AgentIngestRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/api/agent/ingest`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(batch),
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: `network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page — fall through with the status alone.
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `server returned ${response.status}`;
    return { ok: false, status: response.status, error: message };
  }

  const counts = body as {
    subjects?: number;
    records?: number;
    signals?: number;
  } | null;
  return {
    ok: true,
    subjects: counts?.subjects ?? 0,
    records: counts?.records ?? 0,
    signals: counts?.signals ?? 0,
  };
}
