// Status screen (spec §19.3). Wave M1: every row renders an HONEST
// placeholder — nothing is connected, collected, or synced yet, and the
// screen says so plainly. Never fake data.

import type { AgentSnapshot } from "../lib/agent";
import { AGENT_STATE_LABELS } from "../lib/state";

export default function StatusScreen({ snapshot }: { snapshot: AgentSnapshot | null }) {
  return (
    <div>
      <h1>Status</h1>
      <p className="muted">
        This computer is not connected to Revealyst yet. Nothing is collected
        or sent.
      </p>
      <dl className="rows">
        <dt>Overall status</dt>
        <dd>{snapshot ? AGENT_STATE_LABELS[snapshot.state] : "—"}</dd>

        <dt>Signed in as</dt>
        <dd>Not signed in yet</dd>

        <dt>Device name</dt>
        <dd>Not set up yet</dd>

        <dt>Last sync</dt>
        <dd>Never — not connected yet</dd>

        <dt>Privacy mode</dt>
        <dd>Analytics Only (the default — collection isn&apos;t built yet)</dd>

        <dt>Connected sources</dt>
        <dd>None yet</dd>

        <dt>Unsupported sources</dt>
        <dd>Source detection is not available yet</dd>

        <dt>Coverage limits</dt>
        <dd>Nothing is collected yet, so there is nothing to cover</dd>

        <dt>Waiting to send</dt>
        <dd>Nothing — no data is collected yet</dd>

        <dt>App version</dt>
        <dd>{snapshot?.version ?? "—"}</dd>

        <dt>Updates</dt>
        <dd>Automatic updates are not available yet</dd>
      </dl>
    </div>
  );
}
