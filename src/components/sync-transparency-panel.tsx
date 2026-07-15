import { ArrowUpRight, Eye, ShieldCheck, XCircle } from "lucide-react";

import {
  AGENT_NEVER_COLLECTED,
  AGENT_ON_DEVICE_ONLY_FIELDS,
  AGENT_SENT_FIELDS,
  type CollectionField,
} from "@/lib/agent-collection-schema";
import { TRANSPARENCY_PANEL } from "@/lib/connections-copy";
import { formatRelativeTime } from "@/lib/format";
import { deriveSyncPositive } from "@/lib/sync-reward";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// "What this sync sent" transparency panel (W5-G deliverable 2). The
// on-device allowlist made visible: field names come from
// `agent-collection-schema` (mirror of the agent's parse allowlist, drift-
// guarded in CI), so this panel can never claim to send something the parser
// doesn't read. Optional last-run counts are read from `connector_runs`
// (agent_ingest kind) by the page — existing rows, no new query stages.
// Honesty gate: no run yet → neutral copy, never a fabricated number, and
// NEVER a staleness nag (G5).
//
// SYNC-003 same-click reward (Spec §10): the factual counts line and the
// honesty-gated positive nudge render together, in one place, so a sync is
// one reward moment rather than a fact dump followed by a separate cheer.
// `deriveSyncPositive` (src/lib/sync-reward.ts) is the server-side mirror of
// the CLI's `composeSyncReward` (packages/revealyst-agent/src/reward.ts) —
// same honesty gate, reduced to the one superlative tier the persisted
// aggregate can support.

export type LastSyncFacts = {
  records: number;
  signals: number;
  subjects: number;
  windowStart: string | null;
  windowEnd: string | null;
  syncedAt: Date | string | null;
};

function FieldRow({ f }: { f: CollectionField }) {
  return (
    <li className="flex flex-col gap-0.5">
      <code className="text-xs font-medium">{f.label}</code>
      <span className="text-xs text-muted-foreground">{f.purpose}</span>
    </li>
  );
}

export function SyncTransparencyPanel({
  lastRun = null,
}: {
  lastRun?: LastSyncFacts | null;
}) {
  const window =
    lastRun?.windowStart && lastRun?.windowEnd
      ? `${lastRun.windowStart} → ${lastRun.windowEnd}`
      : null;
  // Same-click reward: composed from facts already in `lastRun` — zero new
  // queries. Null on thin/unattributable data (see sync-reward.ts).
  const positive = lastRun ? deriveSyncPositive(lastRun) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="size-4" aria-hidden />
          {TRANSPARENCY_PANEL.title}
        </CardTitle>
        <CardDescription>{TRANSPARENCY_PANEL.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {lastRun ? (
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium">
              {TRANSPARENCY_PANEL.lastSyncHeading}
            </p>
            <p className="mt-1 text-sm">
              {lastRun.records} records · {lastRun.signals} day signals ·{" "}
              {lastRun.subjects} subject
              {lastRun.subjects === 1 ? "" : "s"}
              {window ? ` · ${window}` : ""}
            </p>
            {lastRun.syncedAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Synced {formatRelativeTime(lastRun.syncedAt)}.
              </p>
            )}
            {positive && (
              <p className="mt-2 text-sm font-medium">{positive}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {TRANSPARENCY_PANEL.noRunYet}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">
              {TRANSPARENCY_PANEL.sentHeading}
            </span>
            <Badge variant="secondary">{AGENT_SENT_FIELDS.length}</Badge>
          </div>
          <ul className="flex flex-col gap-2 pl-6">
            {AGENT_SENT_FIELDS.map((f) => (
              <FieldRow key={f.field} f={f} />
            ))}
          </ul>
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">
              {TRANSPARENCY_PANEL.onDeviceHeading}
            </span>
            <Badge variant="secondary">
              {AGENT_ON_DEVICE_ONLY_FIELDS.length}
            </Badge>
          </div>
          <ul className="flex flex-col gap-2 pl-6">
            {AGENT_ON_DEVICE_ONLY_FIELDS.map((f) => (
              <FieldRow key={f.field} f={f} />
            ))}
          </ul>
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <XCircle className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">
              {TRANSPARENCY_PANEL.neverHeading}
            </span>
          </div>
          <ul className="flex flex-col gap-1 pl-6">
            {AGENT_NEVER_COLLECTED.map((item) => (
              <li key={item} className="text-xs text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
