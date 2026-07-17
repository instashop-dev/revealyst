// App shell: sidebar navigation over the four screens (spec §19.2–§19.4).
// State arrives via ONE narrow Tauri command (get_agent_snapshot); tray menu
// items switch screens via the Rust-emitted `navigate` event.

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { getAgentSnapshot, type AgentSnapshot } from "./lib/agent";
import DiagnosticsScreen from "./screens/diagnostics";
import OnboardingScreen from "./screens/onboarding";
import PrivacyScreen from "./screens/privacy";
import StatusScreen from "./screens/status";

export type Screen = "onboarding" | "status" | "privacy" | "diagnostics";

const NAV: { id: Screen; label: string }[] = [
  { id: "onboarding", label: "Set up" },
  { id: "status", label: "Status" },
  { id: "privacy", label: "Privacy" },
  { id: "diagnostics", label: "About" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("onboarding");
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);

  // One refresh function, reused by the initial load, the background poll, and
  // the status screen's "Sync now" button — so the UI reflects a completed
  // sync (last-sync time, pending count, overall status) without a restart.
  const refreshSnapshot = useCallback(() => {
    return getAgentSnapshot()
      .then((snap) => setSnapshot(snap))
      .catch(() => {
        // Outside Tauri (tests, plain browser dev): keep honest placeholders.
      });
  }, []);

  useEffect(() => {
    refreshSnapshot();
    // Poll so a background sync cycle (every ~15 min, or a manual Sync now)
    // shows up while the window is open. Cheap: one in-process command, no
    // network. Cleared on unmount.
    const timer = setInterval(refreshSnapshot, 4000);
    return () => clearInterval(timer);
  }, [refreshSnapshot]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<string>("navigate", (event) => {
      if (event.payload === "status" || event.payload === "privacy") {
        setScreen(event.payload);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Outside Tauri there is no event bridge — nav still works in-app.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Revealyst</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            aria-current={item.id === screen ? "page" : undefined}
            onClick={() => setScreen(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {screen === "onboarding" && <OnboardingScreen />}
        {screen === "status" && (
          <StatusScreen snapshot={snapshot} onRefresh={refreshSnapshot} />
        )}
        {screen === "privacy" && <PrivacyScreen snapshot={snapshot} />}
        {screen === "diagnostics" && <DiagnosticsScreen snapshot={snapshot} />}
      </main>
    </div>
  );
}
