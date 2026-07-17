"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyncAgentCard } from "@/components/sync-agent-card";
import { OnboardingScopeExplainer } from "@/components/onboarding-scope-explainer";
import {
  connectedToolsLabel,
  SCORE_TIMING_COPY,
  scoreTimingChannel,
} from "@/lib/onboarding-guide";

// Onboarding (ADR 0056): sign up → install the Revealyst Agent for Claude Code
// → the agent pushes usage aggregates (never prompt content) → the dashboard
// shows the first insight. The polled admin-API connectors (Anthropic/OpenAI/
// Cursor/Copilot key paste) were removed with the pivot to the desktop-agent
// usage-source model — the local agent is now the single onboarding source.

type InitialConnection = {
  id: string;
  vendor: string;
  status: "pending" | "active" | "paused" | "error";
};

const LOCAL_VENDOR = "claude_code_local";

export function OnboardingWizard({
  initialConnections,
  continueTo,
  sessionConnectedVendors,
  onConnected: onConnectedProp,
}: {
  initialConnections: InitialConnection[];
  /** U4.2 stepper integration. When provided, the end-state CTA advances the
   * setup stepper (there are more steps ahead) instead of linking straight to
   * the dashboard. When omitted (standalone use), the CTA keeps its shipped
   * "View my dashboard" link. */
  continueTo?: { label: string; onContinue: () => void };
  /** Vendors connected earlier THIS session, owned by the parent flow so the
   * signal survives this component's remount (e.g. stepping back to connect).
   * `initialConnections` is only the SSR snapshot — without this, a remount
   * would drop a same-session connect and wrongly show the card as absent. */
  sessionConnectedVendors?: ReadonlySet<string>;
  /** Bubble each successful connect up to the parent flow so it can persist
   * the session-connected set across remounts + resolve `hasUsableConnection`
   * for the review step. Optional — standalone use omits it. */
  onConnected?: (vendor: string) => void;
}) {
  const [connected, setConnected] = useState<Set<string>>(
    () =>
      new Set([
        ...initialConnections
          .filter((c) => c.status !== "error")
          .map((c) => c.vendor),
        // Seed from the parent-owned session set too, so a remount (stepping
        // back to connect) preserves connects made earlier this session.
        ...(sessionConnectedVendors ?? []),
      ]),
  );

  function markConnected(vendor: string) {
    setConnected((prev) => new Set(prev).add(vendor));
    onConnectedProp?.(vendor);
  }

  const isConnected = (vendor: string) => connected.has(vendor);
  const anyConnected = connected.size > 0;

  // Channel- AND sync-state-aware end-state copy (F1.6). Statuses come from the
  // server-loaded rows, NOT this session's connect events: an agent paired in
  // this session has only had a token issued — its connection is `pending`
  // (markSynced flips it to `active` on the first real push), so the copy says
  // "waiting for your agent's first sync", never "your data is in".
  const channelInputs = Array.from(connected).map((vendor) => {
    const initial = initialConnections.find(
      (c) => c.vendor === vendor && c.status !== "error",
    );
    return { vendor, status: initial?.status ?? ("pending" as const) };
  });
  const timing = SCORE_TIMING_COPY[scoreTimingChannel(channelInputs)];
  const connectedLabel = connectedToolsLabel(channelInputs);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">
          R
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Bring in your Claude Code usage
        </h1>
        <p className="text-balance text-muted-foreground">
          Run the Revealyst Agent on your machine to see your AI adoption,
          fluency, and spend. It reads your local Claude Code sessions and
          pushes only aggregates — never your prompts.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <SyncAgentCard
          existingConnectionId={
            initialConnections.find((c) => c.vendor === LOCAL_VENDOR)?.id ?? null
          }
          paired={isConnected(LOCAL_VENDOR)}
          onConnected={() => markConnected(LOCAL_VENDOR)}
          scope={<OnboardingScopeExplainer vendor={LOCAL_VENDOR} />}
        />
        <p className="text-center text-sm text-muted-foreground">
          Prefer a desktop app that runs it for you?{" "}
          {/* Plain anchor: the worker 308s app.revealyst.com/download to the
              marketing host (/download classifies as marketing). */}
          <a
            href="/download"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Get the Revealyst desktop app
          </a>
          .
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        {anyConnected ? (
          continueTo ? (
            // In the stepper: advance to the next setup step rather than
            // jumping to the dashboard (more steps lie ahead).
            <Button size="lg" onClick={continueTo.onContinue}>
              {continueTo.label}
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            // Standalone: real link only when enabled — a disabled <a> would
            // still navigate (anchors ignore `disabled`). The dashboard is a
            // force-dynamic server component, so the click re-fetches.
            <Button size="lg" nativeButton={false} render={<Link href="/dashboard" />}>
              View my dashboard
              <ArrowRight data-icon="inline-end" />
            </Button>
          )
        ) : (
          <Button size="lg" disabled>
            Set up the agent to continue
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
        {anyConnected && (
          <div className="flex max-w-md flex-col items-center gap-1 text-center">
            <p className="text-sm font-medium">{timing.headline}</p>
            <p className="text-balance text-xs text-muted-foreground">
              {timing.detail}
            </p>
            {connectedLabel && (
              <p className="text-xs text-muted-foreground">
                Connected: {connectedLabel}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
