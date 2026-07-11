"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  KeyRound,
  TerminalSquare,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { GithubAppConnectCard } from "@/components/github-app-connect-card";
import { errorText, postJson } from "@/lib/client-fetch";
import { connectApiKeyVendor } from "@/lib/connect-vendor";
import {
  connectedToolsLabel,
  SCORE_TIMING_COPY,
  scoreTimingChannel,
} from "@/lib/onboarding-guide";
import {
  COMING_SOON,
  GITHUB_APP_VENDORS,
  KEY_VENDORS,
  type KeyVendor,
} from "@/lib/vendor-connect-meta";

// W2-H onboarding: sign up → connect (Anthropic key · OpenAI key · install
// the Revealyst Agent) → the connection's first poll + cron backfill land
// data, and the dashboard shows the first insight. Copilot/Cursor for
// individuals have no personal API (connector-facts §6a.2), so they are shown
// as honest "connect when available" states rather than dead inputs.

type InitialConnection = {
  id: string;
  vendor: string;
  status: "pending" | "active" | "paused" | "error";
};

/** The connection for a vendor that counts as "connected" — an errored one
 * (e.g. a rejected key at step 2) does NOT, so its card stays retryable. */
function usableConnection(
  connections: InitialConnection[],
  vendor: string,
): InitialConnection | undefined {
  return connections.find((c) => c.vendor === vendor && c.status !== "error");
}

