// W3-P §15 launch metrics: reconstructs the signup → connect → backfill →
// first-score funnel from existing frozen-schema timestamps and prints
// time-to-first-insight, activation, share-card rate, and Personal→Team
// conversion signals. View-side events (landing/share-card views) live in
// Workers Analytics Engine instead — read those in the Cloudflare dashboard.
//
// Time-to-first-insight is anchored on the first SUCCESSFUL BACKFILL RUN
// (append-only connector_runs), NOT score_results.computed_at — the nightly
// recompute rewrites computed_at, so min(computed_at) would report the last
// recompute of the earliest period instead of first-insight time (see
// src/lib/launch-funnel.ts). Activation uses score-row EXISTENCE only.
//
// Also prints two standalone metrics (same honesty rules, no funnel row):
// MET-003 sync cadence — per-org inter-sync-interval distribution over
// connector_runs kind='agent_ingest' success rows, at most a trailing
// CONNECTOR_RUNS_RETENTION_DAYS (90-day) window (rows are purged after that —
// src/db/system.ts). PRIV-007 agent connection opt-in — share of activated
// orgs (score-row existence) with a claude_code_local/device_token
// connection; labeled "agent connection opt-in", not "companion usage" — it
// measures whether the agent is connected, not how the companion is used.
//
// Manually run, not a merge gate — connects to whatever DATABASE_URL points
// at (dev or prod), never CI (same pattern as calibrate-scores.ts). Read-only
// and cross-org by design: this is the founder's aggregate launch view, not
// an application query surface (application code stays behind forOrg).
//
//   DATABASE_URL=<neon-connection-string> npx tsx scripts/launch-metrics.ts
import { and, count, eq, min, ne, sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import {
  connections,
  connectorRuns,
  invites,
  orgs,
  scoreResults,
  shareLinks,
} from "../src/db/schema";
import { CONNECTOR_RUNS_RETENTION_DAYS } from "../src/db/system";
import { orgMembers } from "../src/db/auth-schema";
import {
  deriveAgentOptInRate,
  deriveLaunchFunnel,
  deriveSyncCadence,
  type LaunchFunnel,
  type OrgFunnelRow,
} from "../src/lib/launch-funnel";

const DEV_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

function fmtMinutes(m: number | null): string {
  if (m === null) {
    return "—";
  }
  return m >= 90 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(1)} min`;
}

function fmtRate(r: number | null): string {
  return r === null ? "— (no data yet)" : `${(r * 100).toFixed(0)}%`;
}

function printSyncCadence(
  cadence: ReturnType<typeof deriveSyncCadence>,
): void {
  console.log("MET-003 sync cadence (inter-sync interval, per org)");
  console.log(
    `  window: at most the trailing ${CONNECTOR_RUNS_RETENTION_DAYS} days — connector_runs rows older than that are pruned, so this is never a full-history distribution.`,
  );
  if (cadence.length === 0) {
    console.log("  no agent_ingest runs yet");
    return;
  }
  for (const c of cadence) {
    console.log(
      `  org ${c.orgId}: samples ${c.samples} · median ${fmtMinutes(c.medianMinutes)} · p90 ${fmtMinutes(c.p90Minutes)}`,
    );
  }
}

function printAgentOptInRate(
  optIn: ReturnType<typeof deriveAgentOptInRate>,
): void {
  console.log("PRIV-007 agent connection opt-in (NOT companion usage)");
  console.log(
    `  ${optIn.withAgentConnection} of ${optIn.activated} activated orgs · ${fmtRate(optIn.rate)}`,
  );
}

function printFunnel(f: LaunchFunnel): void {
  console.log("§15 launch funnel");
  console.log(
    `  orgs ${f.stages.orgs} → connected ${f.stages.connected} → backfilled ${f.stages.backfilled} → activated ${f.stages.activated}`,
  );
  console.log(
    "time to first insight (signup → first successful backfill sync; stable proxy — see header)",
  );
  console.log(
    `  samples ${f.timeToFirstInsight.samples} · median ${fmtMinutes(f.timeToFirstInsight.medianMinutes)} · p90 ${fmtMinutes(f.timeToFirstInsight.p90Minutes)} · under 10 min ${fmtRate(f.timeToFirstInsight.under10MinRate)}`,
  );
  console.log("share-card creation rate (activated orgs with ≥1 share link)");
  console.log(
    `  ${f.shareCard.withShareLink} of ${f.shareCard.activated} activated · ${fmtRate(f.shareCard.rate)}`,
  );
  console.log("personal → team signals");
  console.log(
    `  personal ${f.personalToTeam.personalOrgs} · team ${f.personalToTeam.teamOrgs} · personal w/ invites ${f.personalToTeam.personalWithInvites} · w/ accepted ${f.personalToTeam.personalWithAcceptedInvites} · multi-member ${f.personalToTeam.personalMultiMember}`,
  );
}

async function main() {
  const db = createDb({ DATABASE_URL: DEV_DB_URL });

  const orgRows = await db
    .select({ id: orgs.id, kind: orgs.kind, createdAt: orgs.createdAt })
    .from(orgs)
    .where(ne(orgs.kind, "system"));

  const [conn, backfill, score, share, members, invited, agentIngestRuns, agentConnected] =
    await Promise.all([
      db
        .select({ orgId: connections.orgId, at: min(connections.createdAt) })
        .from(connections)
        .groupBy(connections.orgId),
      db
        .select({ orgId: connectorRuns.orgId, at: min(connectorRuns.finishedAt) })
        .from(connectorRuns)
        .where(
          and(eq(connectorRuns.kind, "backfill"), eq(connectorRuns.status, "success")),
        )
        .groupBy(connectorRuns.orgId),
      db
        .select({ orgId: scoreResults.orgId })
        .from(scoreResults)
        .groupBy(scoreResults.orgId),
      db
        .select({ orgId: shareLinks.orgId, n: count() })
        .from(shareLinks)
        .groupBy(shareLinks.orgId),
      db
        .select({ orgId: orgMembers.orgId, n: count() })
        .from(orgMembers)
        .groupBy(orgMembers.orgId),
      db
        .select({
          orgId: invites.orgId,
          sent: count(),
          accepted: sql<number>`count(*) filter (where ${invites.acceptedAt} is not null)`.mapWith(Number),
        })
        .from(invites)
        .groupBy(invites.orgId),
      // MET-003: raw agent_ingest success rows (not aggregated — the pure
      // deriveSyncCadence function computes inter-arrival gaps itself). Only
      // ever a trailing-90-day window: connector_runs rows are purged after
      // CONNECTOR_RUNS_RETENTION_DAYS (src/db/system.ts).
      db
        .select({ orgId: connectorRuns.orgId, finishedAt: connectorRuns.finishedAt })
        .from(connectorRuns)
        .where(
          and(
            eq(connectorRuns.kind, "agent_ingest"),
            eq(connectorRuns.status, "success"),
          ),
        )
        .orderBy(connectorRuns.orgId, connectorRuns.finishedAt),
      // PRIV-007: orgs with a Revealyst Agent connection (device-token auth).
      db
        .select({ orgId: connections.orgId })
        .from(connections)
        .where(
          and(
            eq(connections.vendor, "claude_code_local"),
            eq(connections.authKind, "device_token"),
          ),
        )
        .groupBy(connections.orgId),
    ]);

  const byOrg = <T extends { orgId: string }>(list: T[]) =>
    new Map(list.map((r) => [r.orgId, r]));
  const connBy = byOrg(conn);
  const backfillBy = byOrg(backfill);
  const scoredOrgs = new Set(score.map((r) => r.orgId));
  const shareBy = byOrg(share);
  const membersBy = byOrg(members);
  const invitedBy = byOrg(invited);
  const agentConnectedOrgs = new Set(agentConnected.map((r) => r.orgId));

  const rows: OrgFunnelRow[] = orgRows.map((o) => ({
    orgId: o.id,
    kind: o.kind as "personal" | "team",
    createdAt: o.createdAt,
    firstConnectionAt: connBy.get(o.id)?.at ?? null,
    firstBackfillSuccessAt: backfillBy.get(o.id)?.at ?? null,
    hasScore: scoredOrgs.has(o.id),
    shareLinks: shareBy.get(o.id)?.n ?? 0,
    members: membersBy.get(o.id)?.n ?? 0,
    invitesSent: invitedBy.get(o.id)?.sent ?? 0,
    invitesAccepted: invitedBy.get(o.id)?.accepted ?? 0,
  }));

  printFunnel(deriveLaunchFunnel(rows));
  printSyncCadence(deriveSyncCadence(agentIngestRuns));
  printAgentOptInRate(
    deriveAgentOptInRate(
      orgRows.map((o) => ({
        orgId: o.id,
        hasScore: scoredOrgs.has(o.id),
        hasAgentConnection: agentConnectedOrgs.has(o.id),
      })),
    ),
  );
  // Flush stdout before exiting: a bare process.exit(0) can truncate piped
  // output (non-TTY stdout is async in node), and the pooled client's
  // 20s idle_timeout would otherwise keep the process alive.
  await new Promise((resolve) => process.stdout.write("", () => resolve(null)));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
