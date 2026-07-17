// About / diagnostics screen: app version, platform, log location, and the
// "Send diagnostics" action. Sending is an explicit, user-triggered action only
// (spec §23.2) — it builds a counts-and-versions bundle from the local store
// and sends it (never prompt text, keys, or passwords).

import { useState } from "react";

import { sendDiagnostics, type AgentSnapshot } from "../lib/agent";

function platformLabel(platform: string): string {
  switch (platform) {
    case "windows":
      return "Windows";
    case "macos":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

export default function DiagnosticsScreen({ snapshot }: { snapshot: AgentSnapshot | null }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setMessage(null);
    try {
      const result = await sendDiagnostics();
      setMessage(result);
    } catch (error) {
      setMessage(
        typeof error === "string"
          ? error
          : "Couldn't send diagnostics. Please try again.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h1>About</h1>
      <dl className="rows">
        <dt>App version</dt>
        <dd>{snapshot?.version ?? "—"}</dd>

        <dt>Platform</dt>
        <dd>{snapshot ? platformLabel(snapshot.platform) : "—"}</dd>

        <dt>Log location</dt>
        <dd>{snapshot?.logDir ? <code>{snapshot.logDir}</code> : "—"}</dd>
      </dl>
      <p className="muted">
        Log files record what the app is doing so problems can be fixed. They
        never contain your prompt text or any passwords or keys.
      </p>
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          onClick={handleSend}
          disabled={sending}
        >
          {sending ? "Sending…" : "Send diagnostics"}
        </button>
        {message ? (
          <span className="muted" role="status">
            {message}
          </span>
        ) : (
          <span className="muted">
            Sends counts and versions only — never your prompts or keys.
          </span>
        )}
      </div>
    </div>
  );
}
