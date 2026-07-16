// About / diagnostics screen: app version, platform, log location, and the
// disabled "Send diagnostics" placeholder (the diagnostics bundle ships in
// M4 — sending is explicit user action only, spec §23.2).

import type { AgentSnapshot } from "../lib/agent";

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
        <button type="button" className="secondary" disabled>
          Send diagnostics
        </button>
        <span className="muted">Not available yet.</span>
      </div>
    </div>
  );
}
