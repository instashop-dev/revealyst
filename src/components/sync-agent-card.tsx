"use client";

import { useState } from "react";
import { AlertCircle, Check, Copy, TerminalSquare } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectorCard } from "@/components/connector-card";
import { errorText, postJson } from "@/lib/client-fetch";
import {
  AGENT_DRY_RUN_COMMAND,
  AGENT_SYNC_COMMAND,
  agentLoginCommand,
} from "@/lib/agent-sync";
import { formatRelativeTime } from "@/lib/format";

// The Revealyst Agent pairing + run surface, extracted from the onboarding
// wizard so the Connections page renders the SAME card (plan §2). Manual sync:
// the user runs the CLI on their own machine — there is no resident companion
// and no file upload (parse.ts keeps prompt content on-device; only aggregates
// are pushed). Token handling is show-once, React-state-only: the secret is
// held in component state for the single render that displays it and is NEVER
// written to browser storage (plan §7).

export function SyncAgentCard({
  existingConnectionId,
  paired = false,
  lastSuccessAt = null,
  onConnected,
  scope,
}: {
  /** An already-created `claude_code_local` connection to rotate, or null to
   * create-or-reuse on first pairing. */
  existingConnectionId: string | null;
  /** Whether a usable agent connection already exists (drives the "Paired"
   * badge + the regenerate-with-confirm path). */
  paired?: boolean;
  /** Last successful push, for the Connections-page last-synced line. */
  lastSuccessAt?: Date | string | null;
  onConnected?: () => void;
  /** Optional scope note (U4.2 onboarding) — passed straight to ConnectorCard. */
  scope?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isPaired, setIsPaired] = useState(paired);
  // Regenerating rotates (invalidates) the previous token, so an
  // already-paired user must confirm before we mint — a stray click would
  // brick the agent on any other machine until it re-runs `login`.
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  async function setup() {
    setBusy(true);
    setError(null);
    setConfirming(false);
    try {
      // Reuse an existing agent connection (re-issue rotates its token)
      // rather than creating a duplicate.
      let connectionId = existingConnectionId;
      if (!connectionId) {
        const created = await postJson("/api/connections", {
          vendor: "claude_code_local",
          displayName: "Revealyst Agent",
          authKind: "device_token",
          config: {},
        });
        if (!created.ok) {
          setError(
            errorText(
              created.payload,
              `Could not set up the agent (${created.status})`,
            ),
          );
          return;
        }
        connectionId =
          (created.payload as { connection?: { id?: string } })?.connection
            ?.id ?? null;
        if (!connectionId) {
          setError("Unexpected response creating the connection");
          return;
        }
      }
      const issued = await postJson(
        `/api/connections/${connectionId}/agent-token`,
      );
      if (!issued.ok) {
        setError(errorText(issued.payload, "Could not issue a device token"));
        return;
      }
      const issuedToken = (issued.payload as { token?: string })?.token;
      if (!issuedToken) {
        setError("No token was returned — please try again");
        return;
      }
      setToken(issuedToken);
      setIsPaired(true);
      onConnected?.();
    } catch {
      setError("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  // First-run: the two-command block (login then sync). Replaces the broken
  // `REVEALYST_TOKEN=… npx …` one-liner — an inlined env var lands in shell
  // history; `login` writes the 0o600 config file instead (plan §7.1).
  const firstRunBlock = token
    ? `${agentLoginCommand(token)}\n${AGENT_SYNC_COMMAND}`
    : "";

  async function copyFirstRun() {
    try {
      await navigator.clipboard.writeText(firstRunBlock);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context) — the commands are
      // still visible for manual selection, so this is non-fatal.
    }
  }

  // U0.6: renders through the shared `ConnectorCard` shell — the per-state
  // body (token / paired / neither) plus the mint-error alert is passed as
  // `children`; the primary action (Generate / Re-generate / the confirm
  // step's "Yes, regenerate") and its "Cancel" sibling move into the shell's
  // action row, and the show-once token's footnote becomes the `meta` line.
  // Logic, state, and polling are unchanged — presentation only moved.
  return (
    <ConnectorCard
      vendorName="Revealyst Agent (Claude Code)"
      scope={scope}
      statusBadge={
        isPaired ? (
          <Badge variant="secondary">
            <Check data-icon="inline-start" />
            Paired
          </Badge>
        ) : null
      }
      summary="Summarizes your local Claude Code sessions on your machine — never raw prompt content — and pushes metrics with a device token. You run it yourself; nothing runs in the background."
      meta={
        token ? (
          <p className="text-xs text-muted-foreground">
            Lost it? Re-generate from this connection later — that rotates the
            token.
          </p>
        ) : null
      }
      primaryAction={
        !token ? (
          confirming ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={setup}
            >
              <TerminalSquare data-icon="inline-start" />
              Yes, regenerate token
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={isPaired ? () => setConfirming(true) : setup}
            >
              <TerminalSquare data-icon="inline-start" />
              {isPaired ? "Re-generate device token" : "Generate device token"}
            </Button>
          )
        ) : null
      }
      secondaryAction={
        !token && confirming ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        ) : null
      }
    >
      {token ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Copy this token now — it is shown once. Then run both commands:
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copyFirstRun}
            >
              {copied ? (
                <Check data-icon="inline-start" />
              ) : (
                <Copy data-icon="inline-start" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{firstRunBlock}</code>
          </pre>
          <p className="text-xs text-muted-foreground">
            Want to see exactly what would be sent first? Run{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {AGENT_DRY_RUN_COMMAND}
            </code>{" "}
            — it inspects your logs locally and pushes nothing.
          </p>
        </div>
      ) : isPaired ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Agent paired. Run this on your machine whenever you want to
            refresh your data:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{AGENT_SYNC_COMMAND}</code>
          </pre>
          {lastSuccessAt ? (
            <p className="text-xs text-muted-foreground">
              Last synced {formatRelativeTime(lastSuccessAt)}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No sync yet — run the command above to bring in your Claude Code
              usage.
            </p>
          )}
          {confirming && (
            <Alert>
              <AlertCircle />
              <AlertTitle>
                Regenerating invalidates the previous token — the agent on any
                paired machine stops syncing until you re-run{" "}
                <code>login</code>. Continue?
              </AlertTitle>
            </Alert>
          )}
        </div>
      ) : null}
      {/* Mint errors surface once, regardless of paired state (the token
       * block above only renders on success). */}
      {!token && error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
    </ConnectorCard>
  );
}
