// Status screen (spec §19.3). Every row renders HONESTLY from the agent
// snapshot plus a few narrow live reads (signed-in, paused, pending count).
// Anything this computer genuinely can't know yet shows a plain "not yet"
// placeholder or "—" — never fabricated data (invariant b). Coverage /
// unsupported-source claims come from the disclosure registry, never
// hand-written here.

import { useEffect, useState } from "react";

import {
  getCollectionPaused,
  getPendingCount,
  isSignedIn,
  type AgentSnapshot,
} from "../lib/agent";
import {
  COVERAGE_LIMITATIONS,
  UNSUPPORTED_SOURCES,
} from "../lib/collection-disclosure";
import { AGENT_STATE_LABELS } from "../lib/state";

export default function StatusScreen({ snapshot }: { snapshot: AgentSnapshot | null }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    isSignedIn()
      .then((s) => {
        if (!cancelled) setSignedIn(s);
      })
      .catch(() => {});
    getCollectionPaused()
      .then((p) => {
        if (!cancelled) setPaused(p);
      })
      .catch(() => {});
    getPendingCount()
      .then((c) => {
        if (!cancelled) setPending(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const privacyMode =
    paused === true ? "Analytics Only (collection paused)" : "Analytics Only";

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
        <dd>{snapshot ? AGENT_STATE_LABELS[snapshot.state] : "—"}</dd>

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
        <dd>{signedIn ? "—" : "Never — not signed in yet"}</dd>

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
    </div>
  );
}
