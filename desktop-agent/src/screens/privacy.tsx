// Privacy screen (spec §19.4).
//
// LAW 3: the "What leaves" / "What never leaves" FIELD claims are rendered from
// the generated allowlist artifact (`collection-disclosure.ts`), never
// hand-written here. The encryption-delta wording mirrors store/mod.rs.
//
// Actions (spec §19.4): pause collection, delete pending local data, and
// disconnect this device — each calls a narrow Tauri command. Destructive
// actions (delete / disconnect) use a two-step in-place confirm rather than a
// modal, keeping the screen minimal (CLAUDE.md UX principles).

import { useEffect, useState } from "react";

import {
  deletePendingData,
  disconnectDevice,
  getAutostart,
  getCollectionPaused,
  getPendingCount,
  isSignedIn,
  setAutostart,
  setCollectionPaused,
  type AgentSnapshot,
} from "../lib/agent";
import {
  ENCRYPTION_DISCLOSURE,
  NEVER_COLLECTED,
  ON_DEVICE_ONLY_FIELDS,
  SENT_FIELDS,
} from "../lib/collection-disclosure";

export default function PrivacyScreen({ snapshot }: { snapshot: AgentSnapshot | null }) {
  // The snapshot value is only the first paint; the mount reads below are the
  // truth (a one-shot snapshot goes stale as soon as the user toggles).
  const [startAtLogin, setStartAtLogin] = useState(snapshot?.autostart ?? false);
  const [paused, setPaused] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  // Two-step confirms + transient result copy for the destructive actions.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAutostart()
      .then((enabled) => {
        if (!cancelled) setStartAtLogin(enabled);
      })
      .catch(() => {
        // Outside Tauri (tests, plain browser dev): keep the snapshot value.
      });
    getCollectionPaused()
      .then((p) => {
        if (!cancelled) setPaused(p);
      })
      .catch(() => {});
    isSignedIn()
      .then((s) => {
        if (!cancelled) setSignedIn(s);
      })
      .catch(() => {});
    refreshPending(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  function refreshPending(isCancelled: () => boolean = () => false) {
    getPendingCount()
      .then((count) => {
        if (!isCancelled()) setPending(count);
      })
      .catch(() => {});
  }

  async function onToggleAutostart(enabled: boolean) {
    setStartAtLogin(enabled);
    try {
      await setAutostart(enabled);
    } catch {
      setStartAtLogin(!enabled); // never let the checkbox lie about the setting
      return;
    }
    try {
      setStartAtLogin(await getAutostart());
    } catch {
      // Keep the optimistic value — the set itself succeeded.
    }
  }

  async function onTogglePause(nextPaused: boolean) {
    setPaused(nextPaused);
    try {
      await setCollectionPaused(nextPaused);
      setNotice(nextPaused ? "Collection paused." : "Collection resumed.");
    } catch {
      setPaused(!nextPaused); // roll back so the toggle matches reality
      setNotice("Nothing to pause yet — this computer isn't collecting.");
    }
  }

  async function onDeletePending() {
    try {
      const removed = await deletePendingData();
      setNotice(
        removed > 0
          ? `Deleted ${removed} item${removed === 1 ? "" : "s"} that hadn't been sent.`
          : "There was nothing waiting to delete.",
      );
    } catch {
      setNotice("Could not delete the pending data. Please try again.");
    } finally {
      setConfirmDelete(false);
      refreshPending();
    }
  }

  async function onDisconnect() {
    try {
      await disconnectDevice();
      setSignedIn(false);
      setNotice(
        "This computer is disconnected. Its saved sign-in was removed and any data still waiting to send can no longer be read.",
      );
    } catch {
      setNotice("Could not fully disconnect this computer. Please try again.");
    } finally {
      setConfirmDisconnect(false);
      refreshPending();
    }
  }

  return (
    <div>
      <h1>Privacy</h1>

      <section>
        <h2>Current mode</h2>
        <p>
          <strong>Analytics Only</strong> — the default and only mode. Counts,
          timing, and model names are collected; your prompt text and AI
          responses never are.
        </p>
        <p className="muted">
          Background collection is currently{" "}
          <strong>
            {!signedIn ? "off (this computer isn't signed in)" : paused ? "paused" : "on"}
          </strong>
          .
        </p>
      </section>

      <section>
        <h2>What leaves this computer</h2>
        <p className="muted">
          Only these values are ever sent, and nothing more:
        </p>
        <ul data-testid="what-leaves">
          {SENT_FIELDS.map((f) => (
            <li key={f.field}>
              <strong>{f.label}</strong> — {f.purpose}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>What never leaves this computer</h2>
        <p className="muted">
          These are read only on your machine — their values are never sent:
        </p>
        <ul data-testid="what-never-leaves">
          {ON_DEVICE_ONLY_FIELDS.map((f) => (
            <li key={f.field}>
              <strong>{f.label}</strong> — {f.purpose}
            </li>
          ))}
        </ul>
        <p className="muted">And these are never read at all:</p>
        <ul data-testid="never-collected">
          {NEVER_COLLECTED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>How your waiting data is stored</h2>
        <p>{ENCRYPTION_DISCLOSURE}</p>
      </section>

      <section>
        <h2>Organization restrictions</h2>
        <p className="muted">No organization policy applies to this computer.</p>
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
        {notice && (
          <p className="muted" role="status">
            {notice}
          </p>
        )}

        <div className="toggle-row">
          <input
            type="checkbox"
            id="pause-collection"
            checked={paused}
            onChange={(event) => void onTogglePause(event.target.checked)}
          />
          <label htmlFor="pause-collection">
            Pause collection
            <p className="muted">
              Stops all background collection until you turn it back on.
            </p>
          </label>
        </div>

        <div className="button-row">
          {confirmDelete ? (
            <>
              <span>Delete data waiting to send? This can&apos;t be undone.</span>
              <button type="button" className="danger" onClick={() => void onDeletePending()}>
                Yes, delete it
              </button>
              <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setNotice(null);
                  setConfirmDelete(true);
                }}
              >
                Delete pending local data
              </button>
              <span className="muted">
                {pending === null
                  ? "Removes anything collected but not yet sent."
                  : pending > 0
                    ? `${pending} item${pending === 1 ? "" : "s"} waiting to send.`
                    : "Nothing is waiting to send right now."}
              </span>
            </>
          )}
        </div>

        <div className="button-row">
          {confirmDisconnect ? (
            <>
              <span>
                Disconnect this computer? It will stop syncing and any waiting
                data becomes unreadable.
              </span>
              <button type="button" className="danger" onClick={() => void onDisconnect()}>
                Yes, disconnect
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setNotice(null);
                  setConfirmDisconnect(true);
                }}
              >
                Disconnect this device
              </button>
              <span className="muted">
                {signedIn
                  ? "Removes this computer's sign-in and wipes its local key."
                  : "This computer isn't signed in."}
              </span>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
