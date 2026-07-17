// Status screen (spec §19.3). Every row renders HONESTLY from the agent
// snapshot — a single live-polled read (App refreshes it every few seconds and
// after "Sync now"). Anything this computer genuinely can't know yet shows a
// plain "not yet" placeholder or "—" — never fabricated data (invariant b).
// Coverage / unsupported-source claims come from the disclosure registry,
// never hand-written here.

import { useState } from "react";

import { syncNow, type AgentSnapshot } from "../lib/agent";
import {
  COVERAGE_LIMITATIONS,
  UNSUPPORTED_SOURCES,
} from "../lib/collection-disclosure";
import { formatLastSync } from "../lib/format";
import { AGENT_STATE_LABELS } from "../lib/state";

export default function StatusScreen({
  snapshot,
  onRefresh,
}: {
  snapshot: AgentSnapshot | null;
  onRefresh?: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Everything comes from the (live-polled) snapshot; null = not loaded yet.
  const signedIn = snapshot ? snapshot.signedIn : null;
  const paused = snapshot ? snapshot.paused : null;
  const pending = snapshot ? snapshot.pendingCount : null;

  const privacyMode =
    paused === true ? "Analytics Only (collection paused)" : "Analytics Only";

  // Overall-status label. A signed-in device whose flags are all clear resolves
  // to "healthy", but if it has never completed a sync ("Last sync —") calling
  // that "Syncing normally" would be a false positive — say it's getting ready
  // instead (invariant b). Any real problem state is shown as-is.
  const overallStatus = !snapshot
    ? "—"
    : signedIn && snapshot.state === "healthy" && snapshot.lastSyncAt === null
      ? "Getting ready — first sync hasn't run yet"
      : AGENT_STATE_LABELS[snapshot.state];

  async function handleSyncNow() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncNow();
      setSyncMessage(result);
    } catch (error) {
      setSyncMessage(
        typeof error === "string" ? error : "Couldn't sync. Please try again.",
      );
    } finally {
      setSyncing(false);
      // Pull the fresh last-sync time + pending count straight away.
      onRefresh?.();
    }
  }

  return (
    <div>
      <h1>Status</h1>
      {signedIn === false && (
        <p className="muted">
          This computer isn&apos;t signed in to Revealyst yet. Nothing is
          collected or sent.
        </p>
      )}
      <dl className="rows">
        <dt>Overall status</dt>
        <dd>{overallStatus}</dd>

        <dt>Signed in</dt>
        <dd>
          {signedIn === null
            ? "—"
            : signedIn
              ? "Yes — this computer is signed in"
              : "Not signed in yet"}
        </dd>

        <dt>Device name</dt>
        <dd>This computer</dd>

        <dt>Last sync</dt>
        <dd>
          {signedIn === false
            ? "Never — not signed in yet"
            : formatLastSync(snapshot?.lastSyncAt ?? null)}
        </dd>

        <dt>Privacy mode</dt>
        <dd>{privacyMode}</dd>

        <dt>Connected sources</dt>
        <dd>
          {!signedIn
            ? "None yet"
            : paused
              ? "Claude Code (collection paused)"
              : "Claude Code — if installed, this computer reads its local logs"}
        </dd>

        <dt>Unsupported sources</dt>
        <dd>
          <ul>
            {UNSUPPORTED_SOURCES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </dd>

        <dt>Coverage limits</dt>
        <dd>
          <ul>
            {COVERAGE_LIMITATIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </dd>

        <dt>Waiting to send</dt>
        <dd>
          {pending === null
            ? "—"
            : pending > 0
              ? `${pending} item${pending === 1 ? "" : "s"}`
              : "Nothing waiting"}
        </dd>

        <dt>App version</dt>
        <dd>{snapshot?.version ?? "—"}</dd>

        <dt>Updates</dt>
        <dd>Automatic updates aren&apos;t available yet</dd>
      </dl>

      {signedIn && (
        <>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={handleSyncNow}
              disabled={syncing || paused === true}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            {paused === true && (
              <span className="muted">Resume collection to sync.</span>
            )}
          </div>
          {syncMessage && (
            <p className="muted" role="status">
              {syncMessage}
            </p>
          )}
        </>
      )}
    </div>
  );
}
