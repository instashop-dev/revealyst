// Privacy screen (spec §19.4).
//
// "What leaves this computer" renders a placeholder note only: collection
// claims are NEVER hand-written here (cross-cutting law 3) — when collection
// ships (M3), this section renders from the generated allowlist bridge.
// The pause / delete / disconnect controls are present but disabled with
// plain explanations: there is nothing to pause, delete, or disconnect yet.

import { useEffect, useState } from "react";

import { getAutostart, setAutostart, type AgentSnapshot } from "../lib/agent";

export default function PrivacyScreen({ snapshot }: { snapshot: AgentSnapshot | null }) {
  // The snapshot value is only the first paint; the mount read below is the
  // truth (the one-shot snapshot goes stale as soon as the user toggles).
  const [startAtLogin, setStartAtLogin] = useState(snapshot?.autostart ?? false);

  useEffect(() => {
    let cancelled = false;
    getAutostart()
      .then((enabled) => {
        if (!cancelled) setStartAtLogin(enabled);
      })
      .catch(() => {
        // Outside Tauri (tests, plain browser dev): keep the snapshot value.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggleAutostart(enabled: boolean) {
    setStartAtLogin(enabled);
    try {
      await setAutostart(enabled);
    } catch {
      // Roll back so the checkbox never lies about the real setting.
      setStartAtLogin(!enabled);
      return;
    }
    try {
      // Re-read the persisted state so the checkbox shows what the OS
      // actually stored, not what we hoped it stored.
      setStartAtLogin(await getAutostart());
    } catch {
      // Keep the optimistic value — the set itself succeeded.
    }
  }

  return (
    <div>
      <h1>Privacy</h1>

      <section>
        <h2>Current mode</h2>
        <p>
          <strong>Analytics Only</strong> — the default. Nothing is collected
          or uploaded yet. When collection arrives, prompt text will not be
          uploaded in this mode.
        </p>
      </section>

      <section>
        <h2>What leaves this computer</h2>
        <p className="muted">
          Nothing yet. This app does not collect anything right now. When
          syncing is added in a future update, this section will list exactly
          what is sent — nothing more.
        </p>
      </section>

      <section>
        <h2>What never leaves this computer</h2>
        <p>
          Your prompt text and AI responses. Analytics Only mode never
          uploads them.
        </p>
      </section>

      <section>
        <h2>Organization restrictions</h2>
        <p className="muted">No organization policy applies to this computer yet.</p>
      </section>

      <section>
        <h2>Start at login</h2>
        <div className="toggle-row">
          <input
            type="checkbox"
            id="start-at-login"
            checked={startAtLogin}
            onChange={(event) => void onToggleAutostart(event.target.checked)}
          />
          <label htmlFor="start-at-login">
            Start Revealyst when you log in
            <p className="muted">Off unless you turn it on.</p>
          </label>
        </div>
      </section>

      <section>
        <h2>Controls</h2>
        <div className="button-row">
          <button type="button" className="secondary" disabled>
            Pause collection
          </button>
          <span className="muted">Nothing is collected yet.</span>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" disabled>
            Delete pending local data
          </button>
          <span className="muted">There is no local data yet.</span>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" disabled>
            Disconnect this device
          </button>
          <span className="muted">This computer is not connected yet.</span>
        </div>
      </section>
    </div>
  );
}