export function OnboardingWizard({
  initialConnections,
  copilotAvailable = false,
}: {
  initialConnections: InitialConnection[];
  /** Server-checked render-time env gate (ADR 0022): whether the GitHub App
   * secrets are configured, so the Copilot card offers a working install
   * instead of a dead-end. Defaults closed (honest) if a caller forgets. */
  copilotAvailable?: boolean;
}) {
  const [connected, setConnected] = useState<Set<string>>(
    () =>
      new Set(
        initialConnections
          .filter((c) => c.status !== "error")
          .map((c) => c.vendor),
      ),
  );

  function markConnected(vendor: string) {
    setConnected((prev) => new Set(prev).add(vendor));
  }

  const anyConnected = connected.size > 0;
  // Channel- AND sync-state-aware end-state copy (F1.6). Statuses come from
  // the server-loaded rows, NOT from this session's connect events: an agent
  // paired in this session has only had a token issued — its connection is
  // `pending` (markSynced flips it to `active` on the first real push), so
  // the copy says "waiting for your agent's first sync", never "your data is
  // in". Poll vendors connected this session are genuinely in-flight (the
  // connect flow kicks off their first poll), so `pending` is fine for them
  // — the lib treats pending poll connections as usable.
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
          Connect your AI tools
        </h1>
        <p className="text-balance text-muted-foreground">
          Connect at least one source to see your AI adoption, fluency, and
          spend. Your keys are encrypted at rest and never displayed again.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {KEY_VENDORS.map((v) => {
          // Reuse an existing connection's id on retry so a second attempt
          // overwrites (storeCredential upserts) instead of orphaning a
          // duplicate row (admins CAN delete since ADR 0013, but onboarding
          // shouldn't create cleanup work).
          const existing = initialConnections.find((c) => c.vendor === v.vendor);
          return (
            <ApiKeyConnectCard
              key={v.vendor}
              vendor={v}
              existingConnectionId={existing?.id ?? null}
              initiallyDone={Boolean(usableConnection(initialConnections, v.vendor))}
              onConnected={() => markConnected(v.vendor)}
            />
          );
        })}

        <AgentConnectCard
          existingConnectionId={
            initialConnections.find((c) => c.vendor === "claude_code_local")
              ?.id ?? null
          }
          initiallyPaired={Boolean(
            usableConnection(initialConnections, "claude_code_local"),
          )}
          onConnected={() => markConnected("claude_code_local")}
        />

        {GITHUB_APP_VENDORS.map((v) => (
          <GithubAppConnectCard
            key={v.vendor}
            vendor={v}
            connected={Boolean(usableConnection(initialConnections, v.vendor))}
            available={copilotAvailable}
          />
        ))}

        {COMING_SOON.map((c) => (
          <Card key={c.label} className="opacity-70">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{c.label}</CardTitle>
                <Badge variant="outline">
                  <Clock data-icon="inline-start" />
                  Connect when available
                </Badge>
              </div>
              <CardDescription>{c.note}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2">
        {anyConnected ? (
          // Real link only when enabled — a disabled <a> would still
          // navigate (anchors ignore `disabled`). The dashboard is a
          // force-dynamic server component, so the click re-fetches.
          <Button size="lg" nativeButton={false} render={<Link href="/dashboard" />}>
            View my dashboard
            <ArrowRight data-icon="inline-end" />
          </Button>
        ) : (
          <Button size="lg" disabled>
            Connect a source to continue
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

function ApiKeyConnectCard({
  vendor,
  existingConnectionId,
  initiallyDone,
  onConnected,
}: {
  vendor: KeyVendor;
  existingConnectionId: string | null;
  initiallyDone: boolean;
  onConnected: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(initiallyDone);
  // A row created by a failed attempt in THIS session — reused on retry
  // (initialConnections only covers rows that existed at page load).
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await connectApiKeyVendor({
        vendor,
        displayName: `My ${vendor.label}`,
        apiKey: key,
        existingConnectionId: existingConnectionId ?? createdId,
        onCreated: setCreatedId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      setKey("");
      onConnected();
      toast.success(`${vendor.label} connected`);
    } catch {
      // fetch rejects (offline / DNS) — surface it instead of hanging.
      setError("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{vendor.label}</CardTitle>
          {done && (
            <Badge variant="secondary">
              <Check data-icon="inline-start" />
              Connected
            </Badge>
          )}
        </div>
        <CardDescription>{vendor.blurb}</CardDescription>
      </CardHeader>
      {!done && (
        <CardContent>
          <form onSubmit={connect} className="flex flex-col gap-3">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`key-${vendor.vendor}`}>
                  <KeyRound data-icon="inline-start" />
                  API key
                </FieldLabel>
                <Input
                  id={`key-${vendor.vendor}`}
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={vendor.placeholder}
                  autoComplete="off"
                  required
                />
                <p className="text-xs text-muted-foreground">{vendor.keyHint}</p>
              </Field>
            </FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}
            <div>
              <Button type="submit" size="sm" disabled={busy || key.length === 0}>
                {busy && <Spinner data-icon="inline-start" />}
                Connect {vendor.label}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

function AgentConnectCard({
  existingConnectionId,
  initiallyPaired,
  onConnected,
}: {
  existingConnectionId: string | null;
  initiallyPaired: boolean;
  onConnected: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [paired, setPaired] = useState(initiallyPaired);

  async function setup() {
    setBusy(true);
    setError(null);
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
        connectionId = (
          created.payload as { connection?: { id?: string } }
        )?.connection?.id ?? null;
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
      setPaired(true);
      onConnected();
    } catch {
      setError("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            Revealyst Agent (Claude Code)
          </CardTitle>
          {paired && (
            <Badge variant="secondary">
              <Check data-icon="inline-start" />
              Paired
            </Badge>
          )}
        </div>
        <CardDescription>
          Summarizes your local Claude Code sessions on your machine — never raw
          prompt content — and pushes metrics with a device token.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {token ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Copy this token now — it is shown once. Then run the agent:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              <code>{`REVEALYST_TOKEN=${token} npx revealyst-agent sync`}</code>
            </pre>
          </div>
        ) : paired ? (
          <p className="text-sm text-muted-foreground">
            Agent already paired. Re-generate a token below if you need to set up
            another machine — that rotates the previous one.
          </p>
        ) : (
          error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )
        )}
        {!token && (
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={setup}
            >
              {busy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <TerminalSquare data-icon="inline-start" />
              )}
              {paired ? "Re-generate device token" : "Generate device token"}
            </Button>
          </div>
        )}
      </CardContent>
      {token && (
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            Lost it? Re-generate from the connection later — that rotates the
            token.
          </p>
        </CardFooter>
      )}
    </Card>
  );
}
