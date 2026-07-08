// Tiny client-side JSON fetch helpers shared by the connect/manage dialogs
// and the onboarding wizard. Never throws on HTTP errors — callers branch on
// `ok` and surface `errorText(payload, fallback)`.

export async function jsonRequest(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // no / non-JSON body
  }
  return { ok: res.ok, status: res.status, payload };
}

export async function postJson(url: string, body?: unknown) {
  return jsonRequest("POST", url, body);
}

export function errorText(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}
