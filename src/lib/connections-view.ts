// U2 — pure, db-free derivations for the /connections trust upgrades. Kept out
// of the page component so the arithmetic (coverage counts, renewal windows,
// honesty-gap reduction) is unit-testable against fixtures. Invariant b: counts
// only, never a fabricated percentage or a guessed person count.

import { HONESTY_GAP_GLOSSARY, type HonestyGapKind } from "./metrics-glossary";

type StatusLike = { status: string };

/** A "source" is a connection that has actually been set up — a `pending`
 * connection has no credential yet, so it isn't connected. */
export function countConnectedSources(connections: StatusLike[]): number {
  return connections.filter((c) => c.status !== "pending").length;
}

/** Header coverage summary — counts only. The "covering K of M people" clause
 * is deliberately omitted: the connections page doesn't load identity/coverage
 * data, and a denominator-free percentage would be a fabrication (invariant b).
 */
export function coverageSummaryLine(connections: StatusLike[]): string {
  const n = countConnectedSources(connections);
  return `${n} source${n === 1 ? "" : "s"} connected`;
}

// ─── Honesty gaps from the latest run per connection ───

type RunLike = {
  connectionId: string;
  gaps: unknown;
};

/**
 * Map the honesty-gap kinds carried by each connection's LATEST run.
 *
 * The input is ONE run per connection — the connection's true latest, fetched
 * via `connectorRuns.latest(connectionId)` (nulls for connections that never
 * ran are tolerated). It is deliberately NOT a capped org-wide run list: a
 * `LIMIT 100` list ordered by `started_at DESC` can crowd a busy connection's
 * latest run off the top when several connectors poll hourly, which would drop
 * the connection's "limited coverage" badge and imply full coverage it doesn't
 * have (invariant b). Taking per-connection latest runs makes that crowd-out
 * structurally impossible.
 *
 * Unknown/malformed gap entries are dropped (drift-safe), so a schema change
 * can never surface a bogus badge. Returns a map keyed by connectionId; a
 * connection with no known gaps (or no run at all) has no entry.
 */
export function latestGapKindsByConnection(
  latestRuns: Iterable<RunLike | null | undefined>,
): Map<string, HonestyGapKind[]> {
  const out = new Map<string, HonestyGapKind[]>();
  for (const run of latestRuns) {
    if (!run) continue;
    const gaps = Array.isArray(run.gaps) ? run.gaps : [];
    const kinds = gaps
      .map((g) =>
        g && typeof g === "object" ? (g as { kind?: unknown }).kind : undefined,
      )
      .filter(
        (k): k is HonestyGapKind =>
          typeof k === "string" && k in HONESTY_GAP_GLOSSARY,
      );
    if (kinds.length > 0) out.set(run.connectionId, [...new Set(kinds)]);
  }
  return out;
}

// ─── Unresolved-issues list (render-time, from already-loaded data) ───

export type ConnectionIssue = {
  kind: "sync_error" | "renewal_due";
  connectionId: string;
  displayName: string;
  message: string;
};

type IssueConnLike = {
  id: string;
  displayName: string;
  status: string;
  lastError: string | null;
  renewalDate: string | null;
};

/** Whole days from `now` until a `YYYY-MM-DD` date (negative = past). Null if
 * the date can't be parsed. Both sides are pinned to UTC midnight so the count
 * doesn't wobble with the viewer's clock time. */
function daysUntil(dateStr: string, now: Date): number | null {
  const target = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((target - todayUtc) / (24 * 60 * 60 * 1000));
}

function renewalMessage(days: number): string {
  if (days < 0) return "Renewal date has passed — check this connection still works.";
  if (days === 0) return "Renews today (the date you entered).";
  if (days === 1) return "Renews tomorrow (the date you entered).";
  return `Renews in ${days} days (the date you entered).`;
}

/**
 * The bottom-of-page "needs attention" list, derived entirely from data the
 * page already loads: connections whose last poll failed (with the honest
 * vendor error), and connections whose user-entered renewal date is within 30
 * days (or past). No new query, no guessing.
 */
export function deriveConnectionIssues(input: {
  connections: IssueConnLike[];
  now?: Date;
}): ConnectionIssue[] {
  const now = input.now ?? new Date();
  const issues: ConnectionIssue[] = [];
  for (const c of input.connections) {
    if (c.status === "error" && c.lastError) {
      issues.push({
        kind: "sync_error",
        connectionId: c.id,
        displayName: c.displayName,
        message: c.lastError,
      });
    }
    if (c.renewalDate) {
      const days = daysUntil(c.renewalDate, now);
      if (days !== null && days <= 30) {
        issues.push({
          kind: "renewal_due",
          connectionId: c.id,
          displayName: c.displayName,
          message: renewalMessage(days),
        });
      }
    }
  }
  return issues;
}
